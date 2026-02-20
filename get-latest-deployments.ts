#!/usr/bin/env node

import { parseArgs } from 'util'
import {
  getBenchmarkProjects,
  createCombinations,
  shortestCommonPrefix,
  uniqBy,
} from './util.ts'
import constants from './constants.json' with { type: 'json' }
import { Vercel } from '@vercel/sdk'
import type { Deployments } from '@vercel/sdk/models/getdeploymentsop.js'
import assert from 'assert'

const { teamId: TEAM_ID } = constants

const VERCEL_TOKEN = process.env.VERCEL_TOKEN
assert(VERCEL_TOKEN, 'VERCEL_TOKEN is not set in .env')
const vercel = new Vercel({ bearerToken: VERCEL_TOKEN })

const processBuildLogs = async (deployment: Deployments) => {
  const buildLogs = await vercel.deployments.getDeploymentEvents({
    idOrUrl: deployment.uid,
    teamId: TEAM_ID,
  })
  assert(Array.isArray(buildLogs), 'Build logs is not an array')

  const registries = new Map<string, number>()
  const fetchTiming: [string, number][] = []

  let npmTime: number | null = null

  for (const log of buildLogs) {
    const { text } = log as any
    const isNpmHttpFetch = text.match(
      /^npm http fetch GET \d+ ([^\s]+) (\d+)ms /,
    )
    if (isNpmHttpFetch) {
      const registry = isNpmHttpFetch[1]
      const duration = +isNpmHttpFetch[2]
      fetchTiming.push([registry, duration])
      registries.set(registry, (registries.get(registry) ?? 0) + 1)
      continue
    }
    const isTotal = text.match(/^npm timing npm Completed in (\d+)ms$/)
    if (isTotal) {
      npmTime = +isTotal[1]
      continue
    }
  }

  assert(npmTime !== null, 'NPM time is not set')

  const registry = shortestCommonPrefix([...registries.keys()])

  assert(registry, 'Registry URL is not set')

  return { fetchTiming, npmTime, registry }
}

const processDeploymentFiles = async (deployment: Deployments) => {
  const deploymentFiles = await vercel.deployments.listDeploymentFiles({
    id: deployment.uid,
    teamId: TEAM_ID,
  })

  const isPackageLock = !!deploymentFiles[0]?.children?.some(
    (file) => file.name === 'package-lock.json',
  )

  return { isPackageLock }
}

async function getLatestDeployments({
  full = false,
  limit = '100',
  filter = [],
  fetchTiming: includeFetchTiming = false,
  registry = ['npm', 'vsr'],
  variant: variants = ['lockfile', 'no-lockfile'],
}: {
  full?: boolean
  limit?: string
  filter?: string[]
  fetchTiming?: boolean
  registry?: string[]
  variant?: string[]
}) {
  const projects = await getBenchmarkProjects(vercel, {
    limit,
    filters: filter,
  })

  assert(projects.length, 'No projects found')
  console.error(
    `Found ${projects.length} projects: ${projects.map((p) => p.name).join(', ')}`,
  )

  const combos = createCombinations([registry, variants])
  assert(combos.length, 'No combinations found')
  console.error(
    `Looking for ${combos.length} combinations:${JSON.stringify(combos)}`,
  )

  const deployments = await Promise.all(
    projects.map(async (project) => {
      const deploymentsData = await vercel.deployments.getDeployments({
        limit: combos.length,
        projectId: project.id,
        teamId: TEAM_ID,
        target: 'production',
      })

      assert(deploymentsData.deployments.length, 'No deployments found')

      const deployments = await Promise.all(
        deploymentsData.deployments.map(async (deployment) => {
          const [{ fetchTiming, npmTime, registry }, { isPackageLock }] =
            await Promise.all([
              processBuildLogs(deployment),
              processDeploymentFiles(deployment),
            ])
          const name = project.name
          return {
            id: `${name.replace('benchmark-', '')}-${isPackageLock ? 'lockfile' : 'no-lockfile'}-${registry}`,
            name,
            registry,
            isPackageLock,
            state: deployment.state,
            buildDuration:
              deployment.ready && deployment.buildingAt
                ? deployment.ready - deployment.buildingAt
                : null,
            queueDuration: deployment.buildingAt
              ? deployment.buildingAt - deployment.created
              : null,
            createdTime: new Date(deployment.created).toISOString(),
            buildStartTime: deployment.buildingAt
              ? new Date(deployment.buildingAt).toISOString()
              : null,
            readyTime: deployment.ready
              ? new Date(deployment.ready).toISOString()
              : null,
            npmTime,
            fetchTiming: includeFetchTiming ? fetchTiming : null,
            ...(full ? { deployment } : {}),
          }
        }),
      )

      const uniqueDeployments = uniqBy(deployments, (d) => d.id)

      assert(
        deployments.length === uniqueDeployments.length,
        [
          'Duplicate deployments found.',
          'This is probably because the combinations of the latest triggered deployments do not match the combinations you are looking for.',
          'Check the --registry and --variant flags against the latest deployments.',
        ].join('\n'),
      )

      return deployments
    }),
  )

  return deployments.flat().sort((a, b) => `${a.id}`.localeCompare(`${b.id}`))
}

getLatestDeployments(
  parseArgs({
    options: {
      full: { type: 'boolean' },
      limit: { type: 'string' },
      filter: { type: 'string', multiple: true },
      fetchTiming: { type: 'boolean' },
      registry: { type: 'string', multiple: true },
      variant: { type: 'string', multiple: true },
    },
  }).values,
)
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
