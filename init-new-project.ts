#!/usr/bin/env node

import { Vercel } from '@vercel/sdk'
import { customEnvironment, projectSettings, teamId } from './api/constants.ts'
import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'

const VERCEL_TOKEN = process.env.VERCEL_TOKEN
const PROJECT_DIR = process.argv[2]

if (!PROJECT_DIR) {
  console.error('Usage: node deploy.ts <directory-name>')
  console.error('Example: node deploy.ts angular-v16')
  process.exit(1)
}

if (!VERCEL_TOKEN) {
  console.error('Error: VERCEL_TOKEN is not set in .env')
  process.exit(1)
}

const vercel = new Vercel({ bearerToken: VERCEL_TOKEN })

async function getOrCreateProject(
  projectName: string,
): Promise<{ id: string; name: string }> {
  console.log('\nStep 1: Creating/linking Vercel project...')

  try {
    // Try to find existing project first
    const projects = await vercel.projects.getProjects({
      teamId: teamId,
      search: projectName,
    })

    const existingProject = projects.projects?.find(
      (p) => p.name === projectName,
    )

    if (existingProject && existingProject.id) {
      console.log(`✓ Project found: ${projectName} (ID: ${existingProject.id})`)
      return { id: existingProject.id, name: projectName }
    }

    // Create new project if it doesn't exist
    const newProject = await vercel.projects.createProject({
      teamId: teamId,
      requestBody: {
        name: projectName,
        ...projectSettings,
      },
    })

    if (!newProject.id) {
      throw new Error('Failed to create project - no ID returned')
    }

    console.log(`✓ Project created: ${projectName} (ID: ${newProject.id})`)
    return { id: newProject.id, name: projectName }
  } catch (error) {
    console.error('Error creating/finding project:', error)
    throw error
  }
}

async function createCustomEnvironment(projectId: string): Promise<string> {
  console.log(`\nStep 2: Creating '${customEnvironment}' custom environment...`)

  try {
    // Check if environment already exists
    const existingEnvs =
      await vercel.environment.getV9ProjectsIdOrNameCustomEnvironments({
        idOrName: projectId,
        teamId: teamId,
      })

    const existingEnv = existingEnvs.environments?.find(
      (env) => env.slug === customEnvironment,
    )

    if (existingEnv?.id) {
      console.log(
        `✓ Custom environment '${customEnvironment}' already exists (ID: ${existingEnv.id})`,
      )
      return existingEnv.id
    }

    // Create the custom environment
    const newEnv = await vercel.environment.createCustomEnvironment({
      idOrName: projectId,
      teamId: teamId,
      requestBody: {
        slug: customEnvironment,
        description: 'VSR test environment',
      },
    })

    if (!newEnv.id) {
      throw new Error('Failed to create custom environment - no ID returned')
    }

    console.log(
      `✓ Custom environment '${customEnvironment}' created successfully (ID: ${newEnv.id})`,
    )
    return newEnv.id
  } catch (error) {
    console.error('Error creating custom environment:', error)
    throw error
  }
}

function getAllFiles(dir: string): Array<{ file: string; data: string }> {
  const files: Array<{ file: string; data: string }> = []
  const entries = readdirSync(dir, { withFileTypes: true, recursive: true })

  for (const entry of entries) {
    if (entry.isFile()) {
      const fullPath = join(entry.path || dir, entry.name)
      const relativePath = relative(dir, fullPath)
      const content = readFileSync(fullPath, 'utf-8')
      files.push({
        file: relativePath,
        data: content,
      })
    }
  }

  return files
}

async function setEnvironmentVariables(
  projectId: string,
  customEnvId: string,
): Promise<void> {
  console.log('\nStep 3: Setting environment variables...')

  // Set VERCEL_FORCE_NO_BUILD_CACHE for all environments (standard + custom)
  console.log('  Setting VERCEL_FORCE_NO_BUILD_CACHE=1 for all environments...')
  await vercel.projects.createProjectEnv({
    idOrName: projectId,
    teamId: teamId,
    upsert: 'true',
    requestBody: {
      key: 'VERCEL_FORCE_NO_BUILD_CACHE',
      value: '1',
      type: 'plain',
      target: ['production', 'preview', 'development'],
      customEnvironmentIds: [customEnvId],
    },
  })
  console.log('✓ VERCEL_FORCE_NO_BUILD_CACHE set for all environments')

  // Set NPM_CONFIG_REGISTRY for custom environment only
  console.log(
    `  Setting NPM_CONFIG_REGISTRY for '${customEnvironment}' environment...`,
  )
  await vercel.projects.createProjectEnv({
    idOrName: projectId,
    teamId: teamId,
    upsert: 'true',
    requestBody: {
      key: 'NPM_CONFIG_REGISTRY',
      value: 'https://vsr-on-vercel.vercel.app/npm/',
      type: 'plain',
      customEnvironmentIds: [customEnvId],
    },
  })
  console.log(
    `✓ NPM_CONFIG_REGISTRY set for '${customEnvironment}' environment`,
  )
}

async function createInitialDeployment(
  projectName: string,
  projectDir: string,
  options:
    | { target: 'production' | 'preview' }
    | { customEnvironmentSlugOrId: string },
): Promise<string> {
  const environmentType = 'target' in options ? options.target : 'custom'

  try {
    // Get all files from the project directory
    const projectPath = join(process.cwd(), 'packages', projectDir)
    const files = getAllFiles(projectPath)

    console.log(`  Found ${files.length} files to deploy`)

    // Create deployment with all project files
    const deployment = await vercel.deployments.createDeployment({
      teamId: teamId,
      skipAutoDetectionConfirmation: '1',
      requestBody: {
        name: projectName,
        ...options,
        files: files.map((f) => ({
          file: f.file,
          data: f.data,
          encoding: 'utf-8',
        })),
        projectSettings: {
          ...projectSettings,
        },
      },
    })

    return deployment.url || ''
  } catch (error) {
    console.error(`Error creating ${environmentType} deployment:`, error)
    throw error
  }
}

async function triggerDeployments(
  projectName: string,
  projectDir: string,
  customEnvId: string,
): Promise<{ production: string; custom: string }> {
  console.log('\nStep 4: Creating initial deployments...')

  // Create production deployment
  console.log('  Creating production deployment...')
  const prodUrl = await createInitialDeployment(projectName, projectDir, {
    target: 'production',
  })
  console.log(`✓ Production deployment created: https://${prodUrl}`)

  // Create custom environment deployment
  console.log(`  Creating ${customEnvironment} environment deployment...`)
  const customUrl = await createInitialDeployment(projectName, projectDir, {
    customEnvironmentSlugOrId: customEnvId,
  })
  console.log(`✓ ${customEnvironment} deployment created: https://${customUrl}`)

  return { production: prodUrl, custom: customUrl }
}

async function main() {
  const projectName = `benchmark-${PROJECT_DIR}`

  console.log('========================================')
  console.log(`Setting up Vercel project: ${projectName}`)
  console.log('========================================')

  try {
    // Step 1: Get or create project
    const project = await getOrCreateProject(projectName)

    // Step 2: Create custom environment
    const customEnvId = await createCustomEnvironment(project.id)

    // Step 3: Set environment variables
    await setEnvironmentVariables(project.id, customEnvId)

    // Step 4: Create initial deployments
    const { production, custom } = await triggerDeployments(
      projectName,
      PROJECT_DIR,
      customEnvId,
    )

    console.log('\n========================================')
    console.log('✓ All done!')
    console.log('========================================')
    console.log(`Project: ${projectName} (ID: ${project.id})`)
    console.log(`Custom Environment: ${customEnvironment} (ID: ${customEnvId})`)
    console.log(`Production: https://${production}`)
    console.log(`Custom (${customEnvironment}): https://${custom}`)
    console.log('========================================')
  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

main()
