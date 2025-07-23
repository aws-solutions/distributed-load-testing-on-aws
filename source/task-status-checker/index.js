// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { ECS } = require("@aws-sdk/client-ecs");
const { Lambda } = require("@aws-sdk/client-lambda");

const utils = require("solution-utils");

let options = utils.getOptions({});
const dynamoDb = DynamoDBDocument.from(new DynamoDB(options));
const lambda = new Lambda(options);

const checkTestStatus = async (testId, isRunning) => {
  let data;
  const ddbParams = {
    TableName: process.env.SCENARIOS_TABLE,
    Key: {
      testId: testId,
    },
    AttributesToGet: ["status"],
  };
  data = await dynamoDb.get(ddbParams);
  const { status } = data.Item;
  return status === "running" && isRunning;
};

const stopECSTasks = async (timeoutCount, testTaskConfig, result, runningTaskCount, testId) => {
  result.isRunning = true;
  const { taskCount } = testTaskConfig;
  //check if running task count is less than worker count
  if (runningTaskCount < taskCount - 1) {
    result.timeoutCount = timeoutCount ? timeoutCount - 1 : 10;

    if (result.timeoutCount === 0) {
      // Stop the ECS tasks
      const params = {
        FunctionName: process.env.TASK_CANCELER_ARN,
        InvocationType: "Event",
        Payload: JSON.stringify({
          testId: testId,
          testTaskConfig: testTaskConfig,
        }),
      };
      await lambda.invoke(params);
      result.isRunning = false;
    }
  }
};

exports.handler = async (event) => {
  console.log(JSON.stringify(event, null, 2));

  const { testId, taskRunner } = event;
  const { region, taskCluster } = event.testTaskConfig;
  options = utils.getOptions(options);
  options.region = region;
  const ecs = new ECS(options);

  try {
    let nextToken = null;
    let isRunning = false;
    let runningTasks = [];

    // Runs while loop while there are tasks in the ECS cluster. Then, call describeTasks to get task's group, which is test ID.
    do {
      const response = await listTasks(nextToken, region, taskCluster);
      nextToken = response.NextToken;

      if (response.Tasks.length > 0) {
        const describedTasks = await ecs.describeTasks({
          cluster: taskCluster,
          tasks: response.Tasks,
        });

        // If there are any current test ECS tasks and no prefix, it's currently running.
        if (describedTasks.tasks.some((task) => task.group === testId) && !event.prefix) {
          isRunning = true;
          break;
        }

        //tasks within group that are launched
        runningTasks = runningTasks.concat(describedTasks.tasks.filter((task) => task.group === testId));
      }
    } while (nextToken);
    //get number of tasks in running state
    let numTasksRunning = 0;
    runningTasks.forEach((task) => task.lastStatus === "RUNNING" && ++numTasksRunning);
    //add 1 to match scenario total for step functions
    numTasksRunning++;
    const result = event;

    result.isRunning = isRunning;
    result.numTasksRunning = numTasksRunning;
    result.taskRunner = taskRunner;
    result.numTasksTotal = runningTasks.length + 1;
    /**
     * When prefix is provided, it means tests are running.
     * To prevent infinitely running tests, after 10 times (10 minutes) retries, stop the ECS cluster tasks after any tasks complete.
     * Ideally, every task would finish in about 2-4 minutes after any task completes.
     */
    if (event.prefix) {
      result.prefix = event.prefix;
      const runningTaskCount = runningTasks.length;

      if (runningTaskCount > 0) {
        await stopECSTasks(event.timeoutCount, event.testTaskConfig, result, runningTaskCount, testId);
      }
    }
    result.isRunning = await checkTestStatus(testId, result.isRunning);
    return result;
  } catch (error) {
    console.error(error);

    // Update DynamoDB with Status FAILED and Error Message
    await dynamoDb.update({
      TableName: process.env.SCENARIOS_TABLE,
      Key: { testId },
      UpdateExpression: "set #s = :s, #e = :e",
      ExpressionAttributeNames: {
        "#s": "status",
        "#e": "errorReason",
      },
      ExpressionAttributeValues: {
        ":s": "failed",
        ":e": "Failed to check Fargate tasks.",
      },
    });

    throw error;
  }
};

/**
 * Returns the list of ECS cluster's task ARNs.
 * The maximum number of tasks at once is 100.
 * @param {string|undefined} nextToken The next token to get list tasks
 * @return {Promise<{ Tasks: Array<String>|undefined, NextToken: String|undefined }>} The list of ECS cluster's task ARNs
 */
async function listTasks(nextToken, region, taskCluster) {
  options.region = region;
  const ecs = new ECS(options);
  let param = { cluster: taskCluster };
  if (nextToken) {
    param.nextToken = nextToken;
  }
  const response = await ecs.listTasks(param);
  return {
    Tasks: response.taskArns,
    NextToken: response.nextToken,
  };
}
