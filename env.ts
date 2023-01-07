import { BuildConfig } from './lib/build-config'

export const prodEnv = new BuildConfig({
  baseHost : 'doctorus.io',
  keyGroupId : 'bc6fcc89-9ebe-4914-89c9-aeea66f20e69',
  stage:'prod'})

export const stagingEnv = new BuildConfig({
  baseHost : 'staging.doctorus.io',
  keyGroupId : 'dd46c341-eacb-40ae-b36f-fb2519098df2',
  stage:'staging'})