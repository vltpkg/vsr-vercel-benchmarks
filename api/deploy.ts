import { Vercel } from '@vercel/sdk'
import { environments, teamId, projectSettings } from './data.js'
import { CreateDeploymentRequest } from '@vercel/sdk/models/createdeploymentop.js'

const vercel = new Vercel({
  bearerToken: process.env.DEPLOY_TOKEN,
})

export async function POST(request: Request) {
  const url = new URL(request.url)
  const full = url.searchParams.get('full') === 'true'

  const deploymentsToCreate: CreateDeploymentRequest[] = []

  const projects = await vercel.projects.getProjects({
    teamId,
    search: 'benchmark-',
    limit: '100',
  })

  const filteredProjects =
    projects.projects?.filter(
      (project) =>
        project.name.startsWith('benchmark-') &&
        project.name !== 'benchmark-deploy',
    ) ?? []

  for (const project of filteredProjects) {
    for (const environment of environments) {
      const deploymentsData = await vercel.deployments.getDeployments({
        limit: 1,
        projectId: project.id,
        teamId,
        target: environment,
      })

      const deployment = deploymentsData.deployments[0]

      if (!deployment) {
        return new Response(
          JSON.stringify(
            {
              error: `No deployment found for ${project.name} and ${environment}`,
            },
            null,
            2,
          ),
          { status: 500 },
        )
      }

      deploymentsToCreate.push({
        teamId,
        requestBody: {
          name: project.name,
          deploymentId: deployment.uid,
          target: environment === 'vsr' ? undefined : environment,
          customEnvironmentSlugOrId:
            environment === 'production' ? undefined : environment,
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
        environment: deployment.oidcTokenClaims?.environment,
        inspectorUrl: deployment.inspectorUrl,
      }))

  return new Response(JSON.stringify(results, null, 2))
}
