import { parseArgs } from 'util'

const url = new URL('https://benchmark-deploy.vercel.app/api/deploy')

const args = parseArgs({
  options: {
    full: { type: 'boolean' },
    limit: { type: 'string' },
    filter: { type: 'string', multiple: true },
    registry: { type: 'string', multiple: true },
  },
})

const { full, limit, filter = [], registry = [] } = args.values

if (full) {
  url.searchParams.set('full', 'true')
}
if (limit) {
  url.searchParams.set('limit', limit)
}
if (filter.length > 0) {
  for (const f of filter) {
    url.searchParams.append('filter', f)
  }
}
if (registry.length > 0) {
  for (const r of registry) {
    url.searchParams.append('registry', r)
  }
}

console.log(url.toString())

await new Promise((resolve) => setTimeout(resolve, 1000))

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: process.env.AUTH_TOKEN!,
  },
})

console.log(await response.json())
