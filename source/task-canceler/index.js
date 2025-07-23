// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { ECS } = require("@aws-sdk/client-ecs");

const utils = require("solution-utils");
let options = utils.getOptions({ region: process.env.AWS_REGION });
const dynamoDB = DynamoDBDocument.from(new DynamoDB(options));

//Function to list tasks belonging to test
async function listTasks(ecs, params) {
  let currentRunningTasks = [];
  let data;
  do {
    data = await ecs.listTasks(params);
    currentRunningTasks = currentRunningTasks.concat(data.taskArns);
    params.nextToken = data.nextToken;
  } while (data.nextToken);
  return currentRunningTasks;
}

exports.handler = async (event) => {
  const testId = event.testId;
  const region = event.testTaskConfig.region;
  const taskCluster = event.testTaskConfig.taskCluster;
  console.log(`Cancelling test: ${testId}`);
  const sleep = (s) => new Promise((resolve) => setTimeout(resolve, s * 1000));
  options.region = region;
  const ecs = new ECS(options);
  try {
    const listTaskParams = {
      cluster: taskCluster,
      desiredStatus: "RUNNING",
      startedBy: testId,
    };

    //1. get a list of all running tasks
    let runningTasks = await listTasks(ecs, listTaskParams);

    //2. Stop tasks in batches of 100
    while (runningTasks.length > 0) {
      let promises = [];
      const runningTasksSubset = runningTasks.splice(0, 100);
      for (const task of runningTasksSubset) {
        const stopTaskParams = {
          cluster: taskCluster,
          task: task,
        };
        //create stopTask promise and add to array
        promises.push(ecs.stopTask(stopTaskParams).catch((err) => console.error(err)));
      }
      //await subset of 100 or less stopTask promises
      await Promise.all(promises);
      sleep(5);

      //Double check if any tasks remain, add back if necessary
      if (runningTasks.length === 0) runningTasks = await listTasks(ecs, listTaskParams);
    }

    //3. Update table
    if (!event.error) {
      const ddbParams = {
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: testId,
        },
        UpdateExpression: "set #s = :s",
        ExpressionAttributeNames: {
          "#s": "status",
        },
        ExpressionAttributeValues: {
          ":s": "cancelled",
        },
      };
      await dynamoDB.update(ddbParams);

      return "test cancelled";
    } else {
      return "test stopped due to error";
    }
  } catch (err) {
    console.log(err);
    throw err;
  }
};
