// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');
const { SOLUTION_ID, VERSION } = process.env; 
let options = {};
if (SOLUTION_ID && VERSION && SOLUTION_ID.trim() && VERSION.trim()) {
  options.customUserAgent = `AwsSolution/${SOLUTION_ID}/${VERSION}`;
}
const ecs = new AWS.ECS(options);
const dynamoDb = new AWS.DynamoDB.DocumentClient(options);
const lambda = new AWS.Lambda(options);

exports.handler = async (event) => {
  console.log(JSON.stringify(event, null, 2));
  const { scenario, taskRunner } = event;
  const { testId } = scenario;

  try {
    let nextToken = null;
    let isRunning = false;
    let runningTasks = [];

    // Runs while loop while there are tasks in the ECS cluster. Then, call describeTasks to get task's group, which is test ID.
    do {
      const response = await listTasks(nextToken);
      nextToken = response.NextToken;

      if (response.Tasks.length > 0) {
        const describedTasks = await ecs.describeTasks({
          cluster: process.env.TASK_CLUSTER,
          tasks: response.Tasks
        }).promise();

        // If there are any current test ECS tasks and no prefix, it's currently running.
        if (describedTasks.tasks.some(task => task.group === testId) && !event.prefix) {
          isRunning = true;
          break;
        }

        //tasks within group that are launched
        runningTasks = runningTasks.concat(describedTasks.tasks.filter(task => task.group === testId));
      }
    } while (nextToken);
    //get number of tasks in running state
    let numTasksRunning = runningTasks.reduce(((accumulator, task) => task.lastStatus === "RUNNING" ? ++accumulator : accumulator), 0);
    //add 1 to match scenario total for step functions
    numTasksRunning++;
    const result = { scenario, isRunning, numTasksRunning, taskRunner };

    /**
     * When prefix is provided, it means tests are running.
     * To prevent infinitely running tests, after 10 times (10 minutes) retries, stop the ECS cluster tasks after any tasks complete.
     * Ideally, every task would finish in about 2-4 minutes after any task completes.
     */
    if (event.prefix) {
      result.prefix = event.prefix;
      const runningTaskCount = runningTasks.length;
      const { taskCount } = scenario;

      if (runningTaskCount > 0) {
        result.isRunning = true;
        //check if running task count is less than worker count
        if (runningTaskCount < taskCount - 1) {
          result.timeoutCount = event.timeoutCount ? event.timeoutCount - 1 : 10;

          if (result.timeoutCount === 0) {
            // Stop the ECS tasks
            const params = {
              FunctionName: process.env.TASK_CANCELER_ARN, 
              InvocationType: "Event", 
              Payload: JSON.stringify({testId: testId})
            };
            await lambda.invoke(params).promise();
            result.isRunning = false;
          }
        }
      }
    }

    return result;
  } catch (error) {
    console.error(error);

    // Update DynamoDB with Status FAILED and Error Message
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
        ':e': 'Failed to check Fargate tasks.'
      }
    }).promise();

    throw error;
  }
}

/**
 * Returns the list of ECS cluster's task ARNs.
 * The maximum number of tasks at once is 100.
 * @param {string|undefined} nextToken The next token to get list tasks
 * @return {Promise<{ Tasks: Array<String>|undefined, NextToken: String|undefined }>} The list of ECS cluster's task ARNs
 */
async function listTasks(nextToken) {
  let param = { cluster: process.env.TASK_CLUSTER };
  if (nextToken) {
    param.nextToken = nextToken;
  }

  const response = await ecs.listTasks(param).promise();
  return {
    Tasks: response.taskArns,
    NextToken: response.nextToken
  };
}