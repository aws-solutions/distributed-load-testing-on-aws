/*******************************************************************************
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. 
 *
 * Licensed under the Amazon Software License (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0    
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 *
 ********************************************************************************/

const AWS = require('aws-sdk');
const moment = require('moment');
const shortid = require('shortid');

AWS.config.logger = console;


/** 
 * @function listTests 
 * Description: returns a consolidated list of test scenarios 
 */
const listTests = async () => {

    const dynamoDB = new AWS.DynamoDB.DocumentClient({
        region: process.env.AWS_REGION
    });

    let data;

    try {

        console.log('List tests');

        const params = {
            TableName: process.env.SCENARIOS_TABLE,
            AttributesToGet: [
                'testId',
                'testName',
                'testDescription',
                'status',
                'startTime'
            ],
        };
        data = await dynamoDB.scan(params).promise();
    } catch (err) {
        throw err;
    }
    return data;
};


/** 
 * @function createTest 
 * Description: returns a consolidated list of test scenarios 
 * @testId {string} Id for the test (if a new test value is null) 
 * @config {object} test scenario configuration 
 */
const createTest = async (config) => {

    const s3 = new AWS.S3();
    const dynamo = new AWS.DynamoDB.DocumentClient({
        region: process.env.AWS_REGION
    });
    const sqs = new AWS.SQS({
        region: process.env.AWS_REGION
    });

    let params;
    let data;

    try {

        console.log(`Create test: ${JSON.stringify(config, null, 2)}`);

        const testName = config.testName;
        const testDescription = config.testDescription;
        const testConfig = config.testConfig;
        const taskCount = config.taskCount;
        const startTime = moment().utc().format('YYYY-MM-DD HH:mm:ss');

        console.log('TEST:: ', JSON.stringify(testConfig, null, 2))

        // 1. Check for a testId delete any old records from the results table 
        let testId;

        if (config.testId) {
            testId = config.testId;

            params = {
                TableName: process.env.RESULTS_TABLE,
                FilterExpression: 'testId = :id',
                ExpressionAttributeValues: {
                    ':id': testId
                }
            };
            data = await dynamo.scan(params).promise();

            if (data.Items.length !== 0) {

                for (let i in data.Items) {
                    params = {
                        TableName: process.env.RESULTS_TABLE,
                        Key: {
                            uuid: data.Items[i].uuid
                        }
                    };
                    await dynamo.delete(params).promise();
                }
            }
        } else {
            testId = shortid.generate();
        }

        // 2. Write test scenario to S3
        params = {
            Body: JSON.stringify(testConfig),
            Bucket: process.env.SCENARIOS_BUCKET,
            Key: `test-scenarios/${testId}.json`
        };
        await s3.putObject(params).promise();

        console.log(`test scenario upoladed to s3: test-scenarios/${testId}.json`);

        // 3. Send id and task count to SQS
        params = {
            MessageBody: JSON.stringify({ testId: testId, taskCount: taskCount }),
            QueueUrl: process.env.SQS_URL
        };
        await sqs.sendMessage(params).promise();

        // 4. Update DynamoDB. values for history, taskIds and endTime are used to remove the old data. 
        params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            UpdateExpression: 'set #n = :n, #d = :d, #c = :c, #t = :t, #s = :s, #r = :r, #i=:i, #st = :st, #et = :et',
            ExpressionAttributeNames: {
                '#n': 'testName',
                '#d': 'testDescription',
                '#c': 'taskCount',
                '#t': 'testConfig',
                '#s': 'status',
                '#r': 'results',
                '#i': 'taskIds',
                '#st': 'startTime',
                '#et': 'endTime'
            },
            ExpressionAttributeValues: {
                ':n': testName,
                ':d': testDescription,
                ':c': taskCount,
                ':t': JSON.stringify(testConfig),
                ':s': 'running',
                ":r": {},
                ":i": [],
                ':st': startTime,
                ':et': 'running'
            },
            ReturnValues: 'ALL_NEW'
        };
        data = await dynamo.update(params).promise();

        console.log(`Create test complete: ${data}.json`);

    } catch (err) {
        throw err;
    }
    return data.Attributes;
};


/** 
 * @function getTest 
 * Description: returns all data related to a specific testId 
 * @testId {string} the unique id of test scenario to return. 
 */
const getTest = async (testId) => {

    const dynamoDB = new AWS.DynamoDB.DocumentClient({
        region: process.env.AWS_REGION
    });
    const cloudwatch = new AWS.CloudWatch({
        region: process.env.AWS_REGION
    });
    const ecs = new AWS.ECS({
        region: process.env.AWS_REGION
    });

    let data;

    try {

        console.log(`Get test details for testId: ${testId}`);

        let params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            }
        };
        data = await dynamoDB.get(params).promise();
        data = data.Item;
        // Convert testConfig back into an object
        data.testConfig = JSON.parse(data.testConfig);

        if (data.status === 'running') {

            console.log(`testId: ${testId} is still running`);

            //Get list of task for testId 
            data.tasks = [];
            params = {
                cluster: process.env.TASK_CLUSTER
            };

            const tasks = await ecs.listTasks(params).promise();

            //2. check if any running task are associated with the testId 
            if (tasks.taskArns && tasks.taskArns.length != 0) {

                params = {
                    cluster: process.env.TASK_CLUSTER,
                    tasks: tasks.taskArns
                };

                const testTasks = await ecs.describeTasks(params).promise();

                //3. list any tasks associated with the testId 
                for (let i in testTasks.tasks) {

                    if (testTasks.tasks[i].group === testId) {
                        data.tasks.push(testTasks.tasks[i]);
                    }
                }
            }
        }

    } catch (err) {
        throw err;
    }
    return data;
};


/** 
 * @function deleteTest 
 * Description: deletes all data related to a specific testId 
 * @testId {string} the unique id of test scenario to delete 
 * e. 
 */
const deleteTest = async (testId) => {

    const dynamoDB = new AWS.DynamoDB.DocumentClient({
        region: process.env.AWS_REGION
    });

    try {

        console.log(`Delete test, testId: ${testId}`);

        const params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            }
        };
        await dynamoDB.delete(params).promise();

    } catch (err) {
        throw err;
    }
    return 'success';
};


/** 
 * @function cancelTest 
 * Description: stop all tasks related to a specific testId 
 * @testId {string} the unique id of test scenario to stop. 
 * e. 
 */
const cancelTest = async (testId) => {

    const dynamo = new AWS.DynamoDB.DocumentClient({
        region: process.env.AWS_REGION
    });

    const ecs = new AWS.ECS({
        region: process.env.AWS_REGION
    });

    let data, params;

    try {

        console.log(`Cancel test for testId: ${testId}`);

        //1. get a list of all running tasks 
        params = {
            cluster: process.env.TASK_CLUSTER,
            desiredStatus: 'RUNNING'
        };

        data = await ecs.listTasks(params).promise();

        //2. check if any running task are associated with the testId 
        if (data.taskArns && data.taskArns.length != 0) {

            params = {
                cluster: process.env.TASK_CLUSTER,
                tasks: data.taskArns
            };

            data = await ecs.describeTasks(params).promise();

            //3. stop any tasks associated with the testId 
            for (let i in data.tasks) {
                if (data.tasks[i].group === testId) {

                    console.log('Stopping ', data.tasks[i].taskArn);
                    params = {
                        cluster: process.env.TASK_CLUSTER,
                        task: data.tasks[i].taskArn
                    };
                    await ecs.stopTask(params).promise();
                } else {
                    console.log('no task running for testId: ', testId);
                }
            }
            //4. Update the status in the scenarios table. 
            params = {
                TableName: process.env.SCENARIOS_TABLE,
                Key: {
                    testId: testId
                },
                UpdateExpression: 'set #s = :s',
                ExpressionAttributeNames: {
                    '#s': 'status'
                },
                ExpressionAttributeValues: {
                    ':s': 'cancelled'
                }
            };
            await dynamo.update(params).promise();

        } else {
            console.log('no task running for testId: ', testId);
        }

    } catch (err) {
        throw err;
    }
    return 'test cancelled';
};


/** 
 * @function listTasks 
 * Description: returns a list of ecs tasks
 */
const listTasks = async () => {

    const ecs = new AWS.ECS({
        region: process.env.AWS_REGION
    });

    let data;

    try {

        console.log('List tasks');

        //Get list of running tasks
        let params = {
            cluster: process.env.TASK_CLUSTER
        };
        data = await ecs.listTasks(params).promise();
        data = data.taskArns;

    } catch (err) {
        throw err;
    }
    return data;
};


module.exports = {
    listTests: listTests,
    createTest: createTest,
    getTest: getTest,
    deleteTest: deleteTest,
    cancelTest: cancelTest,
    listTasks: listTasks
}; 