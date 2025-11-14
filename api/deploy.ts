import { getBenchmarkProjects, errorResponse } from './util.ts'
import type { CreateDeploymentRequest } from '@vercel/sdk/models/createdeploymentop.js'
import constants from './constants.json' with { type: 'json' }
import { Vercel } from '@vercel/sdk'

const { registries, teamId, projectSettings } = constants

const vercel = new Vercel({
  bearerToken: process.env.DEPLOY_TOKEN,
})

const authToken = process.env.AUTH_TOKEN

export async function POST(request: Request) {
  const requestToken = request.headers.get('authorization')

  if (!authToken || !requestToken || requestToken !== authToken) {
    return errorResponse('Unauthorized', 401)
  }

  const url = new URL(request.url)
  const full = url.searchParams.get('full') === 'true'
  const limit = url.searchParams.get('limit') ?? '100'
  const filters = url.searchParams.getAll('filter')
  const filterRegistries = url.searchParams.getAll('registry') ?? []

  const deploymentsToCreate: CreateDeploymentRequest[] = []

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
    for (const registry of actualRegistries) {
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
          `No deployment found for ${project.name} and ${registry}`,
        )
      }

      deploymentsToCreate.push({
        teamId,
        requestBody: {
          name: project.name,
          deploymentId: deployment.uid,
          ...(registry === 'npm'
            ? { target }
            : { customEnvironmentSlugOrId: target }),
          projectSettings: {
            ...projectSettings,
          },
        },
      })
    }
  }

  const createdDeployments = await Promise.all(
    deploymentsToCreate.map((deployment) =>
      vercel.deployments.createDeployment(deployment),
    ),
  )

  const results = full
    ? createdDeployments
    : createdDeployments.map((deployment) => ({
        status: deployment.status,
        name: deployment.name,
        id: deployment.id,
        registry:
          deployment.oidcTokenClaims?.environment === 'production'
            ? 'npm'
            : deployment.oidcTokenClaims?.environment,
        inspectorUrl: deployment.inspectorUrl,
      }))

  return new Response(JSON.stringify(results, null, 2))
}
