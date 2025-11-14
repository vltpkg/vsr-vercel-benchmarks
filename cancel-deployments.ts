#!/usr/bin/env node

import { getBenchmarkProjects } from './api/util.ts'
import constants from './api/constants.json' with { type: 'json' }
import { Vercel } from '@vercel/sdk'

const VERCEL_TOKEN = process.env.VERCEL_TOKEN!
const { teamId } = constants

if (!VERCEL_TOKEN) {
  console.error('Error: VERCEL_TOKEN is not set in .env')
  process.exit(1)
}

const vercel = new Vercel({ bearerToken: VERCEL_TOKEN })

async function cancelCurrentDeployments() {
  console.log('Fetching all benchmark projects...')

  const projects = await getBenchmarkProjects(vercel, { limit: '100' })

  if (!projects.length) {
    console.log('No projects found')
    return
  }

  console.log(`Found ${projects.length} projects to check`)

  let totalCancelled = 0

  for (const project of projects) {
    console.log(`\nChecking project: ${project.name}`)

    try {
      const deploymentsData = await vercel.deployments.getDeployments({
        projectId: project.id,
        teamId,
        limit: 100,
      })

      const deployments = deploymentsData.deployments.filter((deployment) =>
        ['QUEUED', 'BUILDING', 'INITIALIZING'].includes(deployment.state ?? ''),
      )

      if (deployments.length === 0) {
        console.log(`  No current deployments for ${project.name}`)
        continue
      }

      console.log(`  Found ${deployments.length} current deployment(s)`)

      for (const deployment of deployments) {
        try {
          await vercel.deployments.cancelDeployment({
            id: deployment.uid,
            teamId,
          })
          console.log(`  ✓ Cancelled deployment: ${deployment.uid}`)
          totalCancelled++
        } catch (error) {
          console.error(
            `  ✗ Failed to cancel deployment ${deployment.uid}:`,
            error,
          )
        }
      }
    } catch (error) {
      console.error(`✗ Failed to process ${project.name}:`, error)
    }
  }

  console.log(`\nDone! Cancelled ${totalCancelled} current deployment(s)`)
}

cancelCurrentDeployments().catch(console.error)
