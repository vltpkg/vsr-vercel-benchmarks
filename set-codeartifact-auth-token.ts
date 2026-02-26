#!/usr/bin/env node

import { execFile } from 'child_process'
import { parseArgs, promisify } from 'util'
import assert from 'assert'
import { Vercel } from '@vercel/sdk'
import { getBenchmarkProjects } from './util.ts'
import constants from './constants.json' with { type: 'json' }

const execFileAsync = promisify(execFile)
const { teamId } = constants

const VERCEL_TOKEN = process.env.VERCEL_TOKEN
assert(VERCEL_TOKEN, 'VERCEL_TOKEN is not set in .env')

const vercel = new Vercel({ bearerToken: VERCEL_TOKEN })

type AwsCodeArtifactConfig = {
  domain: string
  domainOwner: string
  region: string
}

function getAwsCodeArtifactConfig(): AwsCodeArtifactConfig {
  const awsRegistry = (constants as any).registries?.aws?.registry
  assert(
    typeof awsRegistry === 'string',
    'constants.json registries.aws.registry is not configured',
  )

  const url = new URL(awsRegistry)
  const hostMatch = url.hostname.match(
    /^(.+)-(\d+)\.d\.codeartifact\.([^.]+)\.amazonaws\.com$/,
  )

  assert(
    hostMatch,
    `Unable to parse CodeArtifact settings from registry host: ${url.hostname}`,
  )

  const domain = hostMatch[1]
  const domainOwner = hostMatch[2]
  const region = hostMatch[3]
  assert(domain && domainOwner && region, 'CodeArtifact host parse failed')
  return { domain, domainOwner, region }
}

async function getFreshCodeArtifactToken(profile?: string) {
  const { domain, domainOwner, region } = getAwsCodeArtifactConfig()
  const args = [
    'codeartifact',
    'get-authorization-token',
    '--domain',
    domain,
    '--domain-owner',
    domainOwner,
    '--region',
    region,
    '--query',
    'authorizationToken',
    '--output',
    'text',
  ]

  if (profile) {
    args.push('--profile', profile)
  }

  const { stdout } = await execFileAsync('aws', args, { maxBuffer: 1024 * 1024 })
  const token = stdout.trim()

  assert(token && token !== 'None', 'AWS CLI returned an empty auth token')
  return token
}

async function setCodeArtifactAuthToken({
  limit = '100',
  filter = [],
  profile,
}: {
  limit?: string
  filter?: string[]
  profile?: string
}) {
  const authToken = await getFreshCodeArtifactToken(profile)
  console.error('Fetched fresh CODEARTIFACT_AUTH_TOKEN from AWS CLI')

  const projects = await getBenchmarkProjects(vercel, {
    limit,
    filters: filter,
  })

  assert(projects.length, 'No projects found')
  console.error(
    `Found ${projects.length} projects: ${projects.map((p) => p.name).join(', ')}`,
  )

  let success = 0
  let failures = 0

  for (const project of projects) {
    try {
      await vercel.projects.createProjectEnv({
        idOrName: project.id,
        teamId,
        upsert: 'true',
        requestBody: {
          key: 'CODEARTIFACT_AUTH_TOKEN',
          value: authToken,
          type: 'plain',
          target: ['production', 'preview', 'development'],
        },
      })
      success++
      console.error(`✓ ${project.name}`)
    } catch (error) {
      failures++
      console.error(`✗ ${project.name}`)
      console.error(error)
    }
  }

  console.error(`Updated CODEARTIFACT_AUTH_TOKEN in ${success} projects`)
  if (failures > 0) {
    console.error(`Failed to update ${failures} projects`)
    process.exitCode = 1
  }
}

setCodeArtifactAuthToken(
  parseArgs({
    options: {
      limit: { type: 'string' },
      filter: { type: 'string', multiple: true },
      profile: { type: 'string' },
    },
  }).values,
).catch((error) => {
  console.error(error)
  process.exit(1)
})
