import { Vercel } from '@vercel/sdk'
import constants from './constants.json' with { type: 'json' }

const { teamId } = constants

export const getBenchmarkProjects = async (
  vercel: Vercel,
  {
    limit = '100',
    filters = [],
  }: {
    limit?: string
    filters?: string[]
  },
) => {
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

export const createCombinations = <T>(arrays: T[][]): T[][] => {
  return arrays.reduce(
    (acc, array) => {
      return acc.flatMap((combination) =>
        array.map((item) => [...combination, item]),
      )
    },
    [[]] as T[][],
  )
}

export const shortestCommonPrefix = (strings: string[]) => {
  if (strings.length === 0) {
    return ''
  }
  let prefix = strings[0]!
  for (const string of strings) {
    while (!string.startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
      if (prefix === '') {
        return ''
      }
    }
  }
  return prefix
}

export const uniqBy = <T>(array: T[], key: (item: T) => string): T[] => {
  return array.filter(
    (item, index, self) =>
      index === self.findIndex((t) => key(t) === key(item)),
  )
}
