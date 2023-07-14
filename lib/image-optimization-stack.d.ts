import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BuildConfig } from './build-config';
export declare class ImageOptimizationStack extends Stack {
    constructor(scope: Construct, id: string, buildConfig: BuildConfig, props?: StackProps);
}
