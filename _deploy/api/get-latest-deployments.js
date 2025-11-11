import { Vercel } from "@vercel/sdk";

const vercel = new Vercel({
  bearerToken: process.env.DEPLOY_TOKEN,
});

const projects = [
  { name: 'benchmark-angular-16', projectId: 'prj_Me2bztVAFfSfWwA6PghCAJFmDk55' },
  { name: 'benchmark-angular-v17', projectId: 'prj_IdCLabyv4HCQKzYgzrSXssFDkUgz' },
]

const environments = [
  'production', // default is npm
  'vsr',
]

const teamId = 'team_I0bmFHPp3qnoaSnAA6xP70tU'

export async function GET(request) {
  const url = new URL(request.url)
  const full = url.searchParams.get('full') === 'true'

  const deployments = []

  for (const project of projects) {
    for (const environment of environments) {
      const deploymentsData = await vercel.deployments.getDeployments({
        limit: 1,
        projectId: project.projectId,
        teamId,
        target: environment,
      })

      const deployment = deploymentsData.deployments[0]

      if (!deployment) {
        console.log(`No deployment found for project ${project.name}`);
        return new Response(JSON.stringify({ error: `No deployment found for ${project.name} and ${environment}` }, null, 2));
      }

      const fullDeployment = await vercel.deployments.getDeployment({
        idOrUrl: deployment.uid,
        teamId,
      });

      const buildTime = (fullDeployment.buildingAt - fullDeployment.createdAt) / 1000

      deployments.push({
        project,
        environment,
        buildTime,
        ...(full ? { deployment, fullDeployment } : {}),
      });
    }
  }

  return new Response(JSON.stringify(deployments, null, 2));
}