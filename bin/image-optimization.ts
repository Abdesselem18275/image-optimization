#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PublicHostedZone } from 'aws-cdk-lib/aws-route53';
import 'source-map-support/register';
import { ssmParamVal, ssmParamsSuffix } from "../../globals/ssm-keys";
import { prodEnv, stagingEnv } from '../env';
import { BuildConfig } from '../lib/build-config';
import { ImageOptimizationStack } from '../lib/image-optimization-stack';

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
const env = {
  region: app.node.tryGetContext('AWSProfileRegion'),
  account: app.node.tryGetContext('AWSAccountID')
}
async function Main() {
  const stackName = `${buildConfig.stage}-img-transformation-stack`
  const domainName = `media.${buildConfig.baseHost}`
  const usEast1Stack = new cdk.Stack(app, buildConfig.stage + 'MedicalImageOptUsEast1Stack', {
    env: {
      ...env,
      region: 'us-east-1'
    },
    crossRegionReferences: true

  })
  const euWest1Stack = new cdk.Stack(app, buildConfig.stage + 'MedicalImageOptEuWest1Stack', {
    env,
    crossRegionReferences: true

  })
  const altDomainNames = [domainName]
  const cert = new cdk.aws_certificatemanager.Certificate(usEast1Stack, 'Cert', {
    domainName: `*.${buildConfig.baseHost}`,
    subjectAlternativeNames: altDomainNames,
    validation: cdk.aws_certificatemanager.CertificateValidation.fromDns(
      PublicHostedZone.fromHostedZoneId(
        usEast1Stack, 'Zone', ssmParamVal(euWest1Stack, buildConfig.stage, ssmParamsSuffix.hostedZoneId)))
  })
  console.log(buildConfig)
  new ImageOptimizationStack(app, stackName, {
    env: {
      region: app.node.tryGetContext("AWSProfileRegion"),
      account: app.node.tryGetContext("AWSAccountID"),
    },
    certificate: cert,
    domainName: domainName,
    crossRegionReferences: true,
    ...buildConfig
  });

}
Main()