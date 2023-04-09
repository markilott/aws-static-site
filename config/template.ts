import { ApplicationStackProps } from 'types';

export const options: ApplicationStackProps = {
    svcName: '',
    apiHostname: '',
    webHostname: '',
    zoneProps: {
        hostedZoneId: '',
        zoneName: '',
    },
    allowCidrs: [],
    /** CloudFront certificate */
    cfCertArn: '',
    /** API certificate */
    appCertArn: '',
};
