// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');
const ecs = new AWS.ECS({
    region: process.env.AWS_REGION
});
const dynamo = new AWS.DynamoDB.DocumentClient({
    region: process.env.AWS_REGION
});

exports.handler = async (event) => {
    console.log(JSON.stringify(event, null, 2));

    const { scenario } = event;
    const { testId, taskCount, testType } = scenario;

    try {
        /**
         * Prefix is reversed date. e.g. 878.14:32:40T30-90-0202
         * Each tasks are going to create new result object in S3.
         * Prefix is going to be used to distinguish the current result S3 objects.
         */
        const prefix = new Date().toISOString().replace('Z', '').split('').reverse().join('');

        // Run tasks in batches of 10
        const params = {
            taskDefinition: process.env.TASK_DEFINITION,
            cluster: process.env.TASK_CLUSTER,
            count: 0,
            group: testId,
            launchType: 'FARGATE',
            networkConfiguration: {
                awsvpcConfiguration: {
                    assignPublicIp: 'ENABLED',
                    securityGroups: [ process.env.TASK_SECURITY_GROUP ],
                    subnets: [
                        process.env.SUBNET_A,
                        process.env.SUBNET_B
                    ]
                }
            },
            overrides: {
                containerOverrides: [{
                    name: process.env.TASK_IMAGE,
                    environment: [
                        {
                            name: 'S3_BUCKET',
                            value: process.env.SCENARIOS_BUCKET
                        },
                        {
                            name: 'TEST_ID',
                            value: testId
                        },
                        {
                            name: 'TEST_TYPE',
                            value: testType
                        },
                        {
                            name: 'PREFIX',
                            value: prefix
                        }
                    ]
                }]
            }
        };

        /**
         * The max number of containers (taskCount) per task execution is 10 so if the taskCount is
         * more than 10 the task definition will need to be run multiple times.
         * @runTaskCount is the number of sets of 10 in the taskCount
         */
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        let runTaskCount = taskCount;
        params.count = 10;
        while (runTaskCount >= 10) {
            console.log('RUNNING TEST WITH 10');
            await ecs.runTask(params).promise();
            console.log('sleep 10 seconds to avoid ThrottlingException');
            await sleep(10000);
            runTaskCount -= 10;
        }

        // run the final task definition with the remaining count.
        if (runTaskCount > 0) {
            params.count = runTaskCount;
            console.log(`RUNNING TEST WITH FINAL COUNT: ${runTaskCount}`);
            await ecs.runTask(params).promise();
        }

        console.log('success');
        return { scenario, prefix };
    } catch (err) {
        console.error(err);
        // Update DynamoDB with Status FAILED and Error Message
        let params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            UpdateExpression: 'set #s = :s, #e = :e',
            ExpressionAttributeNames: {
                '#s': 'status',
                '#e': 'taskError'
            },
            ExpressionAttributeValues: {
                ':s': 'failed',
                ':e': err
            }
        };
        await dynamo.update(params).promise();
        throw err;
    }
};
