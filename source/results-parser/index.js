// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const parser = require('./lib/parser/');
const metrics = require('./lib/metrics/');
const AWS = require('aws-sdk');
const { SOLUTION_ID, VERSION } = process.env; 
let options = {};
if (SOLUTION_ID && VERSION && SOLUTION_ID.trim() && VERSION.trim()) {
  options.customUserAgent = `AwsSolution/${SOLUTION_ID}/${VERSION}`;
}
const s3 = new AWS.S3(options);
const dynamoDb = new AWS.DynamoDB.DocumentClient(options);

exports.handler = async (event) => {
    console.log(JSON.stringify(event, null, 2));
    const { scenario, prefix } = event;
    const { testId, fileType } = scenario;

    try {
        const ddbParams = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            AttributesToGet: [
                'startTime',
                'status',
                'testType'
            ]
        };
        const ddbGetResponse = await dynamoDb.get(ddbParams).promise();
        const { startTime, status, testType } = ddbGetResponse.Item;
        let totalDuration = 0;
        let testResult = status;

        if (!['cancelling', 'cancelled', 'failed'].includes(status)) {
            const bucket = process.env.SCENARIOS_BUCKET;
            let resultList = [];
            let nextContinuationToken = undefined;

            // Get the latest test result from S3
            do {
                const params = {
                    Bucket: bucket,
                    Prefix: `results/${testId}/${prefix}`
                };

                if (nextContinuationToken) {
                    params.ContinuationToken = nextContinuationToken
                }
                const result = await s3.listObjectsV2(params).promise();
                resultList = resultList.concat(result.Contents);
                nextContinuationToken = result.IsTruncated ? result.NextContinuationToken : null;
            } while (nextContinuationToken);

            if (resultList.length > 0) {
                const data = [];
                const promises = [];

                for (const content of resultList) {
                    promises.push(
                        s3.getObject({
                            Bucket: process.env.SCENARIOS_BUCKET,
                            Key: content.Key
                        }).promise()
                    );
                }

                const result = await Promise.all(promises);
                for (const content of result) {
                    const parsedResult = parser.results(content.Body, testId);
                    let duration = parseInt(parsedResult.duration);
                    totalDuration += isNaN(duration) ? 0 : duration;

                    data.push(parsedResult);
                }
                console.log('All Tasks Complete');

                // Parser final results and update dynamodb
                await parser.finalResults(testId, data, startTime);
                testResult = 'completed';
            } else {
                // If there's no result files in S3 bucket, there's a possibility that the test failed in the Fargate tasks.
                await dynamoDb.update({
                    TableName: process.env.SCENARIOS_TABLE,
                    Key: { testId },
                    UpdateExpression: 'set #s = :s, #e = :e',
                    ExpressionAttributeNames: {
                        '#s': 'status',
                        '#e': 'errorReason'
                    },
                    ExpressionAttributeValues: {
                        ':s': 'failed',
                        ':e': 'Test might be failed to run.'
                    }
                }).promise();
                testResult = 'failed';
            }
        }

        // Send anonymous metrics
        if (process.env.SEND_METRIC === 'Yes') {
            await metrics.send({ testType, totalDuration, fileType, testResult });
        }

        return 'success';
	} catch (error) {
        console.error(error);

        await dynamoDb.update({
            TableName: process.env.SCENARIOS_TABLE,
            Key: { testId },
            UpdateExpression: 'set #s = :s, #e = :e',
            ExpressionAttributeNames: {
                '#s': 'status',
                '#e': 'errorReason'
            },
            ExpressionAttributeValues: {
                ':s': 'failed',
                ':e': 'Failed to parse the results.'
            }
        }).promise();

        throw error;
    }
};
