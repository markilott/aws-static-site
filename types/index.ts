import { StackProps } from 'aws-cdk-lib';

/**
 * Application Stack Props.
 * All are optional.
 */
export interface ApplicationStackProps extends StackProps {
    /**
     * Service Name for use in resource names,
     * and in the log and metric namespaces.
     */
    svcName?: string,

    /**
     * API Hostname
     * @default 'api'
     */
    apiHostname?: string,

    /**
     * Website Hostname
     * @default 'itc561'
     */
    webHostname?: string,

    /**
     * Allow CIDR ranges to access API.
     * Adding CIDR ranges here will block all other IP ranges
     * from accessing the API Gateway.
     * Use the format '123.456.123.12/32' if you are adding a single IP address
     * for your own connection.
     */
    allowCidrs?: string[],

    /** Route 53 Domain */
    zoneProps?: {
        /** The Zone Id from Route53 */
        hostedZoneId: string,
        /** The domain name */
        zoneName: string,
    },

    /** CloudFront certificate */
    cfCertArn?: string,

    /** API certificate */
    appCertArn?: string,
}
