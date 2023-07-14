"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageOptimizationStack = void 0;
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const my_custom_resource_1 = require("./my-custom-resource");
const node_crypto_1 = require("node:crypto");
const ssm_keys_1 = require("../../globals/ssm-keys");
// Region to Origin Shield mapping based on latency. to be updated when new Regional Edge Caches are added to CloudFront.
const ORIGIN_SHIELD_MAPPING = new Map([['af-south-1', 'eu-west-2'], ['ap-east-1', 'ap-northeast-2'], ['ap-northeast-1', 'ap-northeast-1'], [
        'ap-northeast-2', 'ap-northeast-2'
    ], ['ap-northeast-3', 'ap-northeast-1'], ['ap-south-1', 'ap-south-1'], ['ap-southeast-1', 'ap-southeast-1'], [
        'ap-southeast-2', 'ap-southeast-2'
    ], ['ca-central-1', 'us-east-1'], ['eu-central-1', 'eu-central-1'], ['eu-north-1', 'eu-central-1'], [
        'eu-south-1', 'eu-central-1'
    ], ['eu-west-1', 'eu-west-1'], ['eu-west-2', 'eu-west-2'], ['eu-west-3', 'eu-west-2'], ['me-south-1', 'ap-south-1'], [
        'sa-east-1', 'sa-east-1'
    ], ['us-east-1', 'us-east-1'], ['us-east-2', 'us-east-2'], ['us-west-1', 'us-west-1'], ['us-west-2', 'us-west-2']]);
// Stack Parameters
// CloudFront parameters
// Parameters of transformed images
// Lambda Parameters
var LAMBDA_MEMORY = '1500';
var LAMBDA_TIMEOUT = '60';
var LOG_TIMING = 'false';
class ImageOptimizationStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, buildConfig, props) {
        var _a, _b;
        super(scope, id, props);
        // Change stack parameters based on provided context
        // related to architecture. If set to false, transformed images are not stored in S3, and all image requests land on Lambda
        const STORE_TRANSFORMED_IMAGES = buildConfig.storeTransformedImages;
        const S3_TRANSFORMED_IMAGE_EXPIRATION_DURATION = buildConfig.optimizedImageExpDur;
        const S3_TRANSFORMED_IMAGE_CACHE_TTL = buildConfig.optimizedCacheTtl;
        const S3_IMAGE_BUCKET_NAME = `${buildConfig.stage}-doctorus-media`;
        const CLOUDFRONT_ORIGIN_SHIELD_REGION = ORIGIN_SHIELD_MAPPING.get((_a = buildConfig.awsProfileRegion) !== null && _a !== void 0 ? _a : (process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION));
        const CLOUDFRONT_CORS_ENABLED = true;
        LAMBDA_MEMORY = this.node.tryGetContext('LAMBDA_MEMORY') || LAMBDA_MEMORY;
        LAMBDA_TIMEOUT = this.node.tryGetContext('LAMBDA_TIMEOUT') || LAMBDA_TIMEOUT;
        LOG_TIMING = this.node.tryGetContext('LOG_TIMING') || LOG_TIMING;
        // Create secret key to be used between CloudFront and Lambda URL for access control
        const SECRET_KEY = (0, node_crypto_1.createHash)('md5').update(this.node.addr).digest('hex');
        // For the bucket having original images, either use an external one, or create one with some samples photos.
        var originalImageBucket;
        var transformedImageBucket;
        originalImageBucket = aws_cdk_lib_1.aws_s3.Bucket.fromBucketName(this, 'imported-original-image-bucket', S3_IMAGE_BUCKET_NAME);
        new aws_cdk_lib_1.CfnOutput(this, 'OriginalImagesS3Bucket', {
            description: 'S3 bucket where original images are stored',
            value: originalImageBucket.bucketName
        });
        // create bucket for transformed images if enabled in the architecture
        transformedImageBucket = new aws_cdk_lib_1.aws_s3.Bucket(this, 's3-transformed-image-bucket', {
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            lifecycleRules: [
                {
                    expiration: aws_cdk_lib_1.Duration.days(S3_TRANSFORMED_IMAGE_EXPIRATION_DURATION),
                },
            ],
        });
        // prepare env variable for Lambda 
        var lambdaEnv = {
            originalImageBucketName: originalImageBucket.bucketName,
            transformedImageCacheTTL: S3_TRANSFORMED_IMAGE_CACHE_TTL,
            secretKey: SECRET_KEY,
            logTiming: LOG_TIMING,
        };
        if (transformedImageBucket)
            lambdaEnv.transformedImageBucketName = transformedImageBucket.bucketName;
        // IAM policy to read from the S3 bucket containing the original images
        const s3ReadOriginalImagesPolicy = new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['s3:GetObject'],
            resources: ['arn:aws:s3:::' + originalImageBucket.bucketName + '/*'],
        });
        // statements of the IAM policy to attach to Lambda
        var iamPolicyStatements = [s3ReadOriginalImagesPolicy];
        // Create Lambda for image processing
        var lambdaProps = {
            runtime: aws_cdk_lib_1.aws_lambda.Runtime.NODEJS_16_X,
            handler: 'index.handler',
            code: aws_cdk_lib_1.aws_lambda.Code.fromAsset('functions/image-processing'),
            timeout: aws_cdk_lib_1.Duration.seconds(parseInt(LAMBDA_TIMEOUT)),
            memorySize: parseInt(LAMBDA_MEMORY),
            environment: lambdaEnv,
            logRetention: aws_cdk_lib_1.aws_logs.RetentionDays.ONE_DAY,
        };
        var imageProcessing = new aws_cdk_lib_1.aws_lambda.Function(this, 'image-optimization', lambdaProps);
        // Enable Lambda URL
        const imageProcessingURL = imageProcessing.addFunctionUrl({
            authType: aws_cdk_lib_1.aws_lambda.FunctionUrlAuthType.NONE,
        });
        // Leverage a custom resource to get the hostname of the LambdaURL
        const imageProcessingHelper = new my_custom_resource_1.MyCustomResource(this, 'customResource', {
            Url: imageProcessingURL.url
        });
        // Create a CloudFront origin: S3 with fallback to Lambda when image needs to be transformed, otherwise with Lambda as sole origin
        var imageOrigin;
        imageOrigin = new aws_cdk_lib_1.aws_cloudfront_origins.OriginGroup({
            primaryOrigin: new aws_cdk_lib_1.aws_cloudfront_origins.S3Origin(transformedImageBucket, {
                originShieldRegion: CLOUDFRONT_ORIGIN_SHIELD_REGION,
            }),
            fallbackOrigin: new aws_cdk_lib_1.aws_cloudfront_origins.HttpOrigin(imageProcessingHelper.hostname, {
                originShieldRegion: CLOUDFRONT_ORIGIN_SHIELD_REGION,
                customHeaders: {
                    'x-origin-secret-header': SECRET_KEY,
                },
            }),
            fallbackStatusCodes: [403],
        });
        // write policy for Lambda on the s3 bucket for transformed images
        var s3WriteTransformedImagesPolicy = new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['s3:PutObject'],
            resources: ['arn:aws:s3:::' + transformedImageBucket.bucketName + '/*'],
        });
        iamPolicyStatements.push(s3WriteTransformedImagesPolicy);
        // attach iam policy to the role assumed by Lambda
        (_b = imageProcessing.role) === null || _b === void 0 ? void 0 : _b.attachInlinePolicy(new aws_cdk_lib_1.aws_iam.Policy(this, 'read-write-bucket-policy', {
            statements: iamPolicyStatements,
        }));
        // Create a CloudFront Function for url rewrites
        const urlRewriteFunction = new aws_cdk_lib_1.aws_cloudfront.Function(this, 'urlRewrite', {
            code: aws_cdk_lib_1.aws_cloudfront.FunctionCode.fromFile({ filePath: 'functions/url-rewrite/index.js', }),
            functionName: `urlRewriteFunction${this.node.addr}`,
        });
        const keyGroup = aws_cdk_lib_1.aws_cloudfront.KeyGroup.fromKeyGroupId(this, 'MyKeyGroup', buildConfig.keyGroupId);
        var imageDeliveryCacheBehaviorConfig = {
            origin: imageOrigin,
            viewerProtocolPolicy: aws_cdk_lib_1.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy: new aws_cdk_lib_1.aws_cloudfront.CachePolicy(this, `ImageCachePolicy${this.node.addr}`, {
                defaultTtl: aws_cdk_lib_1.Duration.hours(24),
                maxTtl: aws_cdk_lib_1.Duration.days(365),
                minTtl: aws_cdk_lib_1.Duration.seconds(0),
                queryStringBehavior: aws_cdk_lib_1.aws_cloudfront.CacheQueryStringBehavior.all()
            }),
            trustedKeyGroups: [
                keyGroup,
            ],
            functionAssociations: [{
                    eventType: aws_cdk_lib_1.aws_cloudfront.FunctionEventType.VIEWER_REQUEST,
                    function: urlRewriteFunction,
                }],
        };
        const oai = new aws_cdk_lib_1.aws_cloudfront.OriginAccessIdentity(this, 'MedicalDocumentOai');
        const originalImageBucketOrigin = new aws_cdk_lib_1.aws_cloudfront_origins.S3Origin(originalImageBucket, {
            originAccessIdentity: oai
        });
        const policyStatement = new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['s3:GetObject'],
            resources: [originalImageBucket.arnForObjects("*")],
            principals: [oai.grantPrincipal],
        });
        const bucketPolicy = new aws_cdk_lib_1.aws_s3.BucketPolicy(this, 'cloudfrontAccessBucketPolicy', {
            bucket: originalImageBucket,
        });
        bucketPolicy.document.addStatements(policyStatement);
        var documentDeliveryCacheBehaviorConfig = {
            origin: originalImageBucketOrigin,
            compress: false,
            responseHeadersPolicy: cdk.aws_cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
            originRequestPolicy: cdk.aws_cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
            allowedMethods: cdk.aws_cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
            viewerProtocolPolicy: aws_cdk_lib_1.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            // cachePolicy: new cloudfront.CachePolicy(this, `ImageCachePolicy${this.node.addr}`, {
            //   defaultTtl: Duration.hours(24),
            //   maxTtl: Duration.days(365),
            //   minTtl: Duration.seconds(0),
            //   queryStringBehavior: cloudfront.CacheQueryStringBehavior.all()
            // }),
            cachePolicy: aws_cdk_lib_1.aws_cloudfront.CachePolicy.CACHING_OPTIMIZED_FOR_UNCOMPRESSED_OBJECTS,
            cachedMethods: cdk.aws_cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
            trustedKeyGroups: [
                keyGroup,
            ],
        };
        if (CLOUDFRONT_CORS_ENABLED) {
            // Creating a custom response headers policy. CORS allowed for all origins.
            const imageResponseHeadersPolicy = new aws_cdk_lib_1.aws_cloudfront.ResponseHeadersPolicy(this, `ImageResponseHeadersPolicy${this.node.addr}`, {
                responseHeadersPolicyName: `${buildConfig.stage}ImageResponsePolicy`,
                corsBehavior: {
                    accessControlAllowCredentials: false,
                    accessControlAllowHeaders: ['*'],
                    accessControlAllowMethods: ['GET'],
                    accessControlAllowOrigins: ['*'],
                    accessControlMaxAge: aws_cdk_lib_1.Duration.seconds(600),
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
            const documentResponseHeadersPolicy = new aws_cdk_lib_1.aws_cloudfront.ResponseHeadersPolicy(this, `DocumentResponseHeadersPolicy${this.node.addr}`, {
                responseHeadersPolicyName: `${buildConfig.stage}DocumentResponsePolicy`,
                corsBehavior: {
                    accessControlAllowCredentials: false,
                    accessControlAllowHeaders: ['*'],
                    accessControlAllowMethods: ['GET'],
                    accessControlAllowOrigins: ['*'],
                    accessControlMaxAge: aws_cdk_lib_1.Duration.seconds(600),
                    originOverride: false,
                }
            });
            imageDeliveryCacheBehaviorConfig = {
                ...imageDeliveryCacheBehaviorConfig,
                responseHeadersPolicy: imageResponseHeadersPolicy
            };
            documentDeliveryCacheBehaviorConfig = {
                ...documentDeliveryCacheBehaviorConfig,
                responseHeadersPolicy: documentResponseHeadersPolicy
            };
        }
        const domainName = `media.${buildConfig.baseHost}`;
        const documentDelivery = new aws_cdk_lib_1.aws_cloudfront.Distribution(this, 'DocumentDeliveryDistribution', {
            comment: 'medical document delivery with optimization of image',
            domainNames: [domainName],
            certificate: cdk.aws_certificatemanager.Certificate.fromCertificateArn(this, "Certificate", cdk.aws_ssm.StringParameter.fromStringParameterAttributes(this, 'certificate', {
                parameterName: (0, ssm_keys_1.ssmParamKey)(buildConfig.stage, ssm_keys_1.ssmParamsSuffix.cfCertArn),
                // 'version' can be specified but is optional.
            }).stringValue),
            defaultBehavior: imageDeliveryCacheBehaviorConfig
        });
        documentDelivery.addBehavior('/medical-documents/*', originalImageBucketOrigin, documentDeliveryCacheBehaviorConfig);
        const hostedZone = cdk.aws_route53.HostedZone.fromLookup(this, 'HostedZone', {
            domainName: buildConfig.baseHost
        });
        new cdk.aws_route53.ARecord(this, "AliasRecordA", {
            zone: hostedZone,
            recordName: domainName,
            deleteExisting: true,
            target: cdk.aws_route53.RecordTarget.fromAlias(new cdk.aws_route53_targets.CloudFrontTarget(documentDelivery)),
        });
        new cdk.aws_route53.AaaaRecord(this, "AliasRecordAAAA", {
            zone: hostedZone,
            recordName: domainName,
            deleteExisting: true,
            target: cdk.aws_route53.RecordTarget.fromAlias(new cdk.aws_route53_targets.CloudFrontTarget(documentDelivery)),
        });
        new aws_cdk_lib_1.CfnOutput(this, 'ImageDeliveryDomain', {
            description: 'Domain name of image delivery',
            value: documentDelivery.distributionDomainName
        });
    }
}
exports.ImageOptimizationStack = ImageOptimizationStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW1hZ2Utb3B0aW1pemF0aW9uLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiaW1hZ2Utb3B0aW1pemF0aW9uLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHFFQUFxRTtBQUNyRSxpQ0FBaUM7QUFDakMsbUNBQWtDO0FBQ2xDLDZDQUF5UDtBQUV6UCw2REFBd0Q7QUFDeEQsNkNBQThEO0FBRzlELHFEQUFrRjtBQUVsRix5SEFBeUg7QUFDekgsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLENBQUMsWUFBWSxFQUFFLFdBQVcsQ0FBQyxFQUFFLENBQUUsV0FBVyxFQUFFLGdCQUFnQixDQUFDLEVBQUUsQ0FBRSxnQkFBZ0IsRUFBRSxnQkFBZ0IsQ0FBQyxFQUFFO1FBQzNJLGdCQUFnQixFQUFFLGdCQUFnQjtLQUFDLEVBQUUsQ0FBRSxnQkFBZ0IsRUFBRSxnQkFBZ0IsQ0FBQyxFQUFFLENBQUUsWUFBWSxFQUFFLFlBQVksQ0FBQyxFQUFFLENBQUUsZ0JBQWdCLEVBQUMsZ0JBQWdCLENBQUMsRUFBRTtRQUNqSixnQkFBZ0IsRUFBRSxnQkFBZ0I7S0FBQyxFQUFFLENBQUUsY0FBYyxFQUFFLFdBQVcsQ0FBQyxFQUFFLENBQUUsY0FBYyxFQUFFLGNBQWMsQ0FBQyxFQUFFLENBQUUsWUFBWSxFQUFDLGNBQWMsQ0FBQyxFQUFFO1FBQ3hJLFlBQVksRUFBQyxjQUFjO0tBQUMsRUFBRSxDQUFFLFdBQVcsRUFBRSxXQUFXLENBQUMsRUFBRSxDQUFFLFdBQVcsRUFBRSxXQUFXLENBQUMsRUFBRSxDQUFFLFdBQVcsRUFBRSxXQUFXLENBQUMsRUFBRSxDQUFFLFlBQVksRUFBRSxZQUFZLENBQUMsRUFBRTtRQUNwSixXQUFXLEVBQUUsV0FBVztLQUFDLEVBQUUsQ0FBRSxXQUFXLEVBQUUsV0FBVyxDQUFDLEVBQUUsQ0FBRSxXQUFXLEVBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBRSxXQUFXLEVBQUUsV0FBVyxDQUFD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dEIsY0FBYyxFQUFFLElBQUk7WUFDcEIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxXQUFXLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FDNUMsSUFBSSxHQUFHLENBQUMsbUJBQW1CLENBQUMsZ0JBQWdCLENBQUMsZ0JBQWdCLENBQUMsQ0FDL0Q7U0FDRixDQUFDLENBQUM7UUFDSCxJQUFJLEdBQUcsQ0FBQyxXQUFXLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUN0RCxJQUFJLEVBQUUsVUFBVTtZQUNoQixVQUFVLEVBQUUsVUFBVTtZQUN0QixjQUFjLEVBQUUsSUFBSTtZQUNwQixNQUFNLEVBQUUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUM1QyxJQUFJLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQyxnQkFBZ0IsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUMvRDtTQUNGLENBQUMsQ0FBQztRQUVILElBQUksdUJBQVMsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDekMsV0FBVyxFQUFFLCtCQUErQjtZQUM1QyxLQUFLLEVBQUUsZ0JBQWdCLENBQUMsc0JBQXNCO1NBQy9DLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQS9QRCx3REErUEMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgQW1hem9uLmNvbSwgSW5jLiBvciBpdHMgYWZmaWxpYXRlcy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cclxuLy8gU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IE1JVC0wXHJcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYidcclxuaW1wb3J0IHsgU3RhY2ssIFN0YWNrUHJvcHMsIFJlbW92YWxQb2xpY3ksIGF3c19zMyBhcyBzMywgYXdzX3MzX2RlcGxveW1lbnQgYXMgczNkZXBsb3ksIGF3c19jbG91ZGZyb250IGFzIGNsb3VkZnJvbnQsIGF3c19jbG91ZGZyb250X29yaWdpbnMgYXMgb3JpZ2lucywgYXdzX2xhbWJkYSBhcyBsYW1iZGEsIGF3c19pYW0gYXMgaWFtLCBEdXJhdGlvbiwgQ2ZuT3V0cHV0LCBhd3NfbG9ncyBhcyBsb2dzfSBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG5pbXBvcnQgeyBNeUN1c3RvbVJlc291cmNlIH0gZnJvbSAnLi9teS1jdXN0b20tcmVzb3VyY2UnO1xyXG5pbXBvcnQgeyBjcmVhdGVIYXNoLCBnZW5lcmF0ZUtleVBhaXJTeW5jIH0gZnJvbSAnbm9kZTpjcnlwdG8nO1xyXG5pbXBvcnQgeyBCdWlsZENvbmZpZyB9IGZyb20gJy4vYnVpbGQtY29uZmlnJztcclxuaW1wb3J0IHsgQmVoYXZpb3JPcHRpb25zIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQnO1xyXG5pbXBvcnQgeyBzc21QYXJhbUtleSwgc3NtUGFyYW1WYWwsIHNzbVBhcmFtc1N1ZmZpeCB9IGZyb20gJy4uLy4uL2dsb2JhbHMvc3NtLWtleXMnXHJcblxyXG4vLyBSZWdpb24gdG8gT3JpZ2luIFNoaWVsZCBtYXBwaW5nIGJhc2VkIG9uIGxhdGVuY3kuIHRvIGJlIHVwZGF0ZWQgd2hlbiBuZXcgUmVnaW9uYWwgRWRnZSBDYWNoZXMgYXJlIGFkZGVkIHRvIENsb3VkRnJvbnQuXHJcbmNvbnN0IE9SSUdJTl9TSElFTERfTUFQUElORyA9IG5ldyBNYXAoW1snYWYtc291dGgtMScsICdldS13ZXN0LTInXSwgWyAnYXAtZWFzdC0xJyAsJ2FwLW5vcnRoZWFzdC0yJ10sIFsgJ2FwLW5vcnRoZWFzdC0xJywgJ2FwLW5vcnRoZWFzdC0xJ10sIFtcclxuICAnYXAtbm9ydGhlYXN0LTInLCAnYXAtbm9ydGhlYXN0LTInXSwgWyAnYXAtbm9ydGhlYXN0LTMnLCAnYXAtbm9ydGhlYXN0LTEnXSwgWyAnYXAtc291dGgtMScsICdhcC1zb3V0aC0xJ10sIFsgJ2FwLXNvdXRoZWFzdC0xJywnYXAtc291dGhlYXN0LTEnXSwgWyBcclxuICAnYXAtc291dGhlYXN0LTInLCAnYXAtc291dGhlYXN0LTInXSwgWyAnY2EtY2VudHJhbC0xJywgJ3VzLWVhc3QtMSddLCBbICdldS1jZW50cmFsLTEnLCAnZXUtY2VudHJhbC0xJ10sIFsgJ2V1LW5vcnRoLTEnLCdldS1jZW50cmFsLTEnXSwgW1xyXG4gICdldS1zb3V0aC0xJywnZXUtY2VudHJhbC0xJ10sIFsgJ2V1LXdlc3QtMScsICdldS13ZXN0LTEnXSwgWyAnZXUtd2VzdC0yJywgJ2V1LXdlc3QtMiddLCBbICdldS13ZXN0LTMnLCAnZXUtd2VzdC0yJ10sIFsgJ21lLXNvdXRoLTEnLCAnYXAtc291dGgtMSddLCBbXHJcbiAgJ3NhLWVhc3QtMScsICdzYS1lYXN0LTEnXSwgWyAndXMtZWFzdC0xJywgJ3VzLWVhc3QtMSddLCBbICd1cy1lYXN0LTInLCd1cy1lYXN0LTInXSwgWyAndXMtd2VzdC0xJywgJ3VzLXdlc3QtMSddLCBbICd1cy13ZXN0LTInLCAndXMtd2VzdC0yJ11dICk7XHJcblxyXG4vLyBTdGFjayBQYXJhbWV0ZXJzXHJcblxyXG4vLyBDbG91ZEZyb250IHBhcmFtZXRlcnNcclxuLy8gUGFyYW1ldGVycyBvZiB0cmFuc2Zvcm1lZCBpbWFnZXNcclxuLy8gTGFtYmRhIFBhcmFtZXRlcnNcclxudmFyIExBTUJEQV9NRU1PUlkgPSAnMTUwMCc7XHJcbnZhciBMQU1CREFfVElNRU9VVCA9ICc2MCc7XHJcbnZhciBMT0dfVElNSU5HID0gJ2ZhbHNlJztcclxuXHJcbnR5cGUgSW1hZ2VEZWxpdmVyeUNhY2hlQmVoYXZpb3JDb25maWcgPSB7XHJcbiAgb3JpZ2luOiBhbnk7XHJcbiAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGFueTtcclxuICBjYWNoZVBvbGljeTogYW55O1xyXG4gIGZ1bmN0aW9uQXNzb2NpYXRpb25zOiBhbnk7XHJcbiAgcmVzcG9uc2VIZWFkZXJzUG9saWN5Pzphbnk7XHJcbn07XHJcblxyXG50eXBlIExhbWJkYUVudiA9IHtcclxuICBvcmlnaW5hbEltYWdlQnVja2V0TmFtZTogc3RyaW5nLFxyXG4gIHRyYW5zZm9ybWVkSW1hZ2VCdWNrZXROYW1lPzphbnk7XHJcbiAgdHJhbnNmb3JtZWRJbWFnZUNhY2hlVFRMOiBzdHJpbmcsXHJcbiAgc2VjcmV0S2V5OiBzdHJpbmcsXHJcbiAgbG9nVGltaW5nOiBzdHJpbmcsXHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBJbWFnZU9wdGltaXphdGlvblN0YWNrIGV4dGVuZHMgU3RhY2sge1xyXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsYnVpbGRDb25maWcgOiBCdWlsZENvbmZpZywgcHJvcHM/OiBTdGFja1Byb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcclxuXHJcbiAgICAvLyBDaGFuZ2Ugc3RhY2sgcGFyYW1ldGVycyBiYXNlZCBvbiBwcm92aWRlZCBjb250ZXh0XHJcbiAgICAvLyByZWxhdGVkIHRvIGFyY2hpdGVjdHVyZS4gSWYgc2V0IHRvIGZhbHNlLCB0cmFuc2Zvcm1lZCBpbWFnZXMgYXJlIG5vdCBzdG9yZWQgaW4gUzMsIGFuZCBhbGwgaW1hZ2UgcmVxdWVzdHMgbGFuZCBvbiBMYW1iZGFcclxuICAgIGNvbnN0IFNUT1JFX1RSQU5TRk9STUVEX0lNQUdFUyA9IGJ1aWxkQ29uZmlnLnN0b3JlVHJhbnNmb3JtZWRJbWFnZXNcclxuICAgIGNvbnN0IFMzX1RSQU5TRk9STUVEX0lNQUdFX0VYUElSQVRJT05fRFVSQVRJT04gPSBidWlsZENvbmZpZy5vcHRpbWl6ZWRJbWFnZUV4cER1clxyXG4gICAgY29uc3QgUzNfVFJBTlNGT1JNRURfSU1BR0VfQ0FDSEVfVFRMID0gYnVpbGRDb25maWcub3B0aW1pemVkQ2FjaGVUdGxcclxuICAgIGNvbnN0IFMzX0lNQUdFX0JVQ0tFVF9OQU1FID0gYCR7YnVpbGRDb25maWcuc3RhZ2V9LWRvY3RvcnVzLW1lZGlhYFxyXG4gICAgY29uc3QgQ0xPVURGUk9OVF9PUklHSU5fU0hJRUxEX1JFR0lPTiA9IE9SSUdJTl9TSElFTERfTUFQUElORy5nZXQoYnVpbGRDb25maWcuYXdzUHJvZmlsZVJlZ2lvbiAgPz8gKHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OKSk7XHJcbiAgICBjb25zdCBDTE9VREZST05UX0NPUlNfRU5BQkxFRCA9IHRydWVcclxuICAgIExBTUJEQV9NRU1PUlkgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnTEFNQkRBX01FTU9SWScpIHx8IExBTUJEQV9NRU1PUlk7XHJcbiAgICBMQU1CREFfVElNRU9VVCA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdMQU1CREFfVElNRU9VVCcpIHx8IExBTUJEQV9USU1FT1VUO1xyXG4gICAgTE9HX1RJTUlORyA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdMT0dfVElNSU5HJykgfHwgTE9HX1RJTUlORztcclxuXHJcbiAgICAvLyBDcmVhdGUgc2VjcmV0IGtleSB0byBiZSB1c2VkIGJldHdlZW4gQ2xvdWRGcm9udCBhbmQgTGFtYmRhIFVSTCBmb3IgYWNjZXNzIGNvbnRyb2xcclxuICAgIGNvbnN0IFNFQ1JFVF9LRVkgPSBjcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUodGhpcy5ub2RlLmFkZHIpLmRpZ2VzdCgnaGV4JykgO1xyXG5cclxuICAgIC8vIEZvciB0aGUgYnVja2V0IGhhdmluZyBvcmlnaW5hbCBpbWFnZXMsIGVpdGhlciB1c2UgYW4gZXh0ZXJuYWwgb25lLCBvciBjcmVhdGUgb25lIHdpdGggc29tZSBzYW1wbGVzIHBob3Rvcy5cclxuICAgIHZhciBvcmlnaW5hbEltYWdlQnVja2V0O1xyXG4gICAgdmFyIHRyYW5zZm9ybWVkSW1hZ2VCdWNrZXQ7XHJcblxyXG4gICAgb3JpZ2luYWxJbWFnZUJ1Y2tldCA9IHMzLkJ1Y2tldC5mcm9tQnVja2V0TmFtZSh0aGlzLCdpbXBvcnRlZC1vcmlnaW5hbC1pbWFnZS1idWNrZXQnLCBTM19JTUFHRV9CVUNLRVRfTkFNRSk7XHJcbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsICdPcmlnaW5hbEltYWdlc1MzQnVja2V0Jywge1xyXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIGJ1Y2tldCB3aGVyZSBvcmlnaW5hbCBpbWFnZXMgYXJlIHN0b3JlZCcsXHJcbiAgICAgIHZhbHVlOiBvcmlnaW5hbEltYWdlQnVja2V0LmJ1Y2tldE5hbWVcclxuICAgIH0pOyAgXHJcblxyXG4gICAgLy8gY3JlYXRlIGJ1Y2tldCBmb3IgdHJhbnNmb3JtZWQgaW1hZ2VzIGlmIGVuYWJsZWQgaW4gdGhlIGFyY2hpdGVjdHVyZVxyXG4gICAgICB0cmFuc2Zvcm1lZEltYWdlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnczMtdHJhbnNmb3JtZWQtaW1hZ2UtYnVja2V0Jywge1xyXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSwgXHJcbiAgICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIGV4cGlyYXRpb246IER1cmF0aW9uLmRheXMoUzNfVFJBTlNGT1JNRURfSU1BR0VfRVhQSVJBVElPTl9EVVJBVElPTiksXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICBdLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAvLyBwcmVwYXJlIGVudiB2YXJpYWJsZSBmb3IgTGFtYmRhIFxyXG4gICAgdmFyIGxhbWJkYUVudjogTGFtYmRhRW52ID0ge1xyXG4gICAgICBvcmlnaW5hbEltYWdlQnVja2V0TmFtZTogb3JpZ2luYWxJbWFnZUJ1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICB0cmFuc2Zvcm1lZEltYWdlQ2FjaGVUVEw6IFMzX1RSQU5TRk9STUVEX0lNQUdFX0NBQ0hFX1RUTCxcclxuICAgICAgc2VjcmV0S2V5OiBTRUNSRVRfS0VZLFxyXG4gICAgICBsb2dUaW1pbmc6IExPR19USU1JTkcsXHJcbiAgICB9O1xyXG4gICAgaWYgKHRyYW5zZm9ybWVkSW1hZ2VCdWNrZXQpIGxhbWJkYUVudi50cmFuc2Zvcm1lZEltYWdlQnVja2V0TmFtZSA9IHRyYW5zZm9ybWVkSW1hZ2VCdWNrZXQuYnVja2V0TmFtZTtcclxuXHJcbiAgICAvLyBJQU0gcG9saWN5IHRvIHJlYWQgZnJvbSB0aGUgUzMgYnVja2V0IGNvbnRhaW5pbmcgdGhlIG9yaWdpbmFsIGltYWdlc1xyXG4gICAgY29uc3QgczNSZWFkT3JpZ2luYWxJbWFnZXNQb2xpY3kgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgIGFjdGlvbnM6IFsnczM6R2V0T2JqZWN0J10sXHJcbiAgICAgIHJlc291cmNlczogWydhcm46YXdzOnMzOjo6JytvcmlnaW5hbEltYWdlQnVja2V0LmJ1Y2tldE5hbWUrJy8qJ10sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBzdGF0ZW1lbnRzIG9mIHRoZSBJQU0gcG9saWN5IHRvIGF0dGFjaCB0byBMYW1iZGFcclxuICAgIHZhciBpYW1Qb2xpY3lTdGF0ZW1lbnRzID0gW3MzUmVhZE9yaWdpbmFsSW1hZ2VzUG9saWN5XTtcclxuXHJcbiAgICAvLyBDcmVhdGUgTGFtYmRhIGZvciBpbWFnZSBwcm9jZXNzaW5nXHJcbiAgICB2YXIgbGFtYmRhUHJvcHMgPSB7XHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xNl9YLCBcclxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2Z1bmN0aW9ucy9pbWFnZS1wcm9jZXNzaW5nJyksXHJcbiAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMocGFyc2VJbnQoTEFNQkRBX1RJTUVPVVQpKSxcclxuICAgICAgbWVtb3J5U2l6ZTogcGFyc2VJbnQoTEFNQkRBX01FTU9SWSksXHJcbiAgICAgIGVudmlyb25tZW50OiBsYW1iZGFFbnYsXHJcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9EQVksXHJcbiAgICB9O1xyXG4gICAgdmFyIGltYWdlUHJvY2Vzc2luZyA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ2ltYWdlLW9wdGltaXphdGlvbicsIGxhbWJkYVByb3BzKTtcclxuXHJcbiAgICAvLyBFbmFibGUgTGFtYmRhIFVSTFxyXG4gICAgY29uc3QgaW1hZ2VQcm9jZXNzaW5nVVJMID0gaW1hZ2VQcm9jZXNzaW5nLmFkZEZ1bmN0aW9uVXJsKHtcclxuICAgICAgYXV0aFR5cGU6IGxhbWJkYS5GdW5jdGlvblVybEF1dGhUeXBlLk5PTkUsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBMZXZlcmFnZSBhIGN1c3RvbSByZXNvdXJjZSB0byBnZXQgdGhlIGhvc3RuYW1lIG9mIHRoZSBMYW1iZGFVUkxcclxuICAgIGNvbnN0IGltYWdlUHJvY2Vzc2luZ0hlbHBlciA9IG5ldyBNeUN1c3RvbVJlc291cmNlKHRoaXMsICdjdXN0b21SZXNvdXJjZScsIHtcclxuICAgICAgVXJsOiBpbWFnZVByb2Nlc3NpbmdVUkwudXJsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBDcmVhdGUgYSBDbG91ZEZyb250IG9yaWdpbjogUzMgd2l0aCBmYWxsYmFjayB0byBMYW1iZGEgd2hlbiBpbWFnZSBuZWVkcyB0byBiZSB0cmFuc2Zvcm1lZCwgb3RoZXJ3aXNlIHdpdGggTGFtYmRhIGFzIHNvbGUgb3JpZ2luXHJcbiAgICB2YXIgaW1hZ2VPcmlnaW47XHJcblxyXG4gICAgICBpbWFnZU9yaWdpbiA9IG5ldyBvcmlnaW5zLk9yaWdpbkdyb3VwICh7XHJcbiAgICAgICAgcHJpbWFyeU9yaWdpbjogbmV3IG9yaWdpbnMuUzNPcmlnaW4odHJhbnNmb3JtZWRJbWFnZUJ1Y2tldCwge1xyXG4gICAgICAgICAgb3JpZ2luU2hpZWxkUmVnaW9uOiBDTE9VREZST05UX09SSUdJTl9TSElFTERfUkVHSU9OLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICAgIGZhbGxiYWNrT3JpZ2luOiBuZXcgb3JpZ2lucy5IdHRwT3JpZ2luKGltYWdlUHJvY2Vzc2luZ0hlbHBlci5ob3N0bmFtZSwge1xyXG4gICAgICAgICAgb3JpZ2luU2hpZWxkUmVnaW9uOiBDTE9VREZST05UX09SSUdJTl9TSElFTERfUkVHSU9OLFxyXG4gICAgICAgICAgY3VzdG9tSGVhZGVyczoge1xyXG4gICAgICAgICAgICAneC1vcmlnaW4tc2VjcmV0LWhlYWRlcic6IFNFQ1JFVF9LRVksXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pLCBcclxuICAgICAgICBmYWxsYmFja1N0YXR1c0NvZGVzOiBbNDAzXSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyB3cml0ZSBwb2xpY3kgZm9yIExhbWJkYSBvbiB0aGUgczMgYnVja2V0IGZvciB0cmFuc2Zvcm1lZCBpbWFnZXNcclxuICAgICAgdmFyIHMzV3JpdGVUcmFuc2Zvcm1lZEltYWdlc1BvbGljeSA9IG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbJ3MzOlB1dE9iamVjdCddLFxyXG4gICAgICAgIHJlc291cmNlczogWydhcm46YXdzOnMzOjo6Jyt0cmFuc2Zvcm1lZEltYWdlQnVja2V0LmJ1Y2tldE5hbWUrJy8qJ10sXHJcbiAgICAgIH0pO1xyXG4gICAgICBpYW1Qb2xpY3lTdGF0ZW1lbnRzLnB1c2goczNXcml0ZVRyYW5zZm9ybWVkSW1hZ2VzUG9saWN5KTtcclxuXHJcbiAgICAvLyBhdHRhY2ggaWFtIHBvbGljeSB0byB0aGUgcm9sZSBhc3N1bWVkIGJ5IExhbWJkYVxyXG4gICAgaW1hZ2VQcm9jZXNzaW5nLnJvbGU/LmF0dGFjaElubGluZVBvbGljeShcclxuICAgICAgbmV3IGlhbS5Qb2xpY3kodGhpcywgJ3JlYWQtd3JpdGUtYnVja2V0LXBvbGljeScsIHtcclxuICAgICAgICBzdGF0ZW1lbnRzOiBpYW1Qb2xpY3lTdGF0ZW1lbnRzLFxyXG4gICAgICB9KSxcclxuICAgICk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIGEgQ2xvdWRGcm9udCBGdW5jdGlvbiBmb3IgdXJsIHJld3JpdGVzXHJcbiAgICBjb25zdCB1cmxSZXdyaXRlRnVuY3Rpb24gPSBuZXcgY2xvdWRmcm9udC5GdW5jdGlvbih0aGlzLCAndXJsUmV3cml0ZScsIHtcclxuICAgICAgY29kZTogY2xvdWRmcm9udC5GdW5jdGlvbkNvZGUuZnJvbUZpbGUoe2ZpbGVQYXRoOiAnZnVuY3Rpb25zL3VybC1yZXdyaXRlL2luZGV4LmpzJyx9KSxcclxuICAgICAgZnVuY3Rpb25OYW1lOiBgdXJsUmV3cml0ZUZ1bmN0aW9uJHt0aGlzLm5vZGUuYWRkcn1gLCBcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICBjb25zdCBrZXlHcm91cCA9IGNsb3VkZnJvbnQuS2V5R3JvdXAuZnJvbUtleUdyb3VwSWQodGhpcywgJ015S2V5R3JvdXAnLGJ1aWxkQ29uZmlnLmtleUdyb3VwSWQpXHJcblxyXG4gICAgdmFyIGltYWdlRGVsaXZlcnlDYWNoZUJlaGF2aW9yQ29uZmlnOkJlaGF2aW9yT3B0aW9ucyAgPSB7XHJcbiAgICAgIG9yaWdpbjogaW1hZ2VPcmlnaW4sXHJcbiAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxyXG4gICAgICBjYWNoZVBvbGljeTogbmV3IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kodGhpcywgYEltYWdlQ2FjaGVQb2xpY3kke3RoaXMubm9kZS5hZGRyfWAsIHtcclxuICAgICAgICBkZWZhdWx0VHRsOiBEdXJhdGlvbi5ob3VycygyNCksXHJcbiAgICAgICAgbWF4VHRsOiBEdXJhdGlvbi5kYXlzKDM2NSksXHJcbiAgICAgICAgbWluVHRsOiBEdXJhdGlvbi5zZWNvbmRzKDApLFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVRdWVyeVN0cmluZ0JlaGF2aW9yLmFsbCgpXHJcbiAgICAgIH0pLFxyXG4gICAgICBcclxuICAgICAgdHJ1c3RlZEtleUdyb3VwczogW1xyXG4gICAgICAgIGtleUdyb3VwLFxyXG4gICAgICBdLFxyXG4gICAgICBmdW5jdGlvbkFzc29jaWF0aW9uczogW3tcclxuICAgICAgICBldmVudFR5cGU6IGNsb3VkZnJvbnQuRnVuY3Rpb25FdmVudFR5cGUuVklFV0VSX1JFUVVFU1QsXHJcbiAgICAgICAgZnVuY3Rpb246IHVybFJld3JpdGVGdW5jdGlvbixcclxuICAgICAgfV0sXHJcbiAgICB9XHJcbiAgICBjb25zdCBvYWkgPSBuZXcgY2xvdWRmcm9udC5PcmlnaW5BY2Nlc3NJZGVudGl0eSh0aGlzICwnTWVkaWNhbERvY3VtZW50T2FpJylcclxuICAgIGNvbnN0IG9yaWdpbmFsSW1hZ2VCdWNrZXRPcmlnaW4gPSBuZXcgb3JpZ2lucy5TM09yaWdpbihvcmlnaW5hbEltYWdlQnVja2V0LHtcclxuICAgICAgb3JpZ2luQWNjZXNzSWRlbnRpdHkgOiBvYWlcclxuXHJcbiAgICB9KVxyXG4gICAgY29uc3QgcG9saWN5U3RhdGVtZW50ID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICBhY3Rpb25zOiAgICBbICdzMzpHZXRPYmplY3QnIF0sXHJcbiAgICAgIHJlc291cmNlczogIFsgb3JpZ2luYWxJbWFnZUJ1Y2tldC5hcm5Gb3JPYmplY3RzKFwiKlwiKSBdLFxyXG4gICAgICBwcmluY2lwYWxzOiBbIG9haS5ncmFudFByaW5jaXBhbCBdLFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGNvbnN0IGJ1Y2tldFBvbGljeSA9IG5ldyBzMy5CdWNrZXRQb2xpY3kodGhpcywgJ2Nsb3VkZnJvbnRBY2Nlc3NCdWNrZXRQb2xpY3knLCB7XHJcbiAgICAgIGJ1Y2tldDogb3JpZ2luYWxJbWFnZUJ1Y2tldCxcclxuICAgIH0pXHJcbiAgICBidWNrZXRQb2xpY3kuZG9jdW1lbnQuYWRkU3RhdGVtZW50cyhwb2xpY3lTdGF0ZW1lbnQpO1xyXG5cclxuICAgIHZhciBkb2N1bWVudERlbGl2ZXJ5Q2FjaGVCZWhhdmlvckNvbmZpZzpCZWhhdmlvck9wdGlvbnMgID0ge1xyXG4gICAgICBvcmlnaW46IG9yaWdpbmFsSW1hZ2VCdWNrZXRPcmlnaW4sXHJcbiAgICAgIGNvbXByZXNzIDogZmFsc2UsXHJcbiAgICAgIHJlc3BvbnNlSGVhZGVyc1BvbGljeSA6IGNkay5hd3NfY2xvdWRmcm9udC5SZXNwb25zZUhlYWRlcnNQb2xpY3kuQ09SU19BTExPV19BTExfT1JJR0lOU19XSVRIX1BSRUZMSUdIVF9BTkRfU0VDVVJJVFlfSEVBREVSUyxcclxuICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeSA6IGNkay5hd3NfY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5LkNPUlNfUzNfT1JJR0lOLFxyXG4gICAgICBhbGxvd2VkTWV0aG9kcyA6IGNkay5hd3NfY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRF9PUFRJT05TLFxyXG4gICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcclxuICAgICAgXHJcbiAgICAgIC8vIGNhY2hlUG9saWN5OiBuZXcgY2xvdWRmcm9udC5DYWNoZVBvbGljeSh0aGlzLCBgSW1hZ2VDYWNoZVBvbGljeSR7dGhpcy5ub2RlLmFkZHJ9YCwge1xyXG4gICAgICAvLyAgIGRlZmF1bHRUdGw6IER1cmF0aW9uLmhvdXJzKDI0KSxcclxuICAgICAgLy8gICBtYXhUdGw6IER1cmF0aW9uLmRheXMoMzY1KSxcclxuICAgICAgLy8gICBtaW5UdGw6IER1cmF0aW9uLnNlY29uZHMoMCksXHJcbiAgICAgIC8vICAgcXVlcnlTdHJpbmdCZWhhdmlvcjogY2xvdWRmcm9udC5DYWNoZVF1ZXJ5U3RyaW5nQmVoYXZpb3IuYWxsKClcclxuICAgICAgLy8gfSksXHJcbiAgICAgIGNhY2hlUG9saWN5OmNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19PUFRJTUlaRURfRk9SX1VOQ09NUFJFU1NFRF9PQkpFQ1RTLFxyXG4gICAgICBjYWNoZWRNZXRob2RzIDogY2RrLmF3c19jbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQURfT1BUSU9OUyxcclxuICAgICAgdHJ1c3RlZEtleUdyb3VwczogW1xyXG4gICAgICAgIGtleUdyb3VwLFxyXG4gICAgICBdLFxyXG4gICAgfVxyXG5cclxuICAgIGlmIChDTE9VREZST05UX0NPUlNfRU5BQkxFRCkge1xyXG4gICAgICAvLyBDcmVhdGluZyBhIGN1c3RvbSByZXNwb25zZSBoZWFkZXJzIHBvbGljeS4gQ09SUyBhbGxvd2VkIGZvciBhbGwgb3JpZ2lucy5cclxuICAgICAgY29uc3QgaW1hZ2VSZXNwb25zZUhlYWRlcnNQb2xpY3kgPSBuZXcgY2xvdWRmcm9udC5SZXNwb25zZUhlYWRlcnNQb2xpY3kodGhpcywgYEltYWdlUmVzcG9uc2VIZWFkZXJzUG9saWN5JHt0aGlzLm5vZGUuYWRkcn1gLCB7XHJcbiAgICAgICAgcmVzcG9uc2VIZWFkZXJzUG9saWN5TmFtZTogYCR7YnVpbGRDb25maWcuc3RhZ2V9SW1hZ2VSZXNwb25zZVBvbGljeWAsXHJcbiAgICAgICAgY29yc0JlaGF2aW9yOiB7XHJcbiAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dDcmVkZW50aWFsczogZmFsc2UsXHJcbiAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dIZWFkZXJzOiBbJyonXSxcclxuICAgICAgICAgIGFjY2Vzc0NvbnRyb2xBbGxvd01ldGhvZHM6IFsnR0VUJ10sXHJcbiAgICAgICAgICBhY2Nlc3NDb250cm9sQWxsb3dPcmlnaW5zOiBbJyonXSxcclxuICAgICAgICAgIGFjY2Vzc0NvbnRyb2xNYXhBZ2U6IER1cmF0aW9uLnNlY29uZHMoNjAwKSxcclxuICAgICAgICAgIG9yaWdpbk92ZXJyaWRlOiBmYWxzZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIC8vIHJlY29nbml6aW5nIGltYWdlIHJlcXVlc3RzIHRoYXQgd2VyZSBwcm9jZXNzZWQgYnkgdGhpcyBzb2x1dGlvblxyXG4gICAgICAgIGN1c3RvbUhlYWRlcnNCZWhhdmlvcjoge1xyXG4gICAgICAgICAgY3VzdG9tSGVhZGVyczogW1xyXG4gICAgICAgICAgICB7IGhlYWRlcjogJ3gtYXdzLWltYWdlLW9wdGltaXphdGlvbicsIHZhbHVlOiAndjEuMCcsIG92ZXJyaWRlOiB0cnVlIH0sXHJcbiAgICAgICAgICAgIHsgaGVhZGVyOiAndmFyeScsIHZhbHVlOiAnYWNjZXB0Jywgb3ZlcnJpZGU6IHRydWUgfSxcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgfVxyXG4gICAgICB9KTsgIFxyXG4gICAgICBjb25zdCBkb2N1bWVudFJlc3BvbnNlSGVhZGVyc1BvbGljeSA9IG5ldyBjbG91ZGZyb250LlJlc3BvbnNlSGVhZGVyc1BvbGljeSh0aGlzLCBgRG9jdW1lbnRSZXNwb25zZUhlYWRlcnNQb2xpY3kke3RoaXMubm9kZS5hZGRyfWAsIHtcclxuICAgICAgICByZXNwb25zZUhlYWRlcnNQb2xpY3lOYW1lOiBgJHtidWlsZENvbmZpZy5zdGFnZX1Eb2N1bWVudFJlc3BvbnNlUG9saWN5YCxcclxuICAgICAgICBjb3JzQmVoYXZpb3I6IHtcclxuICAgICAgICAgIGFjY2Vzc0NvbnRyb2xBbGxvd0NyZWRlbnRpYWxzOiBmYWxzZSxcclxuICAgICAgICAgIGFjY2Vzc0NvbnRyb2xBbGxvd0hlYWRlcnM6IFsnKiddLFxyXG4gICAgICAgICAgYWNjZXNzQ29udHJvbEFsbG93TWV0aG9kczogWydHRVQnXSxcclxuICAgICAgICAgIGFjY2Vzc0NvbnRyb2xBbGxvd09yaWdpbnM6IFsnKiddLFxyXG4gICAgICAgICAgYWNjZXNzQ29udHJvbE1heEFnZTogRHVyYXRpb24uc2Vjb25kcyg2MDApLFxyXG4gICAgICAgICAgb3JpZ2luT3ZlcnJpZGU6IGZhbHNlLFxyXG4gICAgICAgIH0gfSk7XHJcbiAgICAgIGltYWdlRGVsaXZlcnlDYWNoZUJlaGF2aW9yQ29uZmlnID0ge1xyXG4gICAgICAgIC4uLmltYWdlRGVsaXZlcnlDYWNoZUJlaGF2aW9yQ29uZmlnLFxyXG4gICAgICAgIHJlc3BvbnNlSGVhZGVyc1BvbGljeSA6IGltYWdlUmVzcG9uc2VIZWFkZXJzUG9saWN5XHJcbiAgICAgIH1cclxuICAgICAgZG9jdW1lbnREZWxpdmVyeUNhY2hlQmVoYXZpb3JDb25maWcgPSB7XHJcbiAgICAgICAgLi4uZG9jdW1lbnREZWxpdmVyeUNhY2hlQmVoYXZpb3JDb25maWcsXHJcbiAgICAgICAgcmVzcG9uc2VIZWFkZXJzUG9saWN5IDogZG9jdW1lbnRSZXNwb25zZUhlYWRlcnNQb2xpY3lcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgY29uc3QgZG9tYWluTmFtZSA9IGBtZWRpYS4ke2J1aWxkQ29uZmlnLmJhc2VIb3N0fWBcclxuXHJcbiAgICBjb25zdCBkb2N1bWVudERlbGl2ZXJ5ID0gbmV3IGNsb3VkZnJvbnQuRGlzdHJpYnV0aW9uKHRoaXMsICdEb2N1bWVudERlbGl2ZXJ5RGlzdHJpYnV0aW9uJywge1xyXG4gICAgICBjb21tZW50OiAnbWVkaWNhbCBkb2N1bWVudCBkZWxpdmVyeSB3aXRoIG9wdGltaXphdGlvbiBvZiBpbWFnZScsXHJcbiAgICAgIGRvbWFpbk5hbWVzIDpbZG9tYWluTmFtZV0sXHJcbiAgICAgIGNlcnRpZmljYXRlIDogIGNkay5hd3NfY2VydGlmaWNhdGVtYW5hZ2VyLkNlcnRpZmljYXRlLmZyb21DZXJ0aWZpY2F0ZUFybih0aGlzLFwiQ2VydGlmaWNhdGVcIixjZGsuYXdzX3NzbS5TdHJpbmdQYXJhbWV0ZXIuZnJvbVN0cmluZ1BhcmFtZXRlckF0dHJpYnV0ZXModGhpcywgJ2NlcnRpZmljYXRlJywge1xyXG4gICAgICAgIHBhcmFtZXRlck5hbWU6IHNzbVBhcmFtS2V5KGJ1aWxkQ29uZmlnLnN0YWdlLHNzbVBhcmFtc1N1ZmZpeC5jZkNlcnRBcm4pLFxyXG4gICAgICAgIC8vICd2ZXJzaW9uJyBjYW4gYmUgc3BlY2lmaWVkIGJ1dCBpcyBvcHRpb25hbC5cclxuICAgICAgfSkuc3RyaW5nVmFsdWUpLFxyXG4gICAgICBkZWZhdWx0QmVoYXZpb3I6IGltYWdlRGVsaXZlcnlDYWNoZUJlaGF2aW9yQ29uZmlnXHJcbiAgICB9KTtcclxuXHJcbiAgICBkb2N1bWVudERlbGl2ZXJ5LmFkZEJlaGF2aW9yKCcvbWVkaWNhbC1kb2N1bWVudHMvKicsb3JpZ2luYWxJbWFnZUJ1Y2tldE9yaWdpbixkb2N1bWVudERlbGl2ZXJ5Q2FjaGVCZWhhdmlvckNvbmZpZylcclxuXHJcblxyXG4gICAgXHJcblxyXG4gICAgY29uc3QgaG9zdGVkWm9uZSA9IGNkay5hd3Nfcm91dGU1My5Ib3N0ZWRab25lLmZyb21Mb29rdXAodGhpcywgJ0hvc3RlZFpvbmUnLCB7XHJcbiAgICAgIGRvbWFpbk5hbWU6IGJ1aWxkQ29uZmlnLmJhc2VIb3N0XHJcbiAgICB9KVxyXG4gICAgXHJcbiAgICBuZXcgY2RrLmF3c19yb3V0ZTUzLkFSZWNvcmQodGhpcywgXCJBbGlhc1JlY29yZEFcIiwge1xyXG4gICAgICB6b25lOiBob3N0ZWRab25lLFxyXG4gICAgICByZWNvcmROYW1lOiBkb21haW5OYW1lLFxyXG4gICAgICBkZWxldGVFeGlzdGluZzogdHJ1ZSxcclxuICAgICAgdGFyZ2V0OiBjZGsuYXdzX3JvdXRlNTMuUmVjb3JkVGFyZ2V0LmZyb21BbGlhcyhcclxuICAgICAgICBuZXcgY2RrLmF3c19yb3V0ZTUzX3RhcmdldHMuQ2xvdWRGcm9udFRhcmdldChkb2N1bWVudERlbGl2ZXJ5KVxyXG4gICAgICApLFxyXG4gICAgfSk7XHJcbiAgICBuZXcgY2RrLmF3c19yb3V0ZTUzLkFhYWFSZWNvcmQodGhpcywgXCJBbGlhc1JlY29yZEFBQUFcIiwge1xyXG4gICAgICB6b25lOiBob3N0ZWRab25lLFxyXG4gICAgICByZWNvcmROYW1lOiBkb21haW5OYW1lLFxyXG4gICAgICBkZWxldGVFeGlzdGluZzogdHJ1ZSxcclxuICAgICAgdGFyZ2V0OiBjZGsuYXdzX3JvdXRlNTMuUmVjb3JkVGFyZ2V0LmZyb21BbGlhcyhcclxuICAgICAgICBuZXcgY2RrLmF3c19yb3V0ZTUzX3RhcmdldHMuQ2xvdWRGcm9udFRhcmdldChkb2N1bWVudERlbGl2ZXJ5KVxyXG4gICAgICApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCAnSW1hZ2VEZWxpdmVyeURvbWFpbicsIHtcclxuICAgICAgZGVzY3JpcHRpb246ICdEb21haW4gbmFtZSBvZiBpbWFnZSBkZWxpdmVyeScsXHJcbiAgICAgIHZhbHVlOiBkb2N1bWVudERlbGl2ZXJ5LmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWVcclxuICAgIH0pO1xyXG4gIH1cclxufVxyXG4iXX0=