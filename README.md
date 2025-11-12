# vsr-vercel-benchmarks

This is scaffolding for creating `vsr` benchmarks on Vercel and then gathering results for them.

This repo itself is a Vercel project that has routes for:

- `/deploy` triggering deploy on all or a filtered set of benchmark builds
- `/get-latest-deployments` get an array of the last deployment for all or a filtered set of benchmark builds

It also contains an `init-new-project.ts` script that will:

- Create/update a Vercel project
- Add the correct environments and environment variables
- Trigger the initial deployments
