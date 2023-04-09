/**
 * Will deploy into the current default CLI account.
 *
 * Deployment:
 * cdk deploy --all
 */

import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { ApplicationStack } from '../src/stacks';
import { options } from '../config';

const app = new App();

// use account details from default AWS CLI credentials:
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;

// Create API and Web stack
new ApplicationStack(app, 'DemoApplicationStack', {
    description: 'Web Application',
    env: { account, region },
    ...options,
});
