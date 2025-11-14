import { Vercel } from '@vercel/sdk'
import constants from './constants.json' with { type: 'json' }
import { errorResponse, getBenchmarkProjects } from './util.ts'
import type { Deployments } from '@vercel/sdk/models/getdeploymentsop.js'

const { registries, teamId } = constants

const vercel = new Vercel({
  bearerToken: process.env.DEPLOY_TOKEN,
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const full = url.searchParams.get('full') === 'true'
  const logs = url.searchParams.get('logs') === 'true'
  const limit = url.searchParams.get('limit') ?? '100'
  const filters = url.searchParams.getAll('filter')
  const filterRegistries = url.searchParams.getAll('registry') ?? []

  const deployments = []

  const projects = await getBenchmarkProjects(vercel, { limit, filters })

  if (!projects.length) {
    return errorResponse('No projects found')
  }

  const actualRegistries = filterRegistries.length
    ? registries.filter((registry) => filterRegistries.includes(registry))
    : registries

  if (!actualRegistries.length) {
    return errorResponse('No registries found')
  }

  for (const project of projects) {
    for (const registry of registries) {
      const target = registry === 'npm' ? 'production' : registry

      const deploymentsData = await vercel.deployments.getDeployments({
        limit: 1,
        projectId: project.id,
        teamId,
        target,
      })

      const deployment = deploymentsData.deployments[0]

      if (!deployment) {
        return errorResponse(
          `No deployment found for ${project.name} and ${target}`,
        )
      }

      const result: {
        name: string
        registry: string
        buildTime: number | null
        createdTime: string
        state: Deployments['state']
        logs?: string[]
        deployment?: Deployments
      } = {
        name: project.name,
        registry,
        buildTime:
          deployment.ready && deployment.buildingAt
            ? deployment.ready - deployment.buildingAt
            : null,
        state: deployment.state,
        createdTime: new Date(deployment.created).toISOString(),
        ...(full ? { deployment } : {}),
      }

      if (logs) {
        const buildLogs = await vercel.deployments.getDeploymentEvents({
          idOrUrl: deployment.uid,
          teamId,
        })
        if (Array.isArray(buildLogs)) {
          result.logs = buildLogs.map((log: any) => log.text)
        }
      }

      deployments.push(result)
    }
  }

  return new Response(JSON.stringify(deployments, null, 2))
}
