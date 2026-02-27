#!/usr/bin/env node

import { parseArgs } from 'util'
import { getBenchmarkProjects } from './util.ts'
import constants from './constants.json' with { type: 'json' }
import { Vercel } from '@vercel/sdk'
import assert from 'assert'

const { teamId: TEAM_ID } = constants

const VERCEL_TOKEN = process.env.VERCEL_TOKEN
assert(VERCEL_TOKEN, 'VERCEL_TOKEN is not set in .env')

const vercel = new Vercel({ bearerToken: VERCEL_TOKEN })

type Args = {
  limit?: string
  filter?: string[]
  dryRun?: boolean
}

async function deleteProject(projectId: string) {
  const response = await fetch(
    `https://api.vercel.com/v9/projects/${projectId}?teamId=${TEAM_ID}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
      },
    },
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${body}`)
  }
}

async function deleteBenchmarkProjects({
  limit = '100',
  filter = [],
  dryRun = false,
}: Args) {
  const projectsToDelete = await getBenchmarkProjects(vercel, {
    limit,
    filters: filter,
  })

  if (!projectsToDelete.length) {
    console.log('No benchmark projects found to delete.')
    return
  }

  console.log(
    `Found ${projectsToDelete.length} benchmark project(s): ${projectsToDelete.map((project) => project.name).join(', ')}`,
  )

  if (dryRun) {
    console.log('Dry run enabled. No projects were deleted.')
    return
  }

  let deletedCount = 0
  let failedCount = 0

  for (const project of projectsToDelete) {
    try {
      await deleteProject(project.id)
      deletedCount++
      console.log(`[deleted] ${project.name}`)
    } catch (error) {
      failedCount++
      console.error(`[failed] ${project.name}`, error)
    }
  }

  console.log(`Done. Deleted ${deletedCount} project(s). Failed: ${failedCount}.`)
  if (failedCount > 0) {
    process.exitCode = 1
  }
}

const args = parseArgs({
  options: {
    limit: { type: 'string' },
    filter: { type: 'string', multiple: true },
    dryRun: { type: 'boolean' },
  },
}).values

deleteBenchmarkProjects(args).catch((error) => {
  console.error(error)
  process.exit(1)
})
