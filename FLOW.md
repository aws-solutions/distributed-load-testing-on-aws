Flow of data to test:

1. source/console/src/Create.js

testId = this.state.testId || generateUniqueId(10);
    let payload = {
        testId,
        testName: values.testName,
        testDescription: values.testDescription,
        taskCount: parseInt(values.taskCount),
        testScenario: {
            execution: [{
                concurrency: parseInt(values.concurrency),
                "ramp-up": String(parseInt(values.rampUp)).concat(values.rampUpUnits),
                "hold-for": String(parseInt(values.holdFor)).concat(values.holdForUnits),
                scenario: values.testName
            }],
            scenarios: {
                [values.testName]: {}
            }
        },
        testType: values.testType,
        fileType: values.fileType
    };

    if (!!parseInt(values.onSchedule)) {
        payload.scheduleDate = values.scheduleDate;
        payload.scheduleTime = values.scheduleTime;
        payload.scheduleStep = "start";
        if (this.state.activeTab === '2') {
            payload.scheduleStep = "create";
            payload.recurrence = values.recurrence;
        }
    }

    if (values.testType === 'simple') {
        payload.testScenario.scenarios[values.testName] = {
            requests: [
                {
                    url: values.endpoint,
                    method: values.method,
                    body: this.parseJson(values.body.trim()),
                    headers: this.parseJson(values.headers.trim())
                }
            ]
        };
    } else {
        payload.testScenario.scenarios[values.testName] = {
            script: `${testId}.jmx`
        };
    }
    const response = await API.post('dlts', '/scenarios', { body: payload });

2. source/api-services/index.js
    data = await scenarios.createTest(config);
    response.body = JSON.stringify(data);

3. source/api-services/scenarios/index.js
    // 1. Write test scenario to S3
    Copy payload.testScenario to s3://{SCENARIOS_BUCKET}/test-scenarios/${testId}.json

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
        ...
    }

4. source/infrastructure/lib/step-functions.ts
    Data passed around step functions:
    {
        scenario: [Input from entry. Not changed in step-function]
            {
                testId: testId,
                taskCount: taskCount,
                testType: testType,
                fileType: fileType
            }
        taskRunner: [Only set after taskRunner lambda first called]
            {
                
            }
        prefix: [Only set after taskRunner lambda first called] - ID(timestamp) of this particular run of this testid
        isRunning: bool [true if ecs is still running this testid, set by checkRunningTests lambda]
        numRunningTasks: int [set by checkRunningTests lambda]
    }

    Step function entry:
    - checkRunningTests
        LAMBDA: task-status-checker
            ecs.listTasks(TASK_CLUSTER)  (TASK_CLUSTER is single name unique to this stack)
            for each task
                td = describeTask
                if (td.group === scenario.testId) {
                    if (input.prefix not set) {
                        return original input {scenario, taskRunner } + {numRunningTasks: 0, isRunning: true}
                    }
                    if td.state == running, numRunningTasks++
                }
            }
            numRunningTasks++
            return original input {scenario, taskRunner, prefix?} + {numRunningTasks: (number actually running + 1), isRunning}
    - test isRunning:
        true -> FAIL(testIsStillRunning)
        false -> runWorkers
    - runWorkers
        LAMBDA: task-runner (launches up to 10 ecs constainers)
            assign prefix if not already: prefix = event.prefix || new Date().toISOString().replace('Z', '').split('').reverse().join('');
            determine tasks to run: runTaskCount = event.taskRunner ? event.taskRunner.runTaskCount : taskCount;
            launch tasks
            tasks upload results to s3
    - allWorkersLaunched
        taskRunner.runTaskCount > 1 -> runWorkers
        taskRunner.runTaskCount == 1 -> waitWorker
        taskRunner.runTaskCount == 0 -> waitTask
    - waitWorker
        WAIT 1 minute -> checkWorkerStatus
    - checkWorkerStatus
        LAMBDA: task-status-checker -> allWorkersRunning
    - allWorkersRunning
        numTasksRunning == scenario.taskCount -> runLeaderTask
        isRunning == false -> parseResult
        else -> waitWorker
    - runLeaderTask
        LAMBDA: task-runner
            launch ecs container with SCRIPT=ecscontroller.py
    - waitTask
        WAIT 1 minute -> checkTaskStatus
    - checkTaskStatus
        LAMBDA: task-status-checker -> allTasksDone
    - allTasksDone
        isRunning == false -> parseResults
        else -> waitTask

    