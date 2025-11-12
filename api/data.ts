export const customEnvironment = 'vsr'

export const environments = [
  'production', // default is npm
  customEnvironment,
] as const

export const teamId = 'team_I0bmFHPp3qnoaSnAA6xP70tU'

export const projectSettings = {
  installCommand: 'npm install --timing --loglevel=http',
  buildCommand: 'mkdir dist && echo "hello world" > dist/index.html',
} as const
