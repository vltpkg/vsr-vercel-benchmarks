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

  const results = []
  const deploymentsToCreate = []


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

      deploymentsToCreate.push({
        teamId,
        requestBody: {
          name: project.name,
          deploymentId: deployment.uid,
          target: environment === 'vsr' ? undefined : environment,
          customEnvironmentSlugOrId: environment === 'production' ? undefined : environment,
          projectSettings: {
            installCommand: "npm install --timing --loglevel=http"
          },
        }
      });
    }
  }

  for (const deployment of deploymentsToCreate) {
    const result = await vercel.deployments.createDeployment(deployment);
    results.push(result);
  }

  return new Response(JSON.stringify(results, null, 2));
}