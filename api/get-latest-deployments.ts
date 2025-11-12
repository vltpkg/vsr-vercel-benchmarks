import { Vercel } from '@vercel/sdk'
import { environments, teamId } from './data.js'
import type { Deployments } from '@vercel/sdk/models/getdeploymentsop.js'

const vercel = new Vercel({
  bearerToken: process.env.DEPLOY_TOKEN,
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const full = url.searchParams.get('full') === 'true'
  const logs = url.searchParams.get('logs') === 'true'

  const deployments = []

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

  if (!filteredProjects.length) {
    return new Response(
      JSON.stringify({ error: 'No projects found' }, null, 2),
      { status: 500 },
    )
  }

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

      if (!deployment.ready || !deployment.buildingAt) {
        return new Response(
          JSON.stringify(
            {
              error: `Deployment not ready for ${project.name} and ${environment}`,
            },
            null,
            2,
          ),
          { status: 500 },
        )
      }

      const result: {
        name: string
        environment: string
        buildTime: number | null
        created: Deployments['created']
        createdTime: string
        state: Deployments['state']
        logs?: string[]
        deployment?: Deployments
      } = {
        name: project.name,
        environment,
        buildTime:
          deployment.state === 'READY'
            ? deployment.ready - deployment.buildingAt
            : null,
        state: deployment.state,
        created: deployment.created,
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
