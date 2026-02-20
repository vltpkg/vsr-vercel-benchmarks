#!/usr/bin/env node

import { parseArgs } from 'util'
import { getBenchmarkProjects, createCombinations } from './util.ts'
import constants from './constants.json' with { type: 'json' }
import { Vercel } from '@vercel/sdk'
import { readFile } from 'fs/promises'
import { join } from 'path'
import assert from 'assert'

const {
  registries: REGISTRIES,
  teamId: TEAM_ID,
  projectSettings: PROJECT_SETTINGS,
} = constants

const VERCEL_TOKEN = process.env.VERCEL_TOKEN
assert(VERCEL_TOKEN, 'VERCEL_TOKEN is not set in .env')
const vercel = new Vercel({ bearerToken: VERCEL_TOKEN })

async function triggerBenchmark({
  full = false,
  limit = '100',
  filter = [],
  registry = ['npm', 'vsr'],
  variant: variants = ['lockfile', 'no-lockfile'],
}: {
  full?: boolean
  limit?: string
  filter?: string[]
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

  const registries = registry.length
    ? Object.entries(REGISTRIES)
        .filter(([key]) => registry.includes(key))
        .map(([_, value]) => value)
    : Object.values(REGISTRIES)

  const deploymentsToCreate = await Promise.all(
    projects.map(async (project) => {
      const readProjectFile = (file: string) =>
        readFile(
          join(
            process.cwd(),
            'packages',
            project.name.replace('benchmark-', ''),
            file,
          ),
          'utf-8',
        )

      const [pkgJson, pkgLock] = await Promise.all([
        readProjectFile('package.json'),
        readProjectFile('package-lock.json'),
      ])

      return createCombinations([registries, variants]).map(
        ([registry, variant]) => {
          return {
            teamId: TEAM_ID,
            requestBody: {
              name: project.name,
              target: 'production',
              files: [
                { file: 'package.json', data: pkgJson },
                ...(variant === 'lockfile'
                  ? [{ file: 'package-lock.json', data: pkgLock }]
                  : []),
              ],
              projectSettings: {
                ...PROJECT_SETTINGS,
                installCommand:
                  `${registry ? `NPM_CONFIG_REGISTRY=${registry}` : ''} ${PROJECT_SETTINGS.installCommand}`.trim(),
              },
            },
          }
        },
      )
    }),
  ).then((deployments) => deployments.flat())

  console.error(`Creating ${deploymentsToCreate.length} deployments...`)

  const createdDeployments = await Promise.all(
    deploymentsToCreate.map(
      async (deployment) =>
        [
          deployment,
          await vercel.deployments.createDeployment(deployment),
        ] as const,
    ),
  )

  return createdDeployments.map(([request, deployment]) => ({
    status: deployment.status,
    name: deployment.name,
    id: deployment.id,
    inspectorUrl: deployment.inspectorUrl,
    isPackageLock: request.requestBody.files?.some(
      (f) => f.file === 'package-lock.json',
    ),
    registry:
      request.requestBody.projectSettings.installCommand?.match(
        /NPM_CONFIG_REGISTRY=([^\s]+)/,
      )?.[1] ?? REGISTRIES.npm,
    ...(full ? { deployment } : {}),
  }))
}

triggerBenchmark(
  parseArgs({
    options: {
      full: { type: 'boolean' },
      limit: { type: 'string' },
      filter: { type: 'string', multiple: true },
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
