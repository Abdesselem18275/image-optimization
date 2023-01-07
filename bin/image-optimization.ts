#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ImageOptimizationStack } from '../lib/image-optimization-stack';
import { BuildConfig } from '../lib/build-config';
import { prodEnv, stagingEnv } from '../env';

function getConfig(): BuildConfig {
    const env = app.node.tryGetContext('config')
    if (!env) {
      throw new Error(
        'Context variable missing on CDK command. Pass in as `-c config=XXX`'
      )
    }
  
    return env === 'prod' ? prodEnv : stagingEnv
  }

const app = new cdk.App();
const buildConfig = getConfig()
const stackName = `${buildConfig.stage}-img-transformation-stack`
new ImageOptimizationStack(app,stackName,buildConfig,     {
    env: {
      region: buildConfig.awsProfileRegion,
      account: buildConfig.awsAccountId.toString()
    }
  });

