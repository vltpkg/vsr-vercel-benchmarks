import { Vercel } from '@vercel/sdk'
import { customEnvironment, teamId } from './constants.js'

export const vercel = new Vercel({
  bearerToken: process.env.DEPLOY_TOKEN,
})

export const getBenchmarkProjects = async ({
  limit = '100',
  filters = [],
}: {
  limit?: string
  filters?: string[]
}) => {
  const projects = await vercel.projects.getProjects({
    teamId,
    search: 'benchmark-',
    limit,
  })
  return (
    projects.projects
      ?.filter(
        (project) =>
          project.name.startsWith('benchmark-') &&
          // benchmark-deploy is the project that deploys the benchmark projects
          project.name !== 'benchmark-deploy',
      )
      .filter((project) => {
        return (
          filters.length === 0 ||
          filters.some((filter) =>
            project.name.replace(/^benchmark-/, '').startsWith(filter),
          )
        )
      }) ?? []
  )
}

export const errorResponse = (error: string, code = 500) => {
  return new Response(JSON.stringify({ error }, null, 2), { status: code })
}

export const successResponse = (data: any) => {
  return new Response(JSON.stringify(data, null, 2), { status: 200 })
}
