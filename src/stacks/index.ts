import {
    CfnOutput, Duration, RemovalPolicy, Stack,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
    PublicApiGateway,
} from '@demo/constructs';
import { ApplicationStackProps } from 'types';
import {
    ARecord, HostedZone, IHostedZone, RecordTarget,
} from 'aws-cdk-lib/aws-route53';
import {
    DomainName, EndpointType, LambdaIntegration, SecurityPolicy,
} from 'aws-cdk-lib/aws-apigateway';
import { Certificate, CertificateValidation, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import {
    AssetCode, LayerVersion, Runtime, Tracing,
} from 'aws-cdk-lib/aws-lambda';
import {
    AttributeType, BillingMode, ProjectionType, Table,
} from 'aws-cdk-lib/aws-dynamodb';
import { ApiGatewayDomain, CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import {
    CloudFrontWebDistribution, OriginAccessIdentity, SecurityPolicyProtocol, ViewerCertificate,
} from 'aws-cdk-lib/aws-cloudfront';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';

/**
 * Deploys the application including API and Lambda backend.
 * API Url is output for use in testing.
 */
export class ApplicationStack extends Stack {
    private apiDomain?: DomainName;

    private zone?: IHostedZone;

    private webCert?: ICertificate | Certificate;

    /**
     * @param {Construct} scope
     * @param {string} id
     * @param {ApplicationStackProps} props
     */
    constructor(scope: Construct, id: string, props: ApplicationStackProps) {
        super(scope, id, props);

        const {
            svcName = 'DemoSite',
            apiHostname = 'api',
            webHostname = 'demo-site',
            zoneProps, appCertArn, allowCidrs,
            cfCertArn,
        } = props;

        // Optional DNS and Root API Domain ==================
        if (zoneProps) {
            const { zoneName } = zoneProps;
            const zone = HostedZone.fromHostedZoneAttributes(this, 'Zone', zoneProps);
            this.zone = zone;

            // Use imported or create new Certificate for the API
            const appCert = (appCertArn)
                ? Certificate.fromCertificateArn(this, 'AppCert', appCertArn)
                : new Certificate(this, 'AppCert', {
                    domainName: `*.${zoneName}`,
                    validation: CertificateValidation.fromDns(zone),
                });

            // Create the API Domain for API Gateway
            const apiDomain = new DomainName(this, 'ApiDomain', {
                domainName: `${apiHostname}.${zoneName}`,
                certificate: appCert,
                endpointType: EndpointType.REGIONAL,
                securityPolicy: SecurityPolicy.TLS_1_2,
            });
            this.apiDomain = apiDomain;
            new ARecord(this, 'ApiAlias', {
                target: RecordTarget.fromAlias(new ApiGatewayDomain(apiDomain)),
                zone,
                recordName: `${apiHostname}.${zoneName}`,
            });
            new CfnOutput(this, 'CustomApiEndpoint', {
                description: 'Custom domain API URL',
                value: `https://${apiHostname}.${zoneName}`,
            });

            /**
             * Import CloudFront certificate for website custom domain
             * CloudFront Certificate must be in us-east-1. If the stack is deployed in that region
             * then we will create the certificate if required.
             * Creating the certificate is more complicated if deploying the application stack
             * in a different region - out of scope for this example.
             */
            this.webCert = (cfCertArn) ? Certificate.fromCertificateArn(this, 'WebCert', cfCertArn) : undefined;
            if (!this.webCert && this.region === 'us-east-1') {
                this.webCert = new Certificate(this, 'WebCert', {
                    domainName: `*.${zoneName}`,
                    validation: CertificateValidation.fromDns(zone),
                });
            }
        }

        // Registration Table =======================
        const table = new Table(this, 'RegisterTable', {
            billingMode: BillingMode.PAY_PER_REQUEST,
            partitionKey: { name: 'Email', type: AttributeType.STRING },
            removalPolicy: RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ExpiryTime',
        });
        table.addGlobalSecondaryIndex({
            indexName: 'refIndex',
            partitionKey: { name: 'ReferenceId', type: AttributeType.STRING },
            projectionType: ProjectionType.ALL,
        });

        // Web =====================================

        // S3 web bucket for web site
        const webBucket = new Bucket(this, 'WebBucket', {
            versioned: false,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });
        const oia = new OriginAccessIdentity(this, 'oai', {
            comment: `${svcName} CF Distribution`,
        });
        webBucket.grantRead(oia);

        // CloudFront web distribution
        const webDist = new CloudFrontWebDistribution(this, 'WebDist', {
            originConfigs: [
                {
                    s3OriginSource: {
                        s3BucketSource: webBucket,
                        originAccessIdentity: oia,
                    },
                    behaviors: [{ isDefaultBehavior: true }],
                },
            ],
            // Attach custom domain certificate
            viewerCertificate: (this.zone && this.webCert) ? ViewerCertificate.fromAcmCertificate(this.webCert, {
                aliases: [`${webHostname}.${this.zone.zoneName}`],
                securityPolicy: SecurityPolicyProtocol.TLS_V1_2_2021,
            }) : undefined,
        });
        const cfDomain = webDist.distributionDomainName;

        // Output the CloudFront endpoint
        new CfnOutput(this, 'CloudFrontEndpoint', {
            description: 'CloudFront endpoint URL',
            value: `https://${cfDomain}`,
        });

        // Deploy the web files
        new BucketDeployment(this, 'WebSite', {
            sources: [Source.asset(`${__dirname}/../web/dist`)],
            destinationBucket: webBucket,
            // invalidate the cache on deploying new web assets:
            distribution: webDist,
            distributionPaths: ['/*'],
        });

        // Create DNS Alias
        if (this.zone) {
            new ARecord(this, 'WebAlias', {
                target: RecordTarget.fromAlias(new CloudFrontTarget(webDist)),
                zone: this.zone,
                recordName: `${webHostname}.${this.zone.zoneName}`,
            });
            // Output the custom endpoint
            new CfnOutput(this, 'CustomEndpoint', {
                description: 'Custom domain endpoint URL',
                value: `https://${webHostname}.${this.zone.zoneName}`,
            });
        }

        // API ======================================
        const {
            api, methodProps, integrationProps,
            optionsIntegration, optionsMethodProps,
            contextStr, corsHeaderString,
        } = new PublicApiGateway(this, 'AppApi', {
            appName: svcName,
            apiDomain: this.apiDomain,
            region: this.region,
            apiPolicy: {
                allowCidrs,
            },
            apiLimits: {
                burstLimit: 5,
                rateLimit: 1,
            },
            corsProps: {
                allowOrigins: (this.zone)
                    ? [`https://${webHostname}.${this.zone.zoneName}`, `https://${cfDomain}`, 'http://localhost:1234']
                    : [`https://${cfDomain}`, 'http://localhost:1234'],
            },
        });
        // Output the API Gateway endpoint
        new CfnOutput(this, 'ApiEndpoint', {
            description: 'API Gateway endpoint URL',
            value: `https://${api.restApiId}.execute-api.${this.region}.amazonaws.com/${api.deploymentStage.stageName}`,
        });

        // API Integrations =========================
        const toolsLayer = new LayerVersion(this, `${svcName}ToolsLayer`, {
            compatibleRuntimes: [Runtime.NODEJS_16_X],
            code: AssetCode.fromAsset(`${__dirname}/../lambda/tools-layer`),
            description: `${svcName} Tools Shared Layer`,
            layerVersionName: `${svcName}-tools`,
        });

        const registerFnc = new NodejsFunction(this, 'Fnc', {
            description: `${svcName} Register Handler`,
            runtime: Runtime.NODEJS_16_X,
            memorySize: 256,
            timeout: Duration.seconds(5),
            tracing: Tracing.ACTIVE,
            logRetention: 14,
            layers: [toolsLayer],
            bundling: {
                sourceMap: true,
                externalModules: [
                    '@aws-lambda-powertools/commons',
                    '@aws-lambda-powertools/logger',
                    '@aws-lambda-powertools/metrics',
                    '@aws-lambda-powertools/tracer',
                    '@middy/core',
                    'aws-sdk',
                    'moment',
                    'nanoid',
                ],
            },
            entry: `${__dirname}/../lambda/register/index.ts`,
            environment: {
                NODE_OPTIONS: '--enable-source-maps',
                POWERTOOLS_SERVICE_NAME: svcName,
                POWERTOOLS_METRICS_NAMESPACE: svcName,
                LOG_LEVEL: 'DEBUG',
                POWERTOOLS_LOGGER_LOG_EVENT: 'true',
                TABLE: table.tableName,
                MAX_DAYS: '30',
            },
        });
        table.grantReadWriteData(registerFnc);

        const postInteg = new LambdaIntegration(registerFnc, {
            ...integrationProps,
            requestTemplates: {
                'application/json': `{
                        ${corsHeaderString}
                        ${contextStr},
                        "params": {
                            "email": $input.json('$.email'),
                            "name": $input.json('$.name'),
                            "registerDate": $input.json('$.registerDate')
                        }
                    }`,
            },
        });
        const getInteg = new LambdaIntegration(registerFnc, {
            ...integrationProps,
            requestParameters: {
                'integration.request.querystring.email': 'method.request.querystring.email',
                'integration.request.querystring.reference': 'method.request.querystring.reference',
            },
            requestTemplates: {
                'application/json': `{
                        ${corsHeaderString}
                        ${contextStr},
                        "params": {
                            "email": "$input.params('email')",
                            "reference": "$input.params('reference')"
                        }
                    }`,
            },
        });
        const deleteInteg = new LambdaIntegration(registerFnc, {
            ...integrationProps,
            requestParameters: {
                'integration.request.querystring.email': 'method.request.querystring.email',
            },
            requestTemplates: {
                'application/json': `{
                        ${corsHeaderString}
                        ${contextStr},
                        "params": {
                            "email": "$input.params('email')"
                        }
                    }`,
            },
        });
        const register = api.root.addResource('register');
        register.addMethod('OPTIONS', optionsIntegration, optionsMethodProps);
        register.addMethod('POST', postInteg, { ...methodProps });
        register.addMethod('PATCH', postInteg, { ...methodProps });
        register.addMethod('GET', getInteg, {
            ...methodProps,
            requestParameters: {
                'method.request.querystring.email': false,
                'method.request.querystring.reference': false,
            },
        });
        register.addMethod('DELETE', deleteInteg, {
            ...methodProps,
            requestParameters: {
                'method.request.querystring.email': true,
            },
        });
    }
}
