// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');
const moment = require('moment');
const shortid = require('shortid');
const { SOLUTION_ID, VERSION } = process.env; 
let options = {};
if (SOLUTION_ID && VERSION && SOLUTION_ID.trim() && VERSION.trim()) {
  options.customUserAgent = `AwsSolution/${SOLUTION_ID}/${VERSION}`;
}
AWS.config.logger = console;

const s3 = new AWS.S3(options);
const lambda = new AWS.Lambda(options);
options.region = process.env.AWS_REGION;
const dynamoDB = new AWS.DynamoDB.DocumentClient(options);
const stepFunctions = new AWS.StepFunctions(options);
const ecs = new AWS.ECS(options);
const cloudwatch = new AWS.CloudWatch(options);
const cloudwatchLogs = new AWS.CloudWatchLogs(options);
const cloudwatchevents = new AWS.CloudWatchEvents(options);


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
                'startTime',
                'nextRun',
                'scheduleRecurrence'
            ],
        };
        return await dynamoDB.scan(params).promise();
    } catch (err) {
        throw err;
    }
};

/**
 * @function scheduleTest
 * Description: Schedules test and returns a consolidated list of test scenarios
 * @event {object} test sevent information
 * @context {object} the lambda context information
 */
const scheduleTest = async (event, context) => {
    try{
        let config = JSON.parse(event.body);
        const { testId, scheduleDate, scheduleTime } = config;
        const [ hour, minute ] = scheduleTime.split(':');
        let [ year, month, day ] = scheduleDate.split('-');
        let nextRun = `${year}-${month}-${day} ${hour}:${minute}:00`;
        const functionName = context.functionName;
        const functionArn = context.functionArn;
        let scheduleRecurrence = "";

        //check if rule exists, delete rule if exists
        let rulesResponse = await cloudwatchevents.listRules({NamePrefix: testId}).promise();

        for(let rule of rulesResponse.Rules) {
            let ruleName = rule.Name;
            await cloudwatchevents.removeTargets({Rule: ruleName, Ids: [ruleName]}).promise();
            await lambda.removePermission({FunctionName: functionName, StatementId: ruleName}).promise();
            await cloudwatchevents.deleteRule({Name: ruleName}).promise();
        }


        if(config.scheduleStep === 'create') {
            //Schedule for 1 min prior to account for time it takes to create rule
            const createRun = moment([year, parseInt(month, 10) - 1, day, hour, minute]).subtract(1, 'minute').format('YYYY-MM-DD HH:mm:ss');
            let [ createDate, createTime ] = createRun.split(" ");
            const [ createHour, createMin ] = createTime.split(':');
            const [ createYear, createMonth, createDay ] = createDate.split('-');
            const cronStart = `cron(${createMin} ${createHour} ${createDay} ${createMonth} ? ${createYear})`;
            scheduleRecurrence = config.recurrence;

            //Create rule to create schedule 
            const createRuleParams = {
                Name: `${testId}Create`,
                Description: `Create test schedule for: ${testId}`,
                ScheduleExpression: cronStart,
                State: 'ENABLED'
            };
            let ruleArn = await cloudwatchevents.putRule(createRuleParams).promise();

            //Add permissions to lambda
            let permissionParams = {
                Action: "lambda:InvokeFunction",
                FunctionName: functionName,
                Principal: "events.amazonaws.com",
                SourceArn: ruleArn.RuleArn,
                StatementId: `${testId}Create`
            }
            await lambda.addPermission(permissionParams).promise();

            //modify schedule step in input params
            config.scheduleStep = "start";
            event.body = JSON.stringify(config);

            //add target
            let createTargetParams = {
                Rule: `${testId}Create`,
                Targets: [{
                    Arn: functionArn,
                    Id: `${testId}Create`,
                    Input: JSON.stringify(event),
                }]
            };
            await cloudwatchevents.putTargets(createTargetParams).promise();
        } else {
            //create schedule expression
            let scheduleString;
            if(config.recurrence) {
                scheduleRecurrence = config.recurrence;
                switch(config.recurrence) {
                    case "daily":
                        scheduleString = "rate(1 day)";
                        break;
                    case "weekly":
                        scheduleString = "rate(7 days)";
                        break;
                    case "biweekly":
                        scheduleString = "rate(14 days)";
                        break;
                    case "monthly":
                        scheduleString = `cron(${minute} ${hour} ${day} * ? *)`;
                        break;
                    default: throw {
                        message: `Invalid recurrence value.`,
                        code: 'InvalidParameter',
                        status: 400
                    };
                }
            } else {
                scheduleString = `cron(${minute} ${hour} ${day} ${month} ? ${year})`;
            }

            //Create rule to run on schedule
            const ruleParams = {
                Name: `${testId}Scheduled`,
                Description: `Scheduled tests for ${testId}`,
                ScheduleExpression: scheduleString,
                State: 'ENABLED'
            };
            let ruleArn = await cloudwatchevents.putRule(ruleParams).promise();

            //Add permissions to lambda
            let permissionParams = {
                Action: "lambda:InvokeFunction",
                FunctionName: functionName,
                Principal: "events.amazonaws.com",
                SourceArn: ruleArn.RuleArn,
                StatementId: `${testId}Scheduled`
            };
            await lambda.addPermission(permissionParams).promise();

            //remove schedule step in params
            delete config.scheduleStep;
            event.body = JSON.stringify(config);

            //add target to rule
            let targetParams = {
                Rule: `${testId}Scheduled`,
                Targets: [{
                    Arn: functionArn,
                    Id: `${testId}Scheduled`,
                    Input: JSON.stringify(event),
                }]
            };
            await cloudwatchevents.putTargets(targetParams).promise();

            //Remove rule created during create schedule step 
            if(config.recurrence) {
                let ruleName = `${testId}Create`;
                await cloudwatchevents.removeTargets({Rule: ruleName, Ids: [ruleName]}).promise();
                await lambda.removePermission({FunctionName: functionName, StatementId: ruleName}).promise();
                await cloudwatchevents.deleteRule({Name: ruleName}).promise();                
            }
        }

        //Update DynamoDB if table was not already updated by "create" schedule step
        if(config.scheduleStep || !config.recurrence) {
            let params = {
                TableName: process.env.SCENARIOS_TABLE,
                Key: {
                    testId: testId
                },
                UpdateExpression: 'set #n = :n, #d = :d, #c = :c, #t = :t, #s = :s, #r = :r, #st = :st, #et = :et, #nr = :nr, #sr = :sr, #tt = :tt, #ft = :ft',
                ExpressionAttributeNames: {
                    '#n': 'testName',
                    '#d': 'testDescription',
                    '#c': 'taskCount',
                    '#t': 'testScenario',
                    '#s': 'status',
                    '#r': 'results',
                    '#st': 'startTime',
                    '#et': 'endTime',
                    '#nr': 'nextRun',
                    '#sr': 'scheduleRecurrence',
                    '#tt': 'testType',
                    '#ft': 'fileType'
                },
                ExpressionAttributeValues: {
                    ':n': config.testName,
                    ':d': config.testDescription,
                    ':c': config.taskCount,
                    ':t': JSON.stringify(config.testScenario),
                    ':s': 'scheduled',
                    ':r': {},
                    ':st': "",
                    ':et': '',
                    ':nr': nextRun,
                    ':sr': scheduleRecurrence,
                    ':tt': config.testType,
                    ':ft': config.fileType
                },
                ReturnValues: 'ALL_NEW'
            };
            let data = await dynamoDB.update(params).promise();

            console.log(`Schedule test complete: ${JSON.stringify(data, null, 2)}`);

            return data.Attributes;
        }
        else {
            console.log(`Succesfully created schedule rule for test: ${testId}`);
        }
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
        let nextRun = "";
        let scheduleRecurrence = "";
        if(config.recurrence){
            scheduleRecurrence = config.recurrence;
            switch(config.recurrence) {
                case "daily":
                    nextRun = moment().utc().add(1, 'd').format('YYYY-MM-DD HH:mm:ss');
                    break;
                case "weekly":
                    nextRun = moment().utc().add(7, 'd').format('YYYY-MM-DD HH:mm:ss');
                    break;
                case "biweekly":
                    nextRun = moment().utc().add(14, 'd').format('YYYY-MM-DD HH:mm:ss');
                    break;
                case "monthly":
                    nextRun = moment().utc().add(1, 'M').format('YYYY-MM-DD HH:mm:ss');
                    break;
                default: throw {
                    message: `Invalid recurrence value.`,
                    code: 'InvalidParameter',
                    status: 400
                };
            }
        }

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
            || parseInt(testScenario.execution[0].concurrency) < 1) {
            throw {
                message: 'Concurrency should be positive number',
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
            UpdateExpression: 'set #n = :n, #d = :d, #c = :c, #t = :t, #s = :s, #r = :r, #st = :st, #et = :et, #nr = :nr, #sr = :sr, #tt = :tt, #ft = :ft',
            ExpressionAttributeNames: {
                '#n': 'testName',
                '#d': 'testDescription',
                '#c': 'taskCount',
                '#t': 'testScenario',
                '#s': 'status',
                '#r': 'results',
                '#st': 'startTime',
                '#et': 'endTime',
                '#nr': 'nextRun',
                '#sr': 'scheduleRecurrence',
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
                ':nr': nextRun,
                ':sr': scheduleRecurrence,
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
        //convert testScenario back into an object
        data.testScenario = JSON.parse(data.testScenario);

        if (data.status === 'running') {
            console.log(`testId: ${testId} is still running`);

            //1. Get list of task for testId
            data.tasks = [];
            params = {
                cluster: process.env.TASK_CLUSTER,
                startedBy: testId
            };
            let tasks = [];
            let tasksResponse;
            do {
                tasksResponse = await ecs.listTasks(params).promise();
                tasks = tasks.concat(tasksResponse.taskArns);
                params.nextToken = tasksResponse.nextToken;
            
            } while(tasksResponse.nextToken);

            //2. describe tasks
            if (tasks.length !== 0 ) {
                params = {
                    cluster: process.env.TASK_CLUSTER,
                };

                let describeTasksResponse;
                while(tasks.length > 0)
                {
                    //get groups of 100 tasks
                    params.tasks = tasks.splice(0, 100);
                    describeTasksResponse = await ecs.describeTasks(params).promise();
                    //add tasks to returned value for use in UI
                    data.tasks = data.tasks.concat(describeTasksResponse.tasks);
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
 * @functionName {string} the name of the task runner lambda function
 */
const deleteTest = async (testId, functionName) => {
    console.log(`Delete test, testId: ${testId}`);
    try {
        //delete metric filter, if no metric filters log error and continue delete
        const metrics = ["numVu", "numSucc", "numFail", "avgRt"];
        for (let metric of metrics) {
            let deleteMetricFilterParams = {
                filterName: `${process.env.TASK_CLUSTER}-Ecs${metric}-${testId}`,
                logGroupName: process.env.ECS_LOG_GROUP
            };
            await cloudwatchLogs.deleteMetricFilter(deleteMetricFilterParams).promise();
        }
    } catch (err) {
        if(err.code === 'ResourceNotFoundException') {
            console.error(err);
        }
        else {
            throw err;
        }
    }

    try {
        //Delete Dashboard
        const deleteDashboardParams = { DashboardNames: [ `EcsLoadTesting-${testId}` ] };
        await cloudwatch.deleteDashboards(deleteDashboardParams).promise();


        //Get Rules
        let rulesResponse = await cloudwatchevents.listRules({NamePrefix: testId}).promise();
        //Delete Rule
        for(let rule of rulesResponse.Rules) {
            let ruleName = rule.Name;
            await cloudwatchevents.removeTargets({Rule: ruleName, Ids: [ruleName]}).promise();
            await lambda.removePermission({FunctionName: functionName, StatementId: ruleName}).promise();
            await cloudwatchevents.deleteRule({Name: ruleName}).promise();
        }

 
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
        //cancel tasks
        let params;
        params = {
            FunctionName: process.env.TASK_CANCELER_ARN, 
            InvocationType: "Event", 
            Payload: JSON.stringify({
                testId: testId
            })
        };
        await lambda.invoke(params).promise(); 

        //Update the status in the scenarios table.
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
                ':s': 'cancelling'
            }
        };
        await dynamoDB.update(params).promise();

        return 'test cancelling';
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
        let data = await ecs.listTasks(params).promise();
        let taskArns = data.taskArns;
        while(data.nextToken) {
            params.nextToken = data.nextToken;
            data = await ecs.listTasks(params).promise();
            taskArns.push(data.taskArns);
        }
        return taskArns;
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
    listTasks:listTasks,
    scheduleTest:scheduleTest
};