// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');
const moment = require('moment');
const shortid = require('shortid');

AWS.config.logger = console;

const s3 = new AWS.S3();
const dynamoDB = new AWS.DynamoDB.DocumentClient({ region: process.env.AWS_REGION });
const stepFunctions = new AWS.StepFunctions({ region : process.env.AWS_REGION });
const ecs = new AWS.ECS({ region: process.env.AWS_REGION });

/**
 * @function listTests
 * Description: returns a consolidated list of test scenarios
 */
const listTests = async () => {
    console.log('List tests');

    try {
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
        return await dynamoDB.scan(params).promise();
    } catch (err) {
        throw err;
    }
};

/**
 * @function createTest
 * Description: returns a consolidated list of test scenarios
 * @config {object} test scenario configuration
 */
const createTest = async (config) => {
    console.log(`Create test: ${JSON.stringify(config, null, 2)}`);

    try {
        let params;
        let data;

        const { testName, testDescription, testType } = config;
        let { testId, testScenario, taskCount, fileType } = config;

        // When no fileType, fileType is script.
        if (testType === 'simple') {
            fileType = 'none';
        } else if (!fileType) {
            fileType = 'script';
        }

        // When acessing API directly and no testId
        if (testId === undefined) {
            testId = shortid.generate();
        }

        const startTime = moment().utc().format('YYYY-MM-DD HH:mm:ss');
        const numRegex = /^\d+$/;
        const timeRegex = /[a-z]+|[^a-z]+/gi;
        const timeUnits = ['ms', 's', 'm', 'h', 'd'];

        /**
         * Validates if time unit are valid.
         * @param {string} key Key to validate (ramp-up, hold-for)
         * @param {number} min Minimum number for the value
         */
        const validateTimeUnit = (key, min) => {
            if (typeof testScenario.execution[0][key] === 'string') {
                testScenario.execution[0][key] = testScenario.execution[0][key].replace(/\s/g, '');
            }
            if (!numRegex.test(testScenario.execution[0][key])) {
                let patterns = testScenario.execution[0][key].match(timeRegex);
                if (patterns.length === 0 || patterns.length % 2 !== 0) {
                    throw {
                        message: `Invalid ${key} value.`,
                        code: 'InvalidParameter',
                        status: 400
                    };
                }

                let result = '';
                for (let i = 0, length = patterns.length; i < length; i++) {
                    let value = patterns[i];
                    if (i % 2 === 0) {
                        // Number
                        if (!numRegex.test(value) || parseInt(value) < min) {
                            throw {
                                message: `${key} should be positive number equal to or greater than ${min}.`,
                                code: 'InvalidParameter',
                                status: 400
                            };
                        }
                        result = `${result}${parseInt(value)}`;
                    } else {
                        // Unit
                        if (!timeUnits.includes(value)) {
                            throw {
                                message: `${key} unit should be one of these: ms, s, m, h, d.`,
                                code: 'InvalidParameter',
                                status: 400
                            };
                        }
                        result = `${result}${value}`;
                    }
                }

                testScenario.execution[0][key] = result;
            } else {
                testScenario.execution[0][key] = parseInt(testScenario.execution[0][key]);
                if (testScenario.execution[0][key] < min) {
                    throw {
                        message: `${key} should be positive number equal to or greater than ${min}.`,
                        code: 'InvalidParameter',
                        status: 400
                    };
                }
            }
        }

        // Task count
        if (typeof taskCount === 'string') {
            taskCount = taskCount.trim();
        }
        if (!numRegex.test(taskCount)
            || parseInt(taskCount) < 1
            || parseInt(taskCount) > 1000) {
            throw {
                message: 'Task count should be positive number between 1 to 1000.',
                code: 'InvalidParameter',
                status: 400
             };
        }
        taskCount = parseInt(taskCount);

        // Concurrency
        if (typeof testScenario.execution[0].concurrency === 'string') {
            testScenario.execution[0].concurrency = testScenario.execution[0].concurrency.trim();
        }
        if (!numRegex.test(testScenario.execution[0].concurrency)
            || parseInt(testScenario.execution[0].concurrency) < 1
            || parseInt(testScenario.execution[0].concurrency) > 200) {
            throw {
                message: 'Concurrency should be positive number between 1 to 200.',
                code: 'InvalidParameter',
                status: 400
             };
        }
        testScenario.execution[0].concurrency = parseInt(testScenario.execution[0].concurrency);

        // Ramp up
        validateTimeUnit('ramp-up', 0);

        // Hold for
        validateTimeUnit('hold-for', 1);

        // Add reporting to Test Scenario so that the end results are export to
        // Amazon s3 by each task.
        testScenario.reporting = [{
            "module": "final-stats",
            "summary": true,
            "percentiles": true,
            "summary-labels": true,
            "test-duration": true,
            "dump-xml": "/tmp/artifacts/results.xml"
        }];

        console.log('TEST:: ', JSON.stringify(testScenario, null, 2) );

        // 1. Write test scenario to S3
        params = {
            Body: JSON.stringify(testScenario),
            Bucket: process.env.SCENARIOS_BUCKET,
            Key: `test-scenarios/${testId}.json`
        };
        await s3.putObject(params).promise();

        console.log(`test scenario upoladed to s3: test-scenarios/${testId}.json`);

        // 2. Start Step Functions execution
        await stepFunctions.startExecution({
            stateMachineArn: process.env.STATE_MACHINE_ARN,
            input: JSON.stringify({
                scenario: {
                    testId: testId,
                    taskCount: taskCount,
                    testType: testType,
                    fileType: fileType
                }
            })
        }).promise();

        // 3. Update DynamoDB. values for history and endTime are used to remove the old data.
        params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            UpdateExpression: 'set #n = :n, #d = :d, #c = :c, #t = :t, #s = :s, #r = :r, #st = :st, #et = :et, #tt = :tt, #ft = :ft',
            ExpressionAttributeNames: {
                '#n': 'testName',
                '#d': 'testDescription',
                '#c': 'taskCount',
                '#t': 'testScenario',
                '#s': 'status',
                '#r': 'results',
                '#st': 'startTime',
                '#et': 'endTime',
                '#tt': 'testType',
                '#ft': 'fileType'
            },
            ExpressionAttributeValues: {
                ':n': testName,
                ':d': testDescription,
                ':c': taskCount,
                ':t': JSON.stringify(testScenario),
                ':s': 'running',
                ':r': {},
                ':st': startTime,
                ':et': 'running',
                ':tt': testType,
                ':ft': fileType
            },
            ReturnValues: 'ALL_NEW'
        };
        data = await dynamoDB.update(params).promise();

        console.log(`Create test complete: ${data}.json`);

        return data.Attributes;
    } catch (err) {
        throw err;
    }
};

/**
 * @function getTest
 * Description: returns all data related to a specific testId
 * @testId {string} the unique id of test scenario to return.
 */
const getTest = async (testId) => {
    console.log(`Get test details for testId: ${testId}`);

    try {
        let data;
        let params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            }
        };
        data = await dynamoDB.get(params).promise();
        data = data.Item;
        //covert testSceario back into an object
        data.testScenario = JSON.parse(data.testScenario);

        if (data.status === 'running') {
            console.log(`testId: ${testId} is still running`);

            //1. Get list of task for testId
            data.tasks = [];
            params = {
                cluster: process.env.TASK_CLUSTER
            };

            const tasks = await ecs.listTasks(params).promise();

            //2. check if any running task are associated with the testId
            if (tasks.taskArns && tasks.taskArns.length !== 0 ) {
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

        return data;
    } catch (err) {
        throw err;
    }
};

/**
 * @function deleteTest
 * Description: deletes all data related to a specific testId
 * @testId {string} the unique id of test scenario to delete
 * e.
 */
const deleteTest = async (testId) => {
    console.log(`Delete test, testId: ${testId}`);

    try {
        const params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            }
        };
        await dynamoDB.delete(params).promise();

        return 'success';
    } catch (err) {
        console.error(err);
        throw err;
    }
};

/**
 * @function cancelTest
 * Description: stop all tasks related to a specific testId
 * @testId {string} the unique id of test scenario to stop.
 * e.
 */
const cancelTest = async (testId) => {
    console.log(`Cancel test for testId: ${testId}`);

    try {
        let data, params;

        //1. get a list of all running tasks
        params = {
            cluster: process.env.TASK_CLUSTER,
            desiredStatus: 'RUNNING'
        };

        data =  await ecs.listTasks(params).promise();

        //2. check if any running task are associated with the testId
        if (data.taskArns && data.taskArns.length !== 0 ) {
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
                    console.log('no task running for testId: ',testId);
                }
            }
        } else {
            console.log('no task running for testId: ',testId);
        }

        //4. Update the status in the scenarios table.
        params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            UpdateExpression: 'set #s = :s',
            ExpressionAttributeNames: {
                '#s':'status'
            },
            ExpressionAttributeValues: {
                ':s': 'cancelled'
            }
        };
        await dynamoDB.update(params).promise();

        return 'test cancelled';
    } catch (err) {
        throw err;
    }
};

/**
 * @function listTasks
 * Description: returns a list of ecs tasks
 */
const listTasks = async () => {
    console.log('List tasks');

    try {
        //Get list of running tasks
        let params = {
            cluster: process.env.TASK_CLUSTER
        };
        const data = await ecs.listTasks(params).promise();
        return data.taskArns;
    } catch (err) {
        throw err;
    }
};

module.exports = {
    listTests: listTests,
    createTest: createTest,
    getTest: getTest,
    deleteTest: deleteTest,
    cancelTest: cancelTest,
    listTasks:listTasks
};