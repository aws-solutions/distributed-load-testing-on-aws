// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');
AWS.config.logger = console;
const { SOLUTION_ID, VERSION } = process.env; 
let options = {};
if (SOLUTION_ID && VERSION && SOLUTION_ID.trim() && VERSION.trim()) {
  options.customUserAgent = `AwsSolution/${SOLUTION_ID}/${VERSION}`;
}
options.region = process.env.AWS_REGION
const dynamoDB = new AWS.DynamoDB.DocumentClient(options);
const ecs = new AWS.ECS(options);

exports.handler = async (event) => {
    const testId = event.scenario ? event.scenario.testId : event.testId;
    console.log(`Cancelling test: ${testId}`);
    const sleep = s => new Promise(resolve => setTimeout(resolve, s * 1000));

    try {
        let params;

        //Function to list tasks belonging to test
        let listTasks = async (params) => {
            params = {
                cluster: process.env.TASK_CLUSTER,
                desiredStatus: 'RUNNING',
                startedBy: testId
            };

            let runningTasks = [];
            let data;
            do {
                data =  await ecs.listTasks(params).promise();
                runningTasks = runningTasks.concat(data.taskArns);
                params.nextToken = data.nextToken;
            } while(data.nextToken);

            return runningTasks;
        };

        //1. get a list of all running tasks
        let runningTasks = await listTasks(params);
        
        //2. Stop tasks in batches of 100
        while (runningTasks.length > 0) {
            let promises = [];
            const runningTasksSubset = runningTasks.splice(0,100);
            for (const task of runningTasksSubset) {
                params = {
                  cluster: process.env.TASK_CLUSTER,
                  task: task
                };
                //create stopTask promise and add to array
                promises.push(ecs.stopTask(params).promise().catch((err) => console.error(err)));
            }
            //await subset of 100 or less stopTask promises
            await Promise.all(promises);
            sleep(5);
            
            
            //Double check if any tasks remain, add back if necessary
            if (runningTasks.length === 0)  runningTasks = await listTasks(params);
        }
        
        //3. Update table
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
