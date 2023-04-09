/* eslint-disable import/no-extraneous-dependencies */
import { AWSError, DynamoDB } from 'aws-sdk';
import { Logger, injectLambdaContext } from '@aws-lambda-powertools/logger';
import { Tracer, captureLambdaHandler } from '@aws-lambda-powertools/tracer';
import middy from '@middy/core';
import { customAlphabet } from 'nanoid';
import moment = require('moment');

const {
    TABLE: table,
    MAX_DAYS: maxDays,
} = process.env;

/** Instantiate the PowerTools instances */
const logger = new Logger();
const tracer = new Tracer();

/** Wrap the AWS client in the tracer */
const docClient = tracer.captureAWSClient(new DynamoDB.DocumentClient({
    region: process.env.AWS_REGION,
}));

/** Registration Record */
type RegisterAttributes = {
    Name: string,
    Email: string,
    RegisterDate: string,
    LogTime: string,
    ReferenceId: string,
    ExpiryTime: number,
};

/** Event Props */
type EventProps = {
    context: {
        requestId: string,
        httpMethod: string,
    },
    params: {
        /** Name - required for registration */
        name?: string,
        /** Email - required for registration */
        email?: string,
        /** Requested date - required for registration */
        registerDate?: string,
        /** Reference - for query */
        reference?: string,
    }
};

/** Register Result */
type FunctionResult = {
    success: boolean,
    requestId: string,
    errorMessage?: string,
    data: {
        name?: string,
        email?: string,
        registerDate?: string,
        reference?: string,
    },
};

/** Generate a new registration Id */
const newId = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 10);

/** Check for valid date - must be between tomorrow and less than maxDays */
function validateDate(d: string) {
    const min = moment().add(1, 'd');
    const max = moment().add(Number(maxDays || 30), 'd');
    return moment(d).isValid() && moment(d).isBetween(min, max, 'day', '[]');
}

/**
 * Read, write and delete registration records to the table.
 */
const lambdaHandler = async (event: EventProps): Promise<FunctionResult> => {
    const { params, context } = event;
    const { requestId, httpMethod } = context;
    logger.appendKeys({ requestId });
    let statusCode = 500;

    try {
        if (!table) { throw new Error('Internal error: missing variable'); }
        if (!httpMethod) { throw new Error('Internal error: missing method'); }
        const method = httpMethod.toUpperCase();

        const {
            name = 'Anonymous', reference, email, registerDate,
        } = params;
        const logTime = moment().format();

        const result: FunctionResult = {
            success: true,
            requestId,
            data: {
            },
        };

        // Get record
        if (method === 'GET') {
            if (!email && !reference) {
                statusCode = 400;
                throw new Error('Email or reference is required');
            }

            const items = (await docClient.query({
                TableName: table,
                IndexName: (reference) ? 'refIndex' : undefined,
                KeyConditionExpression: (reference) ? 'ReferenceId = :field' : 'Email = :field',
                ExpressionAttributeValues: {
                    ':field': reference?.toUpperCase() || email?.toLowerCase(),
                },
            }).promise()).Items as RegisterAttributes[];
            if (!items.length) {
                result.success = false;
                result.errorMessage = (reference) ? `Reference ${reference} is not found. Please try again.` : `${email || 'Email'} is not registered. Please try again.`;
                return result;
            }

            const [{
                ReferenceId, Name, RegisterDate, Email,
            }] = items;
            result.data.email = Email;
            result.data.reference = ReferenceId;
            result.data.name = Name;
            result.data.registerDate = RegisterDate;
            return result;
        }

        // Delete record
        if (method === 'DELETE') {
            if (!email) {
                statusCode = 400;
                throw new Error('Email is required');
            }
            try {
                // Delete the record
                await docClient.delete({
                    TableName: table,
                    Key: { Email: email.toLowerCase() },
                }).promise();
                logger.debug(`Deleted registration: ${email}`);
                return result;
            } catch (err) {
                const error = err as AWSError;
                if (error.name === 'ResourceNotFoundException') {
                    statusCode = 400;
                    throw new Error(`${email} is not registered`);
                }
                throw err;
            }
        }

        // Validate for create and update
        if (!email || !registerDate) {
            statusCode = 400;
            throw new Error('Email and registration date are required');
        }
        if (!validateDate(registerDate)) {
            statusCode = 400;
            throw new Error('Invalid registration date');
        }

        // Create record
        if (method === 'POST') {
            try {
                result.data.reference = newId();
                result.data.registerDate = moment(registerDate).format('YYYY-MM-DD');
                result.data.email = email.toLowerCase();
                result.data.name = name;
                await docClient.put({
                    TableName: table,
                    Item: {
                        Name: name,
                        Email: result.data.email,
                        LogTime: logTime,
                        ReferenceId: result.data.reference,
                        RegisterDate: result.data.registerDate,
                        ExpiryTime: Number(moment(registerDate).endOf('day').format('X')),
                    },
                    ConditionExpression: 'attribute_not_exists(Email)',
                }).promise();
                return result;
            } catch (err) {
                const error = err as AWSError;
                if (error.name === 'ConditionalCheckFailedException') {
                    statusCode = 400;
                    throw new Error(`${email} is already registered`);
                }
                throw err;
            }
        }

        // Update record
        if (method === 'PATCH') {
            try {
                result.data.reference = newId();
                result.data.registerDate = moment(registerDate).format('YYYY-MM-DD');
                await docClient.update({
                    TableName: table,
                    Key: { Email: email.toLowerCase() },
                    UpdateExpression: 'set RegisterDate = :d, ReferenceId = :r, ExpiryTime = :x',
                    ExpressionAttributeValues: {
                        ':d': result.data.registerDate,
                        ':r': result.data.reference,
                        ':x': Number(moment(registerDate).endOf('day').format('X')),
                    },
                    ConditionExpression: 'attribute_exists(Email)',
                }).promise();
                return result;
            } catch (err) {
                const error = err as AWSError;
                if (error.name === 'ConditionalCheckFailedException') {
                    statusCode = 400;
                    throw new Error(`${email} is not registered`);
                }
                throw err;
            }
        }

        throw new Error('Internal error: invalid method');
    } catch (err) {
        if (!(err instanceof Error)) { throw err; }
        if (statusCode === 500) { logger.error('Handler Error', err); }
        if (statusCode === 400) { logger.warn('Registration Error', { message: err.message }); }

        // Set error message string for API Gateway to parse
        err.message = JSON.stringify({
            statusCode,
            message: (statusCode === 500) ? 'Internal server error' : err.message,
            requestId,
        });
        throw err;
    }
};

/** Wrap the handler with middy and inject PowerTools */
export const handler = middy(lambdaHandler)
    .use(captureLambdaHandler(tracer))
    .use(injectLambdaContext(logger, { clearState: true }));
