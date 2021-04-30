// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');
const { SOLUTION_ID, VERSION } = process.env; 
let options = {};
if (SOLUTION_ID && VERSION && SOLUTION_ID.trim() && VERSION.trim()) {
  options.customUserAgent = `AwsSolution/${SOLUTION_ID}/${VERSION}`;
}
options.region = process.env.AWS_REGION
const ecs = new AWS.ECS(options);
const dynamo = new AWS.DynamoDB.DocumentClient(options);
const cloudwatch = new AWS.CloudWatch(options);
const cloudwatchLogs = new AWS.CloudWatchLogs(options);

exports.handler = async (event, context) => {
    console.log(JSON.stringify(event, null, 2));

    const { scenario } = event;
    const { testId, taskCount, testType, fileType } = scenario;
    const API_INTERVAL = parseFloat(process.env.API_INTERVAL) || 10;
    let runTaskCount = event.taskRunner ? event.taskRunner.runTaskCount : taskCount;
    let timeRemaining;
    let isRunning = true;
    
    /**
    * Prefix is reversed date. e.g. 878.14:32:40T30-90-0202
    * Each tasks are going to create new result object in S3.
    * Prefix is going to be used to distinguish the current result S3 objects.
    */
    const prefix = event.prefix || new Date().toISOString().replace('Z', '').split('').reverse().join('');
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
                    { name: 'S3_BUCKET', value: process.env.SCENARIOS_BUCKET },
                    { name: 'TEST_ID', value: testId },
                    { name: 'TEST_TYPE', value: testType },
                    { name: 'FILE_TYPE', value: fileType },
                    { name: 'PREFIX', value: prefix },
                    { name: 'SCRIPT', value: 'ecslistener.py'}
                ]
            }]
        },
        startedBy: testId,
        tags: [
            { key: "TestId", value: testId },
            { key: "SolutionId", value: process.env.SOLUTION_ID }
        ]
    };
    
    try {
      
        //if not yet created by previous call, create widgets and dashboard
        if (!event.taskRunner) {
            //Create metric filters and dashboard
            const metrics = ["numVu", "numSucc", "numFail", "avgRt"];
            const metricNames = ["Virtual Users", "Success", "Failures", "Average Response Time"];
            let widgets = [];
            const widgetPlacement = [[8,0],[0,8],[8,8],[0,0]];
            //Create metric filter and widget for each metric
            for(const [index, metric] of metrics.entries()) {
                let metricNameParam = `${testId}-${metric}`;
                let stat = metric === 'avgRt' ? 'avg' : 'sum';
                let [x, y] = widgetPlacement[index];
                //Create metric filter
                let metricFilterParams = {
                    filterName: `${process.env.TASK_CLUSTER}-Ecs${metric}-${testId}`,
                    filterPattern: `[testId="${testId}", time, logType=INFO*, logTitle=Current*, numVu, vu, numSucc, succ, numFail, fail, avgRt, x]`,
                    logGroupName: `${process.env.ECS_LOG_GROUP}`,
                    metricTransformations: [
                        {
                            metricName: metricNameParam,
                            metricNamespace: "distributed-load-testing",
                            metricValue: `$${metric}`
                        }
                    ]
                };    
                await cloudwatchLogs.putMetricFilter(metricFilterParams).promise();
                
                //create widget 
                let query = `SOURCE '${process.env.ECS_LOG_GROUP}' | \
                    fields @logStream | \
                    filter @message like /${testId}.*INFO: Current:/ | \
                    parse @message /^.*\\s(?<@numVu>\\d+)\\svu\\s(?<@numSucc>\\d+)\\ssucc\\s(?<@numFail>\\d+)\\sfail\\s(?<@avgRt>\\d*.\\d*).*$/| \
                    stat ${stat}(@${metric}) by bin(1s)`;
                let title = `${metricNames[index]}`;
                let widget = {
                    "type": "log",
                    "x": x,
                    "y": y,
                    "width": 8,
                    "height": 8,
                    "properties": {
                        "query": query,
                        "region": process.env.AWS_REGION,
                        "stacked": 'false',
                        "title": title,
                        "view": "timeSeries",
                    }
                };
                widgets.push(widget);
            }
            //create dashboard
            const dashboardBody = {"widgets": widgets};
            await cloudwatch.putDashboard({DashboardName: `EcsLoadTesting-${testId}`, DashboardBody: JSON.stringify(dashboardBody)}).promise();
        }
        /**
         * The max number of containers (taskCount) per task execution is 10 so if the taskCount is
         * more than 10 the task definition will need to be run multiple times.
         * @runTaskCount is the number of sets of 10 in the taskCount
         */
        const sleep = s => new Promise(resolve => setTimeout(resolve, s * 1000));
        params.count = 10;
        
        //declare variables runTaskResponse for runTask response and taskIds to save task Ids
        let runTaskResponse;
        let taskIds = event.taskRunner ? event.taskRunner.taskIds : [];

        //loop through list of tasks and push to taskIds array
        let collectTaskIds = (tasks) => {
            tasks.forEach(task => {
                taskIds.push(task.taskArn.split(process.env.TASK_CLUSTER + "/" ).pop());
            });
        };
        //if only running a single task
        if (runTaskCount === 1) {
            //if leader task
            if(event.taskRunner) {
                //Get IP Addresses of worker nodes
                let ipAddresses = [];
                let ipNetworkPortion;
                while(taskIds.length > 0) {
                    //get task info in chunks of 100 or less
                    let taskIdSubset = taskIds.splice(0, 100);
                    let describeTasksParams = {"cluster": process.env.TASK_CLUSTER, tasks: taskIdSubset};
                    let runningNodeInfo = await ecs.describeTasks(describeTasksParams).promise();
                    
                    //get IPV4 Address info
                    let ipAddress;
                    runningNodeInfo.tasks.forEach(task => {
                    //get second half of ip address
                    ipAddress = task.containers[0].networkInterfaces[0].privateIpv4Address;
                    ipAddresses.push(ipAddress.split(".").slice(2).join("."));            
                    });
                    //save first half of ip address if not already saved (same for all ipv4 addressess)
                    ipNetworkPortion = ipNetworkPortion || ipAddress.split(".", 2).join(".");
                }
            
                //copy needed for testing in jest, use shallow copy for less resource utilization
                let leaderParams = Object.assign({}, params);
                leaderParams.count = runTaskCount;
                //override environment variables for leader node
                leaderParams.overrides.containerOverrides[0].environment.push({name: "IPNETWORK", value: ipNetworkPortion.toString()});
                leaderParams.overrides.containerOverrides[0].environment.push({name: "IPHOSTS", value: ipAddresses.toString()});
                leaderParams.overrides.containerOverrides[0].environment.forEach(item => {
                    if(item.name === 'SCRIPT') item.value="ecscontroller.py";
                });
                
                //run leader node task
                console.log('STARTING LEADER NODE AND RUNNING TESTS');
                await ecs.runTask(leaderParams).promise();   
                runTaskCount -= 1;
                
            } else { //if single task test
                params.count = runTaskCount;
                console.log('Starting Task');
                params.overrides.containerOverrides[0].environment.pop();
                await ecs.runTask(params).promise();
                runTaskCount -= 1;
            }
        } else {
            //function to run workers, and keep track of amount run
            let launchWorkers = async (runTaskCount, params) => {
                //adjust parameters if less than 10
                const count = runTaskCount > 10 ? 10 : runTaskCount - 1;
                let taskParams = count >= 10 ? params : Object.assign({}, params);
                taskParams.count = count;
                //run tasks
                console.log(`STARTING ${count} WORKER TASKS`);
                runTaskResponse = await ecs.runTask(taskParams).promise();
                //get amount succesfully launched
                let actualLaunched = runTaskResponse.tasks.length;
                runTaskCount = runTaskCount - actualLaunched;
                //record task Ids
                collectTaskIds(runTaskResponse.tasks);
                //sleep 
                console.log(`sleep ${API_INTERVAL} seconds to avoid ThrottlingException`);
                await sleep(API_INTERVAL);
                return runTaskCount;
            };
            do {
                //run tasks
                runTaskCount = await launchWorkers(runTaskCount, params);
                
                //get time left 
                timeRemaining = context.getRemainingTimeInMillis();
                
                //check if test has been cancelled
                if (runTaskCount <= 1 || timeRemaining <= 60000) {
                    let data;
                    const ddbParams = {
                        TableName: process.env.SCENARIOS_TABLE,
                        Key: {
                           testId: testId
                       },
                       AttributesToGet: [
                           'status'
                       ]
                    };
                    data = await dynamo.get(ddbParams).promise();
                    const { status } = data.Item;
                    if (status !== 'running') isRunning = false;
                }
                    
                //if still running, double check if all tasks running, if not, add what is needed
                if (isRunning && runTaskCount <= 1) {
                    let desiredWorkers = taskCount - 1;
                    let params = {
                        cluster: process.env.TASK_CLUSTER,
                        desiredStatus: 'RUNNING',
                        startedBy: testId
                    };
                    let runningTasks = [];
                    let data;
                    //get running tasks belonging to test
                    do {
                        data =  await ecs.listTasks(params).promise();
                        runningTasks = runningTasks.concat(data.taskArns);
                        params.nextToken = data.nextToken;
                    } while(data.nextToken);
                    let actualWorkers = runningTasks.length;
                    let neededWorkers = desiredWorkers - actualWorkers;
                    //add back workers if necessary
                    runTaskCount = runTaskCount + neededWorkers;
                } 
            } while (runTaskCount > 1 && parseInt(timeRemaining, 10) > 60000 ); //end if out of time or no tasks left
        }
        console.log('success');
        return { scenario, prefix, isRunning, taskRunner: { runTaskCount, taskIds } };
    } catch (err) {
        console.error(err);

        // Update DynamoDB with Status FAILED and Error Message
        await dynamo.update({
            TableName: process.env.SCENARIOS_TABLE,
            Key: { testId },
            UpdateExpression: 'set #s = :s, #e = :e',
            ExpressionAttributeNames: {
                '#s': 'status',
                '#e': 'errorReason'
            },
            ExpressionAttributeValues: {
                ':s': 'failed',
                ':e': 'Failed to run Fargate tasks.'
            }
        }).promise();

        throw err;
    }
};
