// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { CloudWatch } = require("@aws-sdk/client-cloudwatch");
const { CloudWatchLogs } = require("@aws-sdk/client-cloudwatch-logs");
const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { ECS } = require("@aws-sdk/client-ecs");
const { S3 } = require("@aws-sdk/client-s3");

const utils = require("solution-utils");
let options = utils.getOptions({ region: process.env.AWS_REGION });
const dynamo = DynamoDBDocument.from(new DynamoDB(options));
const s3 = new S3();

const checkRunningTasks = async (ecs, runTaskCount, taskCount, taskCluster, testId) => {
  let desiredWorkers = taskCount - 1;
  let listTaskParams = {
    cluster: taskCluster,
    desiredStatus: "RUNNING",
    startedBy: testId,
  };
  let runningTasks = [];
  let data;
  //get running tasks belonging to test
  do {
    data = await ecs.listTasks(listTaskParams);
    runningTasks = runningTasks.concat(data.taskArns);
    listTaskParams.nextToken = data.nextToken;
  } while (data.nextToken);
  let actualWorkers = runningTasks.length;
  let neededWorkers = desiredWorkers - actualWorkers;
  //add back workers if necessary
  runTaskCount = runTaskCount + neededWorkers;
  return runTaskCount;
};

const checkTestStatus = async (testId) => {
  let data;
  const ddbParams = {
    TableName: process.env.SCENARIOS_TABLE,
    Key: {
      testId: testId,
    },
    AttributesToGet: ["status"],
  };
  data = await dynamo.get(ddbParams);
  const { status } = data.Item;
  return status;
};

const multipleTasks = async (props) => {
  let timeRemaining;
  const { taskCount, taskCluster, testId, params, taskIds } = props;
  let { runTaskCount, context, ecs, isRunning } = props;
  do {
    //run tasks
    runTaskCount = await launchWorkers(runTaskCount, params, ecs, taskIds, taskCluster);

    //get time left
    timeRemaining = context.getRemainingTimeInMillis();

    //check if test has been cancelled
    if (runTaskCount <= 1 || timeRemaining <= 60000) {
      const status = await checkTestStatus(testId);
      if (status !== "running") isRunning = false;
    }

    //if still running, double check if all tasks running, if not, add what is needed
    if (isRunning && runTaskCount <= 1) {
      runTaskCount = await checkRunningTasks(ecs, runTaskCount, taskCount, taskCluster, testId);
    }
  } while (runTaskCount > 1 && parseInt(timeRemaining, 10) > 60000); //end if out of time or no tasks left
  return isRunning;
};

const singleTask = async (params, taskIds, taskCluster, ecs, runTaskCount, testId, region) => {
  if (taskIds) {
    //Get IP Addresses of worker nodes
    let ipAddresses = [];
    let ipNetworkPortion;
    while (taskIds.length > 0) {
      //get task info in chunks of 100 or less
      let taskIdSubset = taskIds.splice(0, 100);
      let describeTasksParams = { cluster: taskCluster, tasks: taskIdSubset };
      let runningNodeInfo = await ecs.describeTasks(describeTasksParams);

      //get IPV4 Address info
      let ipAddress;
      runningNodeInfo.tasks.forEach((task) => {
        //get second half of ip address
        ipAddress = task.containers[0].networkInterfaces[0].privateIpv4Address;
        ipAddresses.push(ipAddress.split(".").slice(2).join("."));
      });
      //save first half of ip address if not already saved (same for all ipv4 addressess)
      ipNetworkPortion = ipNetworkPortion || ipAddress.split(".", 2).join(".");
    }

    const s3Params = {
      Bucket: process.env.SCENARIOS_BUCKET,
      Key: `Container_IPs/${testId}_IPHOSTS_${region}.txt`, // File path in the bucket, e.g.
      Body: ipAddresses.toString(),
      ContentType: "text/plain",
    };

    //Storing the IPHOSTS in the s3 bucket.
    await s3.putObject(s3Params);

    //copy needed for testing in jest, use shallow copy for less resource utilization
    let leaderParams = Object.assign({}, params);
    leaderParams.count = runTaskCount;
    //override environment variables for leader node
    leaderParams.overrides.containerOverrides[0].environment.push({
      name: "IPNETWORK",
      value: ipNetworkPortion.toString(),
    });
    leaderParams.overrides.containerOverrides[0].environment.forEach((item) => {
      if (item.name === "SCRIPT") item.value = "ecscontroller.py";
    });

    //run leader node task
    console.log("STARTING LEADER NODE AND RUNNING TESTS");
    const leadTaskResponse = await ecs.runTask(leaderParams);
    //if leader node fails to launch, log error and end test
    if (leadTaskResponse.failures.length > 0) {
      throw ("The lead task failed to launch:\n", leadTaskResponse.failures);
    }
  } else {
    //if single task test
    params.count = runTaskCount;
    console.log("Starting Task");
    params.overrides.containerOverrides[0].environment.pop();
    const singleTaskRunResponse = await ecs.runTask(params);
    if (singleTaskRunResponse.failures.length > 0) {
      throw ("The task failed to launch:\n", singleTaskRunResponse.failures);
    }
  }
};

//loop through list of tasks and push to taskIds array
const collectTaskIds = (tasks, taskIds, taskCluster) => {
  tasks.forEach((task) => {
    taskIds.push(task.taskArn.split(taskCluster + "/").pop());
  });
};

//function to run workers, and keep track of amount run
const launchWorkers = async (runTaskWorkersCount, launchParams, ecs, taskIds, taskCluster) => {
  //adjust parameters if less than 10
  const count = runTaskWorkersCount > 10 ? 10 : runTaskWorkersCount - 1;
  let taskParams = count >= 10 ? launchParams : Object.assign({}, launchParams);
  taskParams.count = count;
  //run tasks
  console.log(`STARTING ${count} WORKER TASKS`);
  let runTaskResponse = await ecs.runTask(taskParams);
  //get amount successfully launched
  let actualLaunched = runTaskResponse.tasks.length;
  runTaskWorkersCount = runTaskWorkersCount - actualLaunched;
  runTaskResponse.failures.length > 0 && console.log("Failed tasks:\n", runTaskResponse.failures);
  //record task Ids
  collectTaskIds(runTaskResponse.tasks, taskIds, taskCluster);
  return runTaskWorkersCount;
};

const createDashboard = async (testId, ecsCloudWatchLogGroup, taskCluster, region) => {
  //Create metric filters and dashboard
  const metrics = ["numVu", "numSucc", "numFail", "avgRt"];
  const metricNames = ["Virtual Users Activities", "Success", "Failures", "Average Response Time"];
  const cloudwatch = new CloudWatch(options);
  const cloudwatchLogs = new CloudWatchLogs(options);
  let widgets = [];
  const widgetPlacement = [
    [8, 0],
    [0, 8],
    [8, 8],
    [0, 0],
  ];
  //Create metric filter and widget for each metric
  for (const [index, metric] of metrics.entries()) {
    let metricNameParam = `${testId}-${metric}`;
    let stat = metric === "avgRt" ? "avg" : "sum";
    let [x, y] = widgetPlacement[index];
    //Create metric filter
    let metricFilterParams = {
      filterName: `${taskCluster}-Ecs${metric}-${testId}`,
      filterPattern: `[testId="${testId}", live, time, logType=INFO*, logTitle=Current*, numVu, vu, numSucc, succ, numFail, fail, avgRt, x]`,
      logGroupName: `${ecsCloudWatchLogGroup}`,
      metricTransformations: [
        {
          metricName: metricNameParam,
          metricNamespace: "distributed-load-testing",
          metricValue: `$${metric}`,
        },
      ],
    };
    await cloudwatchLogs.putMetricFilter(metricFilterParams);
    //create widget
    let query = `SOURCE '${ecsCloudWatchLogGroup}'| limit 10000 | \
                fields @logStream | \
                filter @message like /${testId}.*INFO: Current:/ | \
                parse @message /^.*\\s(?<@numVu>\\d+)\\svu\\s(?<@numSucc>\\d+)\\ssucc\\s(?<@numFail>\\d+)\\sfail\\s(?<@avgRt>\\d*.\\d*).*$/| \
                stat ${stat}(@${metric}) by bin(1s)`;
    let title = `${metricNames[index]}`;
    let widget = {
      type: "log",
      x: x,
      y: y,
      width: 8,
      height: 8,
      properties: {
        query: query,
        region: region,
        stacked: "false",
        title: title,
        view: "timeSeries",
      },
    };
    widgets.push(widget);
  }
  //create dashboard
  const dashboardBody = { widgets: widgets };
  await cloudwatch.putDashboard({
    DashboardName: `EcsLoadTesting-${testId}-${region}`,
    DashboardBody: JSON.stringify(dashboardBody),
  });
};

exports.handler = async (event, context) => {
  console.log(JSON.stringify(event, null, 2));

  const { testId, testType, fileType, showLive, prefix } = event;
  const {
    taskDefinition,
    taskCluster,
    region,
    taskCount,
    ecsCloudWatchLogGroup,
    subnetA,
    subnetB,
    taskImage,
    taskSecurityGroup,
  } = event.testTaskConfig;
  //1 call every 1.5 sec , 2 min to enter running, 1 min launch for leader, 2 min for leader to enter running + 5 min buffer
  const timeout = Math.floor(Math.ceil(taskCount / 10) * 1.5 + 600);
  /**
   * The max number of containers (taskCount) per task execution is 10 so if the taskCount is
   * more than 10 the task definition will need to be run multiple times.
   * @runTaskCount is the number of sets of 10 in the taskCount
   */
  let runTaskCount = event.taskIds ? 1 : taskCount;
  let isRunning = true;

  options = utils.getOptions(options);
  options.region = region;
  const ecs = new ECS(options);

  // Run tasks in batches of 10
  const params = {
    taskDefinition: taskDefinition,
    cluster: taskCluster,
    count: 0,
    group: testId,
    launchType: "FARGATE",
    networkConfiguration: {
      awsvpcConfiguration: {
        assignPublicIp: "ENABLED",
        securityGroups: [taskSecurityGroup],
        subnets: [subnetA, subnetB],
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: taskImage,
          environment: [
            { name: "MAIN_STACK_REGION", value: process.env.MAIN_STACK_REGION },
            { name: "S3_BUCKET", value: process.env.SCENARIOS_BUCKET },
            { name: "TEST_ID", value: testId },
            { name: "TEST_TYPE", value: testType },
            { name: "FILE_TYPE", value: fileType },
            { name: "LIVE_DATA_ENABLED", value: `live=${showLive}` },
            { name: "TIMEOUT", value: timeout.toString() },
            { name: "PREFIX", value: prefix },
            { name: "SCRIPT", value: "ecslistener.py" },
          ],
        },
      ],
    },
    propagateTags: "TASK_DEFINITION",
    startedBy: testId,
    tags: [
      { key: "TestId", value: testId },
      { key: "SolutionId", value: process.env.SOLUTION_ID },
    ],
  };

  try {
    //if not yet created by previous call, create widgets and dashboard
    if (!event.taskIds) {
      await createDashboard(testId, ecsCloudWatchLogGroup, taskCluster, region);
    }

    params.count = 10;

    //if there is a list of taskIds, workers have been launched and only the leader is left.
    let taskIds = event.taskIds || [];
    //if only running a single task
    if (runTaskCount === 1) {
      //if leader task
      await singleTask(params, event.taskIds, taskCluster, ecs, runTaskCount, testId, region);
    } else {
      //if multiple tasks
      const multipleTasksProps = {
        runTaskCount: runTaskCount,
        context: context,
        taskCount: taskCount,
        taskCluster: taskCluster,
        testId: testId,
        params: params,
        taskIds: taskIds,
        ecs: ecs,
        isRunning: isRunning,
      };
      isRunning = await multipleTasks(multipleTasksProps);
    }
    console.log("success");
    event.prefix = prefix;
    event.isRunning = isRunning;
    taskIds.length > 0 && (event.taskIds = taskIds);
    return event;
  } catch (err) {
    console.error(err);

    // Update DynamoDB with Status FAILED and Error Message
    await dynamo.update({
      TableName: process.env.SCENARIOS_TABLE,
      Key: { testId },
      UpdateExpression: "set #s = :s, #e = :e",
      ExpressionAttributeNames: {
        "#s": "status",
        "#e": "errorReason",
      },
      ExpressionAttributeValues: {
        ":s": "failed",
        ":e": "Failed to run Fargate tasks.",
      },
    });

    throw err;
  }
};
