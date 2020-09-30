// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');
const ecs = new AWS.ECS({
    region: process.env.AWS_REGION
});

exports.handler = async (event) => {
  console.log(JSON.stringify(event, null, 2));

  try {
    const { scenario } = event;
    let nextToken = null;
    let isRunning = false;

    // Runs while loop while there are tasks in the ECS cluster. Then, call describeTasks to get task's group, which is test ID.
    do {
      const response = await listTasks(nextToken);
      nextToken = response.NextToken;

      if (response.Tasks.length > 0) {
        const describedTasks = await ecs.describeTasks({
          cluster: process.env.TASK_CLUSTER,
          tasks: response.Tasks
        }).promise();

        // If there are any current test ECS tasks, it's currently running.
        if (describedTasks.tasks.some(task => task.group === scenario.testId)) {
          isRunning = true;
          break;
        }
      }
    } while (nextToken);

    const result = { scenario, isRunning };
    if (event.prefix) {
      result.prefix = event.prefix;
    }

    return result;
  } catch (error) {
    console.error(error);
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