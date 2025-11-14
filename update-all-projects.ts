#!/usr/bin/env node

import { getBenchmarkProjects } from './api/util.ts'
import constants from './api/constants.json' with { type: 'json' }
import { Vercel } from '@vercel/sdk'

const VERCEL_TOKEN = process.env.VERCEL_TOKEN!
const { projectSettings, teamId } = constants

if (!VERCEL_TOKEN) {
  console.error('Error: VERCEL_TOKEN is not set in .env')
  process.exit(1)
}

const vercel = new Vercel({ bearerToken: VERCEL_TOKEN })

async function updateAllProjects() {
  console.log('Fetching all benchmark projects...')

  const projects = await getBenchmarkProjects(vercel, { limit: '100' })

  if (!projects.length) {
    console.log('No projects found')
    return
  }

  console.log(`Found ${projects.length} projects to update`)

  for (const project of projects) {
    console.log(`Updating project: ${project.name}`)

    try {
      await vercel.projects.updateProject({
        idOrName: project.id,
        teamId,
        requestBody: {
          ...projectSettings,
        },
      })
      console.log(`✓ Successfully updated: ${project.name}`)
    } catch (error) {
      console.error(`✗ Failed to update ${project.name}:`, error)
    }
  }

  console.log('Done updating all projects')
}

updateAllProjects().catch(console.error)
