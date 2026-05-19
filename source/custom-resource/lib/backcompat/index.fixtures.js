// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const EmptyDynamoDbScan = {
    Items: [],
    LastEvaluatedKey: null,
};

const EmptyCloudWatchRules = {
    Rules: [],
};

const generateRecurrenceSchedule = ({
    recurrence: "daily",
    scheduleDate: "2020-01-01",
    scheduleTime: "15:15",
    cronValue: "",
    cronExpiryDate: ""
});

const generateCronSchedule = ({
    recurrence: "",
    scheduleDate: "2020-01-01",
    scheduleTime: "15:15",
    cronValue: "15 15 * * *",
    cronExpiryDate: "2025-01-01"
});

const OptionalRecurrence = (recurrence=null) => {
    if (!recurrence) return {};
    if (recurrence === "cron") {
        return generateCronSchedule;
    } else if (recurrence === "recurrence") {
        return generateRecurrenceSchedule;
    }
}

const GenerateSimpleTest = ({ id=1, dynamo=false, recurrence=null }) => {
    const testScenario = {
        scenarios: {
            [`testname-${id}`]: {
                requests: [{
                    body: {
                        testKey: "testValue"
                    }
                }]
            }
        }
    };
    return {
        testId: `test-${id}`,
        testName: `testname-${id}`,
        testType: "simple",
        fileType: "",
        // dynamo stringifies the `testScenario` field
        testScenario: (dynamo ? JSON.stringify(testScenario) : testScenario),
        ...(OptionalRecurrence(recurrence))
    };
};

const GenerateScriptTest = ({ id=2, dynamo=false, recurrence=null }) => {
    const testScenario = {
        scenarios: {
            [`testname-${id}`]: {
                script: "testScript.script"
            }
        }
    };
    return {
        testId: `test-${id}`,
        testName: `testname-${id}`,
        testType: "jmeter",
        fileType: "script",
        // dynamo stringifies the `testScenario` field
        testScenario: (dynamo ? JSON.stringify(testScenario) : testScenario),
        ...(OptionalRecurrence(recurrence))
    };
};

const GenerateZipTest = ({ id=3, dynamo=false, recurrence=null }) => {
    const testScenario = {
        scenarios: {
            [`testname-${id}`]: {
                script: "testScript.script"
            }
        }
    };
    return {
        testId: `test-${id}`,
        testName: `testname-${id}`,
        testType: "locust",
        fileType: "zip",
        // dynamo stringifies the `testScenario` field
        testScenario: (dynamo ? JSON.stringify(testScenario) : testScenario),
        ...(OptionalRecurrence(recurrence))
    };
};

const GenerateTestTarget = ({ id=1, body={} }) => {
    return {
        Id: `target-${id}`,
        Input: JSON.stringify({
            body,
        }),
    };
};

module.exports = {
    EmptyDynamoDbScan,
    EmptyCloudWatchRules,
    GenerateSimpleTest,
    GenerateScriptTest,
    GenerateZipTest,
    GenerateTestTarget,
};
