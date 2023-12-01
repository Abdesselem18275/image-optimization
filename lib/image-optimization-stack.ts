// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from 'aws-cdk-lib';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps, aws_cloudfront as cloudfront, aws_iam as iam, aws_lambda as lambda, aws_logs as logs, aws_cloudfront_origins as origins, aws_s3 as s3 } from 'aws-cdk-lib';
import { BehaviorOptions } from 'aws-cdk-lib/aws-cloudfront';
import { Construct } from 'constructs';
import { createHash } from 'node:crypto';
import { MyCustomResource } from './my-custom-resource';

// Region to Origin Shield mapping based on latency. to be updated when new Regional Edge Caches are added to CloudFront.
const ORIGIN_SHIELD_MAPPING = new Map([['af-south-1', 'eu-west-2'], ['ap-east-1', 'ap-northeast-2'], ['ap-northeast-1', 'ap-northeast-1'], [
  'ap-northeast-2', 'ap-northeast-2'], ['ap-northeast-3', 'ap-northeast-1'], ['ap-south-1', 'ap-south-1'], ['ap-southeast-1', 'ap-southeast-1'], [
  'ap-southeast-2', 'ap-southeast-2'], ['ca-central-1', 'us-east-1'], ['eu-central-1', 'eu-central-1'], ['eu-north-1', 'eu-central-1'], [
  'eu-south-1', 'eu-central-1'], ['eu-west-1', 'eu-west-1'], ['eu-west-2', 'eu-west-2'], ['eu-west-3', 'eu-west-2'], ['me-south-1', 'ap-south-1'], [
  'sa-east-1', 'sa-east-1'], ['us-east-1', 'us-east-1'], ['us-east-2', 'us-east-2'], ['us-west-1', 'us-west-1'], ['us-west-2', 'us-west-2']]);

// Stack Parameters

// CloudFront parameters
// Parameters of transformed images
// Lambda Parameters
let LAMBDA_MEMORY = '1500';
let LAMBDA_TIMEOUT = '60';
let LOG_TIMING = 'false';


type LambdaEnv = {
  originalImageBucketName: string,
  transformedImageBucketName?: any;
  transformedImageCacheTTL: string,
  secretKey: string,
  logTiming: string,
}

interface ImageOptimizationProps extends StackProps {
  readonly optimizedImageExpDur: number
  readonly optimizedCacheTtl: string
  readonly awsAccountId: number
  // readonly awsProfileRegion: string
  readonly storeTransformedImages: boolean
  readonly keyGroupId: string
  readonly baseHost: string
  readonly certificate: cdk.aws_certificatemanager.ICertificate
  readonly domainName: string
  readonly stage: "prod" | "staging"
}

export class ImageOptimizationStack extends Stack {
  constructor(scope: Construct, id: string, props: ImageOptimizationProps) {
    super(scope, id, props);

    // Change stack parameters based on provided context
    // related to architecture. If set to false, transformed images are not stored in S3, and all image requests land on Lambda
    const S3_TRANSFORMED_IMAGE_EXPIRATION_DURATION = props.optimizedImageExpDur
    const S3_TRANSFORMED_IMAGE_CACHE_TTL = props.optimizedCacheTtl
    const S3_IMAGE_BUCKET_NAME = `${props.stage}-doctorus-media`
    const CLOUDFRONT_ORIGIN_SHIELD_REGION = ORIGIN_SHIELD_MAPPING.get((props.env?.region as string) ?? (process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION));
    const CLOUDFRONT_CORS_ENABLED = true
    LAMBDA_MEMORY = this.node.tryGetContext('LAMBDA_MEMORY') || LAMBDA_MEMORY;
    LAMBDA_TIMEOUT = this.node.tryGetContext('LAMBDA_TIMEOUT') || LAMBDA_TIMEOUT;
    LOG_TIMING = this.node.tryGetContext('LOG_TIMING') || LOG_TIMING;

    // Create secret key to be used between CloudFront and Lambda URL for access control
    const SECRET_KEY = createHash('md5').update(this.node.addr).digest('hex');

    // For the bucket having original images, either use an external one, or create one with some samples photos.

    const originalImageBucket = s3.Bucket.fromBucketName(this, 'imported-original-image-bucket', S3_IMAGE_BUCKET_NAME);
    new CfnOutput(this, 'OriginalImagesS3Bucket', {
      description: 'S3 bucket where original images are stored',
      value: originalImageBucket.bucketName
    });

    // create bucket for transformed images if enabled in the architecture
    const transformedImageBucket = new s3.Bucket(this, 's3-transformed-image-bucket', {
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ACLS,
      lifecycleRules: [
        {
          expiration: Duration.days(S3_TRANSFORMED_IMAGE_EXPIRATION_DURATION),
        },
      ],
    });

    // prepare env variable for Lambda 
    const lambdaEnv: LambdaEnv = {
      originalImageBucketName: originalImageBucket.bucketName,
      transformedImageCacheTTL: S3_TRANSFORMED_IMAGE_CACHE_TTL,
      secretKey: SECRET_KEY,
      logTiming: LOG_TIMING,
    };
    if (transformedImageBucket) lambdaEnv.transformedImageBucketName = transformedImageBucket.bucketName;

    // IAM policy to read from the S3 bucket containing the original images
    const s3ReadOriginalImagesPolicy = new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: ['arn:aws:s3:::' + originalImageBucket.bucketName + '/*'],
    });

    // statements of the IAM policy to attach to Lambda
    const iamPolicyStatements = [s3ReadOriginalImagesPolicy];

    // Create Lambda for image processing
    const imageProcessing = new lambda.Function(this, 'image-optimization', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      // functionName: props.stage + 'medical-images-optimisation',
      code: lambda.Code.fromAsset('functions/image-processing'),
      timeout: Duration.seconds(parseInt(LAMBDA_TIMEOUT)),
      memorySize: parseInt(LAMBDA_MEMORY),
      environment: lambdaEnv,
      logRetention: logs.RetentionDays.ONE_DAY,
    });

    // Enable Lambda URL
    const imageProcessingURL = imageProcessing.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // Leverage a custom resource to get the hostname of the LambdaURL
    const imageProcessingHelper = new MyCustomResource(this, 'customResource', {
      Url: imageProcessingURL.url
    });

    // Create a CloudFront origin: S3 with fallback to Lambda when image needs to be transformed, otherwise with Lambda as sole origin

    const imageOrigin = new origins.OriginGroup({
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
    const s3WriteTransformedImagesPolicy = new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: ['arn:aws:s3:::' + transformedImageBucket.bucketName + '/*'],
    });
    iamPolicyStatements.push(s3WriteTransformedImagesPolicy);

    // attach iam policy to the role assumed by Lambda
    imageProcessing.role?.attachInlinePolicy(
      new iam.Policy(this, 'read-write-bucket-policy', {
        statements: iamPolicyStatements,
      }),
    );

    // Create a CloudFront Function for url rewrites
    const urlRewriteFunction = new cloudfront.Function(this, 'urlRewrite', {
      code: cloudfront.FunctionCode.fromFile({ filePath: 'functions/url-rewrite/index.js', }),
      functionName: `urlRewriteFunction${this.node.addr}`,
    });

    const keyGroup = cloudfront.KeyGroup.fromKeyGroupId(this, 'MyKeyGroup', props.keyGroupId)

    let imageDeliveryCacheBehaviorConfig: BehaviorOptions = {
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
    const oai = new cloudfront.OriginAccessIdentity(this, 'MedicalDocumentOai')
    const originalImageBucketOrigin = new origins.S3Origin(originalImageBucket, {
      originAccessIdentity: oai

    })
    const policyStatement = new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [originalImageBucket.arnForObjects("*")],
      principals: [oai.grantPrincipal],
    });

    const bucketPolicy = new s3.BucketPolicy(this, 'cloudfrontAccessBucketPolicy', {
      bucket: originalImageBucket,
    })
    bucketPolicy.document.addStatements(policyStatement);

    let documentDeliveryCacheBehaviorConfig: BehaviorOptions = {
      origin: originalImageBucketOrigin,
      compress: false,
      responseHeadersPolicy: cdk.aws_cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
      originRequestPolicy: cdk.aws_cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
      allowedMethods: cdk.aws_cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,

      // cachePolicy: new cloudfront.CachePolicy(this, `ImageCachePolicy${this.node.addr}`, {
      //   defaultTtl: Duration.hours(24),
      //   maxTtl: Duration.days(365),
      //   minTtl: Duration.seconds(0),
      //   queryStringBehavior: cloudfront.CacheQueryStringBehavior.all()
      // }),
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED_FOR_UNCOMPRESSED_OBJECTS,
      cachedMethods: cdk.aws_cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      trustedKeyGroups: [
        keyGroup,
      ],
    }

    if (CLOUDFRONT_CORS_ENABLED) {
      // Creating a custom response headers policy. CORS allowed for all origins.
      const imageResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, `ImageResponseHeadersPolicy${this.node.addr}`, {
        responseHeadersPolicyName: `${props.stage}ImageResponsePolicy`,
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
      const documentResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, `DocumentResponseHeadersPolicy${this.node.addr}`, {
        responseHeadersPolicyName: `${props.stage}DocumentResponsePolicy`,
        corsBehavior: {
          accessControlAllowCredentials: false,
          accessControlAllowHeaders: ['*'],
          accessControlAllowMethods: ['GET'],
          accessControlAllowOrigins: ['*'],
          accessControlMaxAge: Duration.seconds(600),
          originOverride: false,
        }
      });
      imageDeliveryCacheBehaviorConfig = {
        ...imageDeliveryCacheBehaviorConfig,
        responseHeadersPolicy: imageResponseHeadersPolicy
      }
      documentDeliveryCacheBehaviorConfig = {
        ...documentDeliveryCacheBehaviorConfig,
        responseHeadersPolicy: documentResponseHeadersPolicy
      }
    }
    //const domainName = `media.${props.baseHost}`

    const documentDelivery = new cloudfront.Distribution(this, 'DocumentDeliveryDistribution', {
      comment: 'medical document delivery with optimization of image',
      domainNames: [props.domainName],
      certificate: props.certificate,
      // certificate: cdk.aws_certificatemanager.Certificate.fromCertificateArn(this, "Certificate", cdk.aws_ssm.StringParameter.fromStringParameterAttributes(this, 'certificate', {
      //   parameterName: ssmParamKey(props.stage, ssmParamsSuffix.cfCertArn),
      //   // 'version' can be specified but is optional.
      // }).stringValue),
      defaultBehavior: imageDeliveryCacheBehaviorConfig
    });

    documentDelivery.addBehavior('/medical-documents/*', originalImageBucketOrigin, documentDeliveryCacheBehaviorConfig)




    const hostedZone = cdk.aws_route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.baseHost
    })

    new cdk.aws_route53.ARecord(this, "AliasRecordA", {
      zone: hostedZone,
      recordName: props.domainName,
      deleteExisting: true,
      target: cdk.aws_route53.RecordTarget.fromAlias(
        new cdk.aws_route53_targets.CloudFrontTarget(documentDelivery)
      ),
    });
    new cdk.aws_route53.AaaaRecord(this, "AliasRecordAAAA", {
      zone: hostedZone,
      recordName: props.domainName,
      deleteExisting: true,
      target: cdk.aws_route53.RecordTarget.fromAlias(
        new cdk.aws_route53_targets.CloudFrontTarget(documentDelivery)
      ),
    });

    new CfnOutput(this, 'ImageDeliveryDomain', {
      description: 'Domain name of image delivery',
      value: documentDelivery.distributionDomainName
    });
  }
}
