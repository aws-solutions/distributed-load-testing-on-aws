// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

process.env = {
  DDB_TABLE: "testDDBTable",
};

// Mock DynamoDbDocument
const mockDynamoDb = {
  scan: jest.fn(),
  update: jest.fn(),
};

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocument: {
    from: jest.fn(() => ({
      scan: mockDynamoDb.scan,
      update: mockDynamoDb.update,
    })),
  },
}));

// Mock CloudWatchEvents
const mockcloudwatch = {
  listRules: jest.fn(),
  listTargetsByRule: jest.fn(),
  putTargets: jest.fn(),
};

jest.mock("@aws-sdk/client-cloudwatch-events", () => ({
    CloudWatchEvents: jest.fn(() => ({
        listRules: mockcloudwatch.listRules,
        listTargetsByRule: mockcloudwatch.listTargetsByRule,
        putTargets: mockcloudwatch.putTargets,
    })),
}));

const fixtures = require('./index.fixtures.js');
const { updateScheduledTests: sut } = require("./index.js");

describe("No tests configured in DynamoDb", () => {
    beforeEach(() => {
        mockDynamoDb.scan.mockResolvedValue(fixtures.EmptyDynamoDbScan);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should not have called any aws-sdk libs except for dynamodb scan", async () => {
        await sut();
        expect(mockDynamoDb.scan).toHaveBeenCalledTimes(1);

        [
            mockDynamoDb.update,
            mockcloudwatch.listRules,
            mockcloudwatch.listTargetsByRule,
            mockcloudwatch.putTargets
        ].forEach(mock => {
            expect(mock).not.toHaveBeenCalled();
        })
    })
});

describe("Only 'Run Now' tests configured (No scheduled tests available)", () => {
    beforeEach(() => {
        mockDynamoDb.scan.mockResolvedValue({
            Items: [
                fixtures.GenerateSimpleTest({ dynamo: true }),
                fixtures.GenerateScriptTest({ dynamo: true }),
                fixtures.GenerateZipTest({ dynamo: true }),
            ],
        })
        mockcloudwatch.listRules.mockResolvedValue(fixtures.EmptyCloudWatchRules)
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should not have called cloudwatch listRules for each dynamodb test", async () => {
        await sut();
        expect(mockDynamoDb.scan).toHaveBeenCalledTimes(1);

        // Cloudwatch.listRules called for each test found in Dynamo
        for (let i = 1; i <= 3; i++) {
            expect(mockcloudwatch.listRules).toHaveBeenNthCalledWith(i, { NamePrefix: `test-${i}` });    
        }

        [
            mockcloudwatch.listTargetsByRule,
            mockcloudwatch.putTargets
        ].forEach(mock => {
            expect(mock).not.toHaveBeenCalled();
        })
    });

    it("should update dynamodb entry for simple endpoint test only", async () => {
        await sut();
        expect(mockDynamoDb.scan).toHaveBeenCalledTimes(1);

        // Update for Simple test type
        expect(mockDynamoDb.update).toHaveBeenNthCalledWith(1, {
            TableName: "testDDBTable",
            Key: { testId: "test-1" },
            UpdateExpression: "SET testScenario = :testScenario, fileType = :fileType",
            ExpressionAttributeValues: {
                ":testScenario": JSON.stringify({
                    scenarios: {
                        "testname-1": {
                            requests: [{
                                body: JSON.stringify({
                                    testKey: "testValue"
                                })
                            }]
                        }
                    }
                }),
                ":fileType": "none"
            },
        });
    });
});

describe("Scheduled tests of all types along with 'Run Now' tests", () => {
    beforeEach(() => {
        mockDynamoDb.scan.mockImplementation(({ ExclusiveStartKey }) => {
            if (!ExclusiveStartKey) {
                return {
                    Items: [
                        fixtures.GenerateSimpleTest({ id: 1, dynamo: true, recurrence: "cron" }),
                        fixtures.GenerateScriptTest({ id: 2, dynamo: true, recurrence: "recurrence" }),
                        fixtures.GenerateZipTest({ id: 3, dynamo: true, recurrence: "cron" }),
                    ],
                    LastEvaluatedKey: 'testkey'
                }
            } else {
                return {
                    Items: [
                        fixtures.GenerateSimpleTest({ id: 4, dynamo: true }),
                        fixtures.GenerateScriptTest({ id: 5, dynamo: true }),
                        fixtures.GenerateZipTest({ id: 6, dynamo: true }),
                    ],
                }
            }
        });

        mockcloudwatch.listRules.mockImplementation(({ NamePrefix }) => {
            const rulesResponse = structuredClone(fixtures.EmptyCloudWatchRules);
            // Return a rule if test id is one of test-1, test-2, or test-3
            for (let i = 1; i <= 3; i++) {
                if (NamePrefix === `test-${i}`) {
                    rulesResponse.Rules.push({ Name: NamePrefix });
                }
            };
            return rulesResponse;
        });

        mockcloudwatch.listTargetsByRule.mockImplementation(({ Rule }) => {
            const targetsResponse = { Targets: [] };
            /**
             * Id
             * Input - stringified input with {body}
             */
            switch (Rule) {
                case 'test-1':
                    targetsResponse.Targets.push(
                        fixtures.GenerateTestTarget({
                            id: 1,
                            body: JSON.stringify(fixtures.GenerateSimpleTest({ id: 1, recurrence: "cron" })),
                        }),
                    );
                    break;
                case 'test-2':
                    targetsResponse.Targets.push(
                        fixtures.GenerateTestTarget({
                            id: 2,
                            body: JSON.stringify(fixtures.GenerateScriptTest({ id: 2, recurrence: "recurrence" })),
                        }),
                    );
                    break;
                case 'test-3':
                    targetsResponse.Targets.push(
                        fixtures.GenerateTestTarget({
                            id: 3,
                            body: JSON.stringify(fixtures.GenerateZipTest({ id: 3, recurrence: "cron" })),
                        }),
                    );
                    break;
                default:
            }
            return targetsResponse;
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should call DynamoDb scan 2 times total", async () => {
        await sut();

        expect(mockDynamoDb.scan).toHaveBeenCalledTimes(2);
    });

    it("should call DynamoDb update 2 times for the simple endpoint tests", async () => {
        await sut();
       
        expect(mockDynamoDb.update).toHaveBeenNthCalledWith(1, {
            TableName: "testDDBTable",
            Key: { testId: "test-1" },
            UpdateExpression: "SET testScenario = :testScenario, fileType = :fileType",
            ExpressionAttributeValues: {
                ":testScenario": JSON.stringify({
                    scenarios: {
                        "testname-1": {
                            requests: [{
                                body: JSON.stringify({
                                    testKey: "testValue"
                                })
                            }]
                        }
                    }
                }),
                ":fileType": "none"
            },
        });
        expect(mockDynamoDb.update).toHaveBeenNthCalledWith(2, {
            TableName: "testDDBTable",
            Key: { testId: "test-4" },
            UpdateExpression: "SET testScenario = :testScenario, fileType = :fileType",
            ExpressionAttributeValues: {
                ":testScenario": JSON.stringify({
                    scenarios: {
                        "testname-4": {
                            requests: [{
                                body: JSON.stringify({
                                    testKey: "testValue"
                                })
                            }]
                        }
                    }
                }),
                ":fileType": "none"
            },
        });
    });

    it("should have called cloudwatch events listRules 6 times (for each configured test)", async () => {
        await sut();

        expect(mockcloudwatch.listRules).toHaveBeenCalledTimes(6);
    });

    it("should have called listTargetsByRule 3 times (for each scheduled test configured)", async () => {
        await sut();

        expect(mockcloudwatch.listTargetsByRule).toHaveBeenCalledTimes(3);
    });

    it("should have called putTargets 3 times (for each target)", async () => {
        await sut();

        // Assert Simple Endpoint test
        const updatedSimpleTestBody = fixtures.GenerateSimpleTest({ id: 1, recurrence: "cron" });
        updatedSimpleTestBody.testScenario.scenarios["testname-1"].requests[0].body = JSON.stringify(
            updatedSimpleTestBody.testScenario.scenarios["testname-1"].requests[0].body
        );
        delete updatedSimpleTestBody.recurrence;
        delete updatedSimpleTestBody.fileType;
        expect(mockcloudwatch.putTargets).toHaveBeenNthCalledWith(1, {
            Rule: "test-1",
            Targets: [{
                Id: "target-1",
                Input: JSON.stringify({
                    body: JSON.stringify(updatedSimpleTestBody),
                }),
            }]
        });

        // Assert Script test
        const updatedScriptTestBody = fixtures.GenerateScriptTest({ id: 2, recurrence: "recurrence" })
        delete updatedScriptTestBody.cronValue;
        delete updatedScriptTestBody.cronExpiryDate;
        expect(mockcloudwatch.putTargets).toHaveBeenNthCalledWith(2, {
            Rule: "test-2",
            Targets: [{
                Id: "target-2",
                Input: JSON.stringify({
                    body: JSON.stringify(updatedScriptTestBody),
                }),
            }]
        });

        // Assert Zip test
        const updatedZipTestBody = fixtures.GenerateZipTest({ id: 3, recurrence: "cron" });
        delete updatedZipTestBody.recurrence;
        expect(mockcloudwatch.putTargets).toHaveBeenNthCalledWith(3, {
            Rule: "test-3",
            Targets: [{
                Id: "target-3",
                Input: JSON.stringify({
                    body: JSON.stringify(updatedZipTestBody),
                }),
            }]
        });
    });
});

describe("Scheduled tests with multiple rules and targets", () => {
    beforeEach(() => {
        // Scheduled tests mock in dynamo
        mockDynamoDb.scan.mockResolvedValue({
            Items: [
                fixtures.GenerateScriptTest({ id: 1, dynamo: true, recurrence: "cron" }),
            ],
        });

        // Rules mock response
        const rulesResponse = structuredClone(fixtures.EmptyCloudWatchRules);
        rulesResponse.Rules.push({ Name: 'rule-1' });
        rulesResponse.Rules.push({ Name: 'rule-2' });
        mockcloudwatch.listRules.mockResolvedValue(rulesResponse);

        // Rule Targets mock response
        mockcloudwatch.listTargetsByRule.mockImplementation(({ Rule }) => {
            const targetsResponse = { Targets: [] };
            
            // manually update body to fix v3 issues to simulate case when no update is needed
            const noFixBody = fixtures.GenerateScriptTest({ id: 1, recurrence: "cron" });
            delete noFixBody.recurrence;

            switch (Rule) {
                case 'rule-1':
                    targetsResponse.Targets.push(
                        fixtures.GenerateTestTarget({
                            id: 1,
                            body: JSON.stringify(noFixBody),
                        }),
                    );
                    targetsResponse.Targets.push(
                        fixtures.GenerateTestTarget({
                            id: 2,
                            body: JSON.stringify(noFixBody),
                        }),
                    );
                    break;
                case 'rule-2':
                    targetsResponse.Targets.push(
                        fixtures.GenerateTestTarget({
                            id: 3,
                            body: JSON.stringify(fixtures.GenerateScriptTest({ id: 1, recurrence: "cron" })),
                        }),
                    );
                    targetsResponse.Targets.push(
                        fixtures.GenerateTestTarget({
                            id: 4,
                            body: JSON.stringify(noFixBody),
                        }),
                    );
                    break;
                default:
            }
            return targetsResponse;
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should call DynamoDb scan 1 times total", async () => {
        await sut();

        expect(mockDynamoDb.scan).toHaveBeenCalledTimes(1);
    });

    it("should call CloudWatch listRules 1 times total", async () => {
        await sut();

        expect(mockcloudwatch.listRules).toHaveBeenCalledTimes(1);
    });

    it("should call CloudWatch putTargets 1 times total with 1 target as parameter", async () => {
        await sut();

        expect(mockcloudwatch.putTargets).toHaveBeenCalledTimes(1);

        const cleanBody = fixtures.GenerateScriptTest({ id: 1, recurrence: "cron" });
        delete cleanBody.recurrence;

        const expectedParameter = fixtures.GenerateTestTarget({
            id: 3,
            body: JSON.stringify(cleanBody),
        });
        expect(mockcloudwatch.putTargets).toHaveBeenCalledWith({
            Rule: 'rule-2',
            Targets: [expectedParameter]
        });
    });
});
