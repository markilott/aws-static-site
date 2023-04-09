/* eslint-disable import/no-extraneous-dependencies */
import { Construct } from 'constructs';
import { RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import {
    RestApi, LogGroupLogDestination, EndpointType,
    JsonSchemaVersion, JsonSchemaType, IntegrationResponse, MethodOptions,
    ResponseType, MockIntegration, PassthroughBehavior, BasePathMapping, DomainName, AccessLogFormat, AccessLogField, Model, IDomainName, LambdaIntegrationOptions,
} from 'aws-cdk-lib/aws-apigateway';
import {
    PolicyDocument, Effect, AnyPrincipal, PolicyStatement,
} from 'aws-cdk-lib/aws-iam';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';

/** CloudWatch Log Retention */
type LogRetentionProps = {
    [months: number]: RetentionDays,
};

type PublicApiGatewayProps = {
    region: string;
    appName: string;
    /** The base API domain */
    apiDomain?: DomainName | IDomainName,
    /** Optionally restrict API to specific CIDR ranges */
    apiPolicy?: {
        /** Allow CIDR ranges to access API */
        allowCidrs?: string[],
    },
    /**
     * Optional API limits.
     * Default is API Gateway defaults.
     */
    apiLimits?: {
        burstLimit?: number,
        rateLimit?: number,
    },
    /**
     * Optional CloudWatch logging configuration.
     * Default - logging will be enabled with default values.
     */
    logging?: {
        /**
         * Default: 1 month
         */
        logRetentionMonths?: number;
        /**
         * @default false
         */
        retainLogGroup?: boolean;
    },
    /**
     * Optional API details. Usually not required.
     * Defaults will be created from appName.
     */
    apiDetails?: {
        restApiName?: string;
        apiDescription?: string;
        /**
         * Custom Stage name
         * @default 'v1'
         */
        stageName?: string;
        /**
         * Use a custom path
         * @default appName
         */
        apiPath?: string,
        /**
         * Use the root domain for this api. No other apis can use this apiDomain.
         * @default false
         */
        useRootPath?: boolean,
    },
    /**
     * Optional - CORS will not be configured if not supplied.
     * CORS will be enabled at the API level and default responses created.
     * CORS headers will be added to Integration and Method responses, and will work for unauthenticated requests to any CORS safe resource (unauthenticated GET requests are CORS safe).
     * To use authentication or unsafe methods (POST/PUT) you must also create an OPTIONS method for each resource where it is required.
     */
    corsProps?: {
        /**
         * Allow connections from these urls.
         * Wildcard "*" is not supported here. Wildcards in domains are not supported by CORS.
         * If All Origins are required then use the allOrigins flag or send an empty array here.
         * Protocol ( http:// or https:// ) is required.
         */
        allowOrigins?: string[],
        /**
         * Allow all origins '*'.
         * Default is false.
         * This will allow unauthenticated access to CORS safe methods only.
         * If authentication   methods are required then allowOrigins must be specified instead.
         */
        allOrigins?: boolean,
    },
};

const retentionDays: LogRetentionProps = {
    1: RetentionDays.ONE_MONTH,
    3: RetentionDays.THREE_MONTHS,
    6: RetentionDays.SIX_MONTHS,
    12: RetentionDays.ONE_YEAR,
};

/**
 * Public API Gateway construct.
 * Using a custom CDK Construct here to simplify the code in the main stack and
 * to create a re-usable resource for other projects.
 */
export class PublicApiGateway extends Construct {
    /** API construct */
    api: RestApi;

    /** Integration Responses for Lambda Integrations */
    integrationResponses: IntegrationResponse[];

    /** Lambda Default Integration Props */
    integrationProps: LambdaIntegrationOptions;

    /** Integration Error Responses only - use when a custom 200 response is required */
    errorResponses: { selectionPattern: string; statusCode: string; responseTemplates: { 'application/json': string; }; responseParameters: { [key: string]: string; } | undefined; }[];

    /** Integration response parameters - use when customising responses */
    integrationResponseParameters?: { [key: string]: string; };

    /** Response template script to set cors allow origin - for use in customising responses */
    corsHeaderString: string;

    /** Method response parameters - for use in customising methodProps */
    methodResponseParameters?: { [key: string]: boolean; };

    /** Response models  - for use in customising methodProps */
    responseModels: { 'application/json': Model; };

    /** Integration method error responses - for use in customising methodProps */
    methodErrorResponses: {
        statusCode: string;
        responseModels: {
            'application/json': Model;
        };
        responseParameters?: {
            [key: string]: boolean;
        };
    }[];

    /**
     * Method Option Props.
     * Api Key is required by default.
     */
    methodProps: MethodOptions;

    /** Integration for OPTIONS methods */
    optionsIntegration?: MockIntegration;

    /** Method Option Props for OPTIONS methods */
    optionsMethodProps?: MethodOptions;

    /** API Gateway Endpoint URL */
    baseUrl: string;

    /** Custom domain URL */
    apiUrl?: string;

    /** Deployed Stage Name */
    stageName: string;

    /**
     * Context String to add to Request Templates.
     * Includes the standard fields forwarded to Lambda in the context object.
     * Usage: add to the application/json string in requestTemplates.
     */
    contextStr: string;

    /**
     * Standard requestTemplate for PUT and POST requests.
     * Includes the input body and standard context.
     */
    inputBodyRequestTemplate: {
        'application/json': string,
    };

    /** Custom cors string based on allowed origins */
    corsString: string;

    /** API Policy */
    private defApiPolicy?: PolicyDocument;

    /**
     * Creates a Public API Gateway.
     *
     * @param {Construct} scope
     * @param {string} id
     * @param {PublicApiGatewayProps} props
     */
    constructor(scope: Construct, id: string, props: PublicApiGatewayProps) {
        super(scope, id);

        const {
            appName, apiPolicy, corsProps, apiLimits, apiDomain,
            logging = {}, apiDetails = {},
        } = props;

        // Set default log settings
        const { logRetentionMonths = 1, retainLogGroup = false } = logging;

        // Set default API details
        const {
            restApiName = `${appName}-Api`, apiDescription = `${appName} API`, stageName = 'v1', apiPath = appName.toLowerCase(), useRootPath,
        } = apiDetails;
        this.stageName = stageName;

        // API IAM Policies ==============================================
        if (apiPolicy?.allowCidrs?.length) {
            const { allowCidrs } = apiPolicy;
            // allow access to API only from the supplied cidrs
            this.defApiPolicy = new PolicyDocument({
                statements: [
                    new PolicyStatement({
                        principals: [new AnyPrincipal()],
                        actions: ['execute-api:Invoke'],
                        resources: ['execute-api:/*'],
                        effect: Effect.DENY,
                        conditions: {
                            NotIpAddress: {
                                'aws:SourceIp': [...allowCidrs],
                            },
                        },
                    }),
                    new PolicyStatement({
                        principals: [new AnyPrincipal()],
                        actions: ['execute-api:Invoke'],
                        resources: ['execute-api:/*'],
                        effect: Effect.ALLOW,
                    }),
                ],
            });
        }

        // API Logging ==================================================
        const retention = retentionDays[logRetentionMonths];
        const logRemoval = (retainLogGroup) ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
        const apiLog = new LogGroup(this, 'AccessLog', { retention, removalPolicy: logRemoval });

        // API Limits ==============================================
        const burstLimit = apiLimits && apiLimits.burstLimit;
        const rateLimit = apiLimits && apiLimits.rateLimit;

        // API Base ==============================================
        const api = new RestApi(this, 'api', {
            restApiName,
            description: apiDescription,
            deployOptions: {
                stageName,
                description: 'Base Deployment',
                tracingEnabled: true,
                accessLogDestination: new LogGroupLogDestination(apiLog),
                accessLogFormat: AccessLogFormat.custom(JSON.stringify({
                    requestTime: AccessLogField.contextRequestTime(),
                    requestTimeEpoch: AccessLogField.contextRequestTimeEpoch(),
                    requestId: AccessLogField.contextRequestId(),
                    sourceIp: AccessLogField.contextIdentitySourceIp(),
                    method: AccessLogField.contextHttpMethod(),
                    resourcePath: AccessLogField.contextResourcePath(),
                    traceId: AccessLogField.contextXrayTraceId(),
                })),
                throttlingBurstLimit: (burstLimit === 0) ? undefined : burstLimit,
                throttlingRateLimit: (rateLimit === 0) ? undefined : rateLimit,
            },
            endpointConfiguration: {
                types: [EndpointType.REGIONAL],
            },
            policy: this.defApiPolicy,
            cloudWatchRole: false,
        });
        this.api = api;

        // API endpoint url
        new CfnOutput(this, 'apiUrl', {
            description: `${appName} API Endpoint URL`,
            value: api.url,
        });
        this.baseUrl = api.url;

        // Optionally map the API to a custom domain
        if (apiDomain) {
            // map API domain name to API
            new BasePathMapping(this, 'pathMapping', {
                basePath: (useRootPath) ? undefined : apiPath,
                domainName: apiDomain,
                restApi: api,
            });

            // Custom domain url
            this.apiUrl = `https://${apiDomain.domainName}/${apiPath}`;
            new CfnOutput(this, 'apiPublicUrl', {
                description: `${appName} API URL`,
                value: this.apiUrl,
            });
        }

        // CORS Gateway Headers
        /**
         * Set the default Allow-Origin to the first allowOrigin if specified.
         * It is overwritten by Lambda responses in most cases. This default will only be used
         * when returning a Gateway Response - for example 401 or 403 from a Lambda Authorizer
         */
        const origin = (corsProps?.allowOrigins?.length) ? `'${corsProps.allowOrigins[0]}'` : "'*'";
        const gatewayHeaders = (corsProps)
            ? {
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Headers': "'Content-Type,Authorization,Cookie'",
                'Access-Control-Allow-Methods': "'HEAD,POST,PUT,GET,DELETE,PATCH,OPTIONS'",
                'Access-Control-Allow-Credentials': "'true'",
            }
            : undefined;

        // Gateway Error Responses. Responses are overwritten with Error Templates below when the error is returned from Lambda.
        api.addGatewayResponse('Default400', {
            type: ResponseType.DEFAULT_4XX,
            responseHeaders: gatewayHeaders,
            templates: {
                'application/json': '{ "success": false, "requestId": "$context.requestId", "errorMessage": "Bad request", "errorCode": "$context.error.responseType" }',
            },
        });
        api.addGatewayResponse('Default500', {
            type: ResponseType.DEFAULT_5XX,
            responseHeaders: gatewayHeaders,
            templates: {
                'application/json': '{ "success": false, "requestId": "$context.requestId", "errorMessage": "Internal Error", "errorCode": "$context.error.responseType"}',
            },
        });
        api.addGatewayResponse('IntegrationTimeout', {
            type: ResponseType.INTEGRATION_TIMEOUT,
            responseHeaders: gatewayHeaders,
            templates: {
                'application/json': '{ "success": false, "requestId": "$context.requestId", "errorMessage": "Timeout processing request", "errorCode": "$context.error.responseType"}',
            },
        });
        api.addGatewayResponse('NotFound', {
            type: ResponseType.RESOURCE_NOT_FOUND,
            responseHeaders: gatewayHeaders,
            templates: {
                'application/json': '{ "success": false, "requestId": "$context.requestId", "errorMessage": "Resource not found", "error": "errorCode": "$context.error.responseType"}',
            },
        });
        api.addGatewayResponse('Throttled', {
            type: ResponseType.THROTTLED,
            responseHeaders: gatewayHeaders,
            templates: {
                'application/json': '{ "success": false, "requestId": "$context.requestId", "errorMessage": "Too many requests", "error": "errorCode": "$context.error.responseType"}',
            },
        });
        api.addGatewayResponse('OverQuota', {
            type: ResponseType.QUOTA_EXCEEDED,
            responseHeaders: gatewayHeaders,
            templates: {
                'application/json': '{ "success": false, "requestId": "$context.requestId", "errorMessage": "Too many requests", "error": "errorCode": "$context.error.responseType"}',
            },
        });

        // Allowed list of domains for CORS.
        // Set an empty array if using allOrigins - this will cause the templates to return '*' for all requests.
        const allowOrigins = corsProps?.allowOrigins ?? [];
        const corsString = (corsProps?.allOrigins) ? '[]' : `${JSON.stringify(allowOrigins)}`;
        this.corsString = corsString;

        // Response Models ====================================================

        const jsonResponseModel = api.addModel('JsonResponse', {
            contentType: 'application/json',
            schema: {
                schema: JsonSchemaVersion.DRAFT7,
                title: 'JsonResponse',
                type: JsonSchemaType.OBJECT,
                properties: {
                    state: { type: JsonSchemaType.STRING },
                    greeting: { type: JsonSchemaType.STRING },
                },
            },
        });

        // Response headers for all requests
        const corsResponseParameters: { [key: string]: string } = (corsProps?.allOrigins)
            ? {
                // CORS safe method settings
                'method.response.header.Content-Type': "'application/json'",
                'method.response.header.Access-Control-Allow-Origin': "'*'",
                'method.response.header.Access-Control-Allow-Headers': "'Access-Control-Allow-Origin,Content-Type,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent,X-Amz-Date,X-Requested-With'",
                'method.response.header.Access-Control-Allow-Methods': "'HEAD,GET,OPTIONS'",
            }
            : {
                // Include all methods and headers
                'method.response.header.Content-Type': "'application/json'",
                'method.response.header.Access-Control-Allow-Origin': "'*'", // This is overridden in response templates if there is an Origin match (if the origin does not match a browser will throw a CORS error)
                'method.response.header.Access-Control-Allow-Headers': "'Access-Control-Allow-Origin,Content-Type,Authorization,Cookie,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent,X-Amz-Date,X-Requested-With'",
                'method.response.header.Access-Control-Allow-Methods': "'HEAD,POST,PUT,GET,DELETE,PATCH,OPTIONS'",
                'method.response.header.Access-Control-Allow-Credentials': "'true'",
            };
        const integrationResponseParameters = (corsProps) && corsResponseParameters;
        this.integrationResponseParameters = integrationResponseParameters;

        // Error response template for 4xx Errors
        const responseTemplates400 = (corsProps)
            ? {
                'application/json': `
                    #set($domains = ${corsString})
                    #set($origin = $input.params("origin"))
                    #if($domains.contains($origin))
                    #set($context.responseOverride.header.Access-Control-Allow-Origin="$origin")
                    #end
                    #set ($errorMessageObj = $util.parseJson($input.path('$.errorMessage')))
                    {
                        "success": false,
                        "errorMessage" : "$errorMessageObj.message",
                        "errorCode" : "$errorMessageObj.errorCode",
                        "requestId" : "$errorMessageObj.requestId"
                    }`,
            }
            : {
                'application/json': `
                    #set ($errorMessageObj = $util.parseJson($input.path('$.errorMessage')))
                    {
                        "success": false,
                        "errorMessage" : "$errorMessageObj.message",
                        "errorCode" : "$errorMessageObj.errorCode",
                        "requestId" : "$errorMessageObj.requestId"
                    }`,
            };

        // Error response template for 5xx Errors
        const responseTemplates500 = (corsProps)
            ? {
                'application/json': `
                    #set($domains = ${corsString})
                    #set($origin = $input.params("origin"))
                    #if($domains.contains($origin))
                    #set($context.responseOverride.header.Access-Control-Allow-Origin="$origin")
                    #end
                    #set ($errorMessageObj = $util.parseJson($input.path('$.errorMessage')))
                    {
                        "success": false,
                        "errorMessage" : "Internal server error",
                        "errorCode" : "$errorMessageObj.errorCode",
                        "requestId" : "$errorMessageObj.requestId"
                    }`,
            }
            : {
                'application/json': `#set ($errorMessageObj = $util.parseJson($input.path('$.errorMessage')))
                    {
                        "success": false,
                        "errorMessage" : "Internal server error",
                        "errorCode" : "$errorMessageObj.errorCode",
                        "requestId" : "$errorMessageObj.requestId"
                    }`,
            };

        // Error responses for all requests
        const errorResponses = [
            {
                selectionPattern: '.*:401.*',
                statusCode: '401',
                responseTemplates: responseTemplates400,
                responseParameters: integrationResponseParameters,
            },
            {
                selectionPattern: '.*:403.*',
                statusCode: '403',
                responseTemplates: responseTemplates400,
                responseParameters: integrationResponseParameters,
            },
            {
                selectionPattern: '.*:4\\d{2}.*',
                statusCode: '400',
                responseTemplates: responseTemplates400,
                responseParameters: integrationResponseParameters,
            },
            {
                selectionPattern: '.*:5\\d{2}.*',
                statusCode: '500',
                responseTemplates: responseTemplates500,
                responseParameters: integrationResponseParameters,
            },
        ];
        this.errorResponses = errorResponses;

        // Default Integration Response set
        this.integrationResponses = (corsProps)
            ? [
                {
                    statusCode: '200',
                    responseTemplates: {
                        'application/json': `
                            #set($domains = ${corsString})
                            #set($origin = $input.params("origin"))
                            #if($domains.contains($origin))
                            #set($context.responseOverride.header.Access-Control-Allow-Origin="$origin")
                            #end
                            $input.body
                            `,
                    },
                    responseParameters: integrationResponseParameters,
                },
                ...errorResponses,
            ]
            : [
                // This will just return the json input body.
                {
                    statusCode: '200',
                },
                ...errorResponses,
            ];

        // Lambda integration props for API methods
        this.integrationProps = {
            proxy: false,
            integrationResponses: this.integrationResponses,
            passthroughBehavior: PassthroughBehavior.WHEN_NO_TEMPLATES,
        };

        // Method Response parameters to match Integration Response headers
        const corsMethodResponseParameters: { [key: string]: boolean } = (corsProps?.allOrigins)
            ? {
                'method.response.header.Content-Type': true,
                'method.response.header.Access-Control-Allow-Headers': true,
                'method.response.header.Access-Control-Allow-Methods': true,
                'method.response.header.Access-Control-Allow-Origin': true,
            }
            : {
                'method.response.header.Content-Type': true,
                'method.response.header.Access-Control-Allow-Headers': true,
                'method.response.header.Access-Control-Allow-Methods': true,
                'method.response.header.Access-Control-Allow-Origin': true,
                'method.response.header.Access-Control-Allow-Credentials': true,
            };
        const methodResponseParameters = (corsProps) && corsMethodResponseParameters;
        this.methodResponseParameters = methodResponseParameters;

        const responseModels = {
            'application/json': jsonResponseModel,
        };
        this.responseModels = responseModels;

        const methodErrorResponses = [
            {
                statusCode: '400',
                responseModels,
                responseParameters: methodResponseParameters,
            },
            {
                statusCode: '401',
                responseModels,
                responseParameters: methodResponseParameters,
            },
            {
                statusCode: '403',
                responseModels,
                responseParameters: methodResponseParameters,
            },
            {
                statusCode: '500',
                responseModels,
                responseParameters: methodResponseParameters,
            }];
        this.methodErrorResponses = methodErrorResponses;

        this.methodProps = {
            methodResponses: [
                {
                    statusCode: '200',
                    responseModels,
                    responseParameters: methodResponseParameters,
                },
                ...methodErrorResponses,
            ],
        };

        // CORS OPTIONS Helpers ==================================================

        if (corsProps) {
            // CORS Response Template (for OPTIONS methods)
            this.optionsMethodProps = {
                methodResponses: [
                    {
                        statusCode: '204',
                        responseModels,
                        responseParameters: methodResponseParameters,
                    },
                ],
            };

            // CORS Integration - sets Allow-Origin header for the OPTIONS method
            this.optionsIntegration = new MockIntegration({
                integrationResponses: [
                    {
                        statusCode: '204',
                        responseTemplates: {
                            'application/json': `
                                #set($domains = ${corsString})
                                #set($origin = $input.params("origin"))
                                #if($domains.contains($origin))
                                #set($context.responseOverride.header.Access-Control-Allow-Origin="$origin")
                                #end
                                `,
                        },
                        responseParameters: integrationResponseParameters,
                    },
                ],
                passthroughBehavior: PassthroughBehavior.NEVER,
                requestTemplates: {
                    'application/json': '{ "statusCode": 204 }',
                },
            });
        }

        // Request Template Helpers =========================================
        // Standard context object
        this.contextStr = `
        "context": {
            "resourcePath" : "$context.resourcePath",
            "httpMethod": "$context.httpMethod",
            "requestId": "$context.requestId",
            "sourceIp": "$context.identity.sourceIp",
            "xForwardedFor": "$input.params().header.X-Forwarded-For"
            }`;

        // requestTemplate including input body (standard for PUT and POST requests)
        this.inputBodyRequestTemplate = {
            'application/json': `{
                    "params": $input.json('$'),
                    ${this.contextStr}
                }`,
        };

        // responseTemplate with cors allow origin
        this.corsHeaderString = `
                #set($domains = ${corsString})
                #set($origin = $input.params("origin"))
                #if($domains.contains($origin))
                #set($context.responseOverride.header.Access-Control-Allow-Origin="$origin")
                #end
                `;
    }
}
