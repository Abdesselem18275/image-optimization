// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from 'aws-cdk-lib'
import { Stack, StackProps, RemovalPolicy, aws_s3 as s3, aws_s3_deployment as s3deploy, aws_cloudfront as cloudfront, aws_cloudfront_origins as origins, aws_lambda as lambda, aws_iam as iam, Duration, CfnOutput, aws_logs as logs} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { MyCustomResource } from './my-custom-resource';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { BuildConfig } from './build-config';
import { BehaviorOptions } from 'aws-cdk-lib/aws-cloudfront';
import { ssmParamKey, ssmParamVal, ssmParamsSuffix } from '../../globals/ssm-keys'

// Region to Origin Shield mapping based on latency. to be updated when new Regional Edge Caches are added to CloudFront.
const ORIGIN_SHIELD_MAPPING = new Map([['af-south-1', 'eu-west-2'], [ 'ap-east-1' ,'ap-northeast-2'], [ 'ap-northeast-1', 'ap-northeast-1'], [
  'ap-northeast-2', 'ap-northeast-2'], [ 'ap-northeast-3', 'ap-northeast-1'], [ 'ap-south-1', 'ap-south-1'], [ 'ap-southeast-1','ap-southeast-1'], [ 
  'ap-southeast-2', 'ap-southeast-2'], [ 'ca-central-1', 'us-east-1'], [ 'eu-central-1', 'eu-central-1'], [ 'eu-north-1','eu-central-1'], [
  'eu-south-1','eu-central-1'], [ 'eu-west-1', 'eu-west-1'], [ 'eu-west-2', 'eu-west-2'], [ 'eu-west-3', 'eu-west-2'], [ 'me-south-1', 'ap-south-1'], [
  'sa-east-1', 'sa-east-1'], [ 'us-east-1', 'us-east-1'], [ 'us-east-2','us-east-2'], [ 'us-west-1', 'us-west-1'], [ 'us-west-2', 'us-west-2']] );

// Stack Parameters

// CloudFront parameters
// Parameters of transformed images
// Lambda Parameters
var LAMBDA_MEMORY = '1500';
var LAMBDA_TIMEOUT = '60';
var LOG_TIMING = 'false';

type ImageDeliveryCacheBehaviorConfig = {
  origin: any;
  viewerProtocolPolicy: any;
  cachePolicy: any;
  functionAssociations: any;
  responseHeadersPolicy?:any;
};

type LambdaEnv = {
  originalImageBucketName: string,
  transformedImageBucketName?:any;
  transformedImageCacheTTL: string,
  secretKey: string,
  logTiming: string,
}

export class ImageOptimizationStack extends Stack {
  constructor(scope: Construct, id: string,buildConfig : BuildConfig, props?: StackProps) {
    super(scope, id, props);

    // Change stack parameters based on provided context
    // related to architecture. If set to false, transformed images are not stored in S3, and all image requests land on Lambda
    const STORE_TRANSFORMED_IMAGES = buildConfig.storeTransformedImages
    const S3_TRANSFORMED_IMAGE_EXPIRATION_DURATION = buildConfig.optimizedImageExpDur
    const S3_TRANSFORMED_IMAGE_CACHE_TTL = buildConfig.optimizedCacheTtl
    const S3_IMAGE_BUCKET_NAME = `${buildConfig.stage}-doctorus-media`
    const CLOUDFRONT_ORIGIN_SHIELD_REGION = ORIGIN_SHIELD_MAPPING.get(buildConfig.awsProfileRegion  ?? (process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION));
    const CLOUDFRONT_CORS_ENABLED = true
    LAMBDA_MEMORY = this.node.tryGetContext('LAMBDA_MEMORY') || LAMBDA_MEMORY;
    LAMBDA_TIMEOUT = this.node.tryGetContext('LAMBDA_TIMEOUT') || LAMBDA_TIMEOUT;
    LOG_TIMING = this.node.tryGetContext('LOG_TIMING') || LOG_TIMING;

    // Create secret key to be used between CloudFront and Lambda URL for access control
    const SECRET_KEY = createHash('md5').update(this.node.addr).digest('hex') ;

    // For the bucket having original images, either use an external one, or create one with some samples photos.
    var originalImageBucket;
    var transformedImageBucket;

    originalImageBucket = s3.Bucket.fromBucketName(this,'imported-original-image-bucket', S3_IMAGE_BUCKET_NAME);
    new CfnOutput(this, 'OriginalImagesS3Bucket', {
      description: 'S3 bucket where original images are stored',
      value: originalImageBucket.bucketName
    });  

    // create bucket for transformed images if enabled in the architecture
    if (STORE_TRANSFORMED_IMAGES) {
      transformedImageBucket = new s3.Bucket(this, 's3-transformed-image-bucket', {
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true, 
        lifecycleRules: [
            {
              expiration: Duration.days(S3_TRANSFORMED_IMAGE_EXPIRATION_DURATION),
            },
          ],
      });
    }

    // prepare env variable for Lambda 
    var lambdaEnv: LambdaEnv = {
      originalImageBucketName: originalImageBucket.bucketName,
      transformedImageCacheTTL: S3_TRANSFORMED_IMAGE_CACHE_TTL,
      secretKey: SECRET_KEY,
      logTiming: LOG_TIMING,
    };
    if (transformedImageBucket) lambdaEnv.transformedImageBucketName = transformedImageBucket.bucketName;

    // IAM policy to read from the S3 bucket containing the original images
    const s3ReadOriginalImagesPolicy = new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: ['arn:aws:s3:::'+originalImageBucket.bucketName+'/*'],
    });

    // statements of the IAM policy to attach to Lambda
    var iamPolicyStatements = [s3ReadOriginalImagesPolicy];

    // Create Lambda for image processing
    var lambdaProps = {
      runtime: lambda.Runtime.NODEJS_16_X, 
      handler: 'index.handler',
      code: lambda.Code.fromAsset('functions/image-processing'),
      timeout: Duration.seconds(parseInt(LAMBDA_TIMEOUT)),
      memorySize: parseInt(LAMBDA_MEMORY),
      environment: lambdaEnv,
      logRetention: logs.RetentionDays.ONE_DAY,
    };
    var imageProcessing = new lambda.Function(this, 'image-optimization', lambdaProps);

    // Enable Lambda URL
    const imageProcessingURL = imageProcessing.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // Leverage a custom resource to get the hostname of the LambdaURL
    const imageProcessingHelper = new MyCustomResource(this, 'customResource', {
      Url: imageProcessingURL.url
    });

    // Create a CloudFront origin: S3 with fallback to Lambda when image needs to be transformed, otherwise with Lambda as sole origin
    var imageOrigin;

    if (transformedImageBucket) {
      imageOrigin = new origins.OriginGroup ({
        primaryOrigin: new origins.S3Origin(transformedImageBucket, {
          originShieldRegion: CLOUDFRONT_ORIGIN_SHIELD_REGION,
        }),
        fallbackOrigin: new origins.HttpOrigin(imageProcessingHelper.hostname, {
          originShieldRegion: CLOUDFRONT_ORIGIN_SHIELD_REGION,
          customHeaders: {
            'x-origin-secret-header': SECRET_KEY,
          },
        }), 
        fallbackStatusCodes: [403],
      });

      // write policy for Lambda on the s3 bucket for transformed images
      var s3WriteTransformedImagesPolicy = new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: ['arn:aws:s3:::'+transformedImageBucket.bucketName+'/*'],
      });
      iamPolicyStatements.push(s3WriteTransformedImagesPolicy);
    } else {
      console.log("else transformedImageBucket");
      imageOrigin = new origins.HttpOrigin(imageProcessingHelper.hostname, {
        originShieldRegion: CLOUDFRONT_ORIGIN_SHIELD_REGION,
        customHeaders: {
          'x-origin-secret-header': SECRET_KEY,
        },
      });
    }

    // attach iam policy to the role assumed by Lambda
    imageProcessing.role?.attachInlinePolicy(
      new iam.Policy(this, 'read-write-bucket-policy', {
        statements: iamPolicyStatements,
      }),
    );

    // Create a CloudFront Function for url rewrites
    const urlRewriteFunction = new cloudfront.Function(this, 'urlRewrite', {
      code: cloudfront.FunctionCode.fromFile({filePath: 'functions/url-rewrite/index.js',}),
      functionName: `urlRewriteFunction${this.node.addr}`, 
    });
    
    const keyGroup = cloudfront.KeyGroup.fromKeyGroupId(this, 'MyKeyGroup',buildConfig.keyGroupId)

    var imageDeliveryCacheBehaviorConfig:BehaviorOptions  = {
      origin: imageOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: new cloudfront.CachePolicy(this, `ImageCachePolicy${this.node.addr}`, {
        defaultTtl: Duration.hours(24),
        maxTtl: Duration.days(365),
        minTtl: Duration.seconds(0),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.all()
      }),
      
      trustedKeyGroups: [
        keyGroup,
      ],
      functionAssociations: [{
        eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        function: urlRewriteFunction,
      }],
    }

    if (CLOUDFRONT_CORS_ENABLED) {
      // Creating a custom response headers policy. CORS allowed for all origins.
      const imageResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, `ResponseHeadersPolicy${this.node.addr}`, {
        responseHeadersPolicyName: `${buildConfig.stage}ImageResponsePolicy`,
        corsBehavior: {
          accessControlAllowCredentials: false,
          accessControlAllowHeaders: ['*'],
          accessControlAllowMethods: ['GET'],
          accessControlAllowOrigins: ['*'],
          accessControlMaxAge: Duration.seconds(600),
          originOverride: false,
        },
        // recognizing image requests that were processed by this solution
        customHeadersBehavior: {
          customHeaders: [
            { header: 'x-aws-image-optimization', value: 'v1.0', override: true },
            { header: 'vary', value: 'accept', override: true },
          ],
        }
      });  
      imageDeliveryCacheBehaviorConfig = {
        ...imageDeliveryCacheBehaviorConfig,
        responseHeadersPolicy : imageResponseHeadersPolicy
      }
    }
    const domainName = `media.${buildConfig.baseHost}`

    const imageDelivery = new cloudfront.Distribution(this, 'imageDeliveryDistribution', {
      comment: 'image optimization - image delivery',
      domainNames :[domainName],
      certificate :  cdk.aws_certificatemanager.Certificate.fromCertificateArn(this,"Certificate",cdk.aws_ssm.StringParameter.fromStringParameterAttributes(this, 'certificate', {
        parameterName: ssmParamKey(buildConfig.stage,ssmParamsSuffix.cfCertArn),
        // 'version' can be specified but is optional.
      }).stringValue),
      defaultBehavior: imageDeliveryCacheBehaviorConfig
    });

    const hostedZone = cdk.aws_route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: buildConfig.baseHost
    })
    
    new cdk.aws_route53.ARecord(this, "AliasRecordA", {
      zone: hostedZone,
      recordName: domainName,
      deleteExisting: true,
      target: cdk.aws_route53.RecordTarget.fromAlias(
        new cdk.aws_route53_targets.CloudFrontTarget(imageDelivery)
      ),
    });
    new cdk.aws_route53.AaaaRecord(this, "AliasRecordAAAA", {
      zone: hostedZone,
      recordName: domainName,
      deleteExisting: true,
      target: cdk.aws_route53.RecordTarget.fromAlias(
        new cdk.aws_route53_targets.CloudFrontTarget(imageDelivery)
      ),
    });

    new CfnOutput(this, 'ImageDeliveryDomain', {
      description: 'Domain name of image delivery',
      value: imageDelivery.distributionDomainName
    });
  }
}
