// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK v3
const mockDynamoDB = jest.fn();
const mockS3 = jest.fn();
const mockStepFunctions = jest.fn();
const mockEcs = jest.fn();
const mockCloudWatch = jest.fn();
const mockCloudWatchLogs = jest.fn();
const mockCloudWatchEvents = jest.fn();
const mockLambda = jest.fn();
const mockCloudFormation = jest.fn();
const mockServiceQuotas = jest.fn();

const createMockFactory = (moduleLocation, clientName, mockFn) => () => {
  // This function will be called by Jest during hoisting
  const actualModule = jest.requireActual(moduleLocation);

  const handler = {
    get: (target, prop) => mockFn,
  };

  return {
    ...actualModule,
    [clientName]: jest.fn(() => new Proxy({}, handler)),
  };
};

// Mock the individual service clients
jest.doMock("@aws-sdk/client-dynamodb", createMockFactory("@aws-sdk/client-dynamodb", "DynamoDB", mockDynamoDB));
jest.doMock("@aws-sdk/client-s3", createMockFactory("@aws-sdk/client-s3", "S3", mockS3));
jest.doMock("@aws-sdk/client-sfn", createMockFactory("@aws-sdk/client-sfn", "SFN", mockStepFunctions));
jest.doMock(
  "@aws-sdk/client-cloudwatch-logs",
  createMockFactory("@aws-sdk/client-cloudwatch-logs", "CloudWatchLogs", mockCloudWatchLogs)
);
jest.doMock(
  "@aws-sdk/client-cloudwatch-events",
  createMockFactory("@aws-sdk/client-cloudwatch-events", "CloudWatchEvents", mockCloudWatchEvents)
);
jest.doMock("@aws-sdk/client-lambda", createMockFactory("@aws-sdk/client-lambda", "Lambda", mockLambda));
jest.doMock(
  "@aws-sdk/client-cloudformation",
  createMockFactory("@aws-sdk/client-cloudformation", "CloudFormation", mockCloudFormation)
);
jest.doMock("@aws-sdk/client-ecs", createMockFactory("@aws-sdk/client-ecs", "ECS", mockEcs));
jest.doMock(
  "@aws-sdk/client-service-quotas",
  createMockFactory("@aws-sdk/client-service-quotas", "ServiceQuotas", mockServiceQuotas)
);
jest.doMock(
  "@aws-sdk/client-cloudwatch",
  createMockFactory("@aws-sdk/client-cloudwatch", "CloudWatch", mockCloudWatch)
);

jest.mock("@aws-sdk/lib-dynamodb", () => {
  const actualModule = jest.requireActual("@aws-sdk/lib-dynamodb");

  const handler = {
    get: (target, prop) => mockDynamoDB,
  };

  return {
    ...actualModule,
    DynamoDBDocument: {
      from: jest.fn(() => new Proxy({}, handler)),
    },
  };
});

const testId = "1234";
const listData = {
  Items: [{ testId: "1234" }, { testId: "5678" }],
};

const origData = {
  Item: {
    testId: "1234",
    name: "mytest",
    status: "running",
    testScenario: '{"name":"example"}',
    testTaskConfigs: [
      {
        region: "us-east-1",
        concurrency: "5",
        taskCount: "5",
      },
    ],
  },
};
let getData;

let getDataWithNoConfigs = {
  Item: {
    testId: "1234",
    name: "mytest",
    status: "running",
    testScenario: '{"name":"example"}',
  },
};

let getDataWithEmptyConfigs = {
  Item: {
    testId: "1234",
    name: "mytest",
    status: "running",
    testScenario: '{"name":"example"}',
    testTaskConfigs: [{}],
  },
};

const getSingleRegionalConf = {
  Items: [
    {
      testId: "region-us-east-1",
      ecsCloudWatchLogGroup: "testClusterUS-DLTEcsDLTCloudWatchLogsGroup",
      taskCluster: "testClusterUS",
      taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/testTaskDef1:1",
      subnetB: "subnet-123abc",
      region: "us-east-1",
      taskImage: "us-test-load-tester-image",
      subnetA: "subnet-456def",
      taskSecurityGroup: "sg-000000",
    },
  ],
};

const getSingleRegionalConfWithError = {
  Items: [
    {
      testId: "region-us-east-1",
      ecsCloudWatchLogGroup: "testClusterUS-DLTEcsDLTCloudWatchLogsGroup",
      taskCluster: "testClusterUS",
      taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/testTaskDef1:1",
      subnetB: "subnet-123abc",
      SUPPOSEDTOBEREGION: "us-east-1",
      taskImage: "us-test-load-tester-image",
      subnetA: "subnet-456def",
      taskSecurityGroup: "sg-000000",
    },
  ],
};

const getTwoRegionalConf = {
  Items: [
    {
      testId: "region-us-east-1",
      ecsCloudWatchLogGroup: "testClusterUS-DLTEcsDLTCloudWatchLogsGroup",
      taskCluster: "testClusterUS",
      taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/testTaskDef1:1",
      subnetB: "subnet-123abc",
      region: "us-east-1",
      taskImage: "us-test-load-tester-image",
      subnetA: "subnet-456def",
      taskSecurityGroup: "sg-000000",
    },
    {
      testId: "region-us-east-2",
      ecsCloudWatchLogGroup: "testClusterUS-DLTEcsDLTCloudWatchLogsGroup",
      taskCluster: "testClusterUS",
      taskDefinition: "arn:aws:ecs:us-east-2:123456789012:task-definition/testTaskDef1:1",
      subnetB: "subnet-123abc",
      region: "us-east-2",
      taskImage: "us-test-load-tester-image",
      subnetA: "subnet-456def",
      taskSecurityGroup: "sg-000000",
    },
  ],
};

const getClusters1 = {
  clusterArns: ["arn:of:cluster1"],
  nextToken: true,
};

const getClusters1Details = {
  clusters: [
    {
      clusterArn: "arn:of:cluster1",
      clusterName: "dlt-ar-multi-region",
      status: "ACTIVE",
      registeredContainerInstancesCount: 0,
      runningTasksCount: 2,
      pendingTasksCount: 1,
      activeServicesCount: 0,
      statistics: [
        { name: "runningFargateTasksCount", value: "2" },
        { name: "pendingFargateTasksCount", value: "1" },
      ],
      tags: [],
      settings: [],
      capacityProviders: [],
      defaultCapacityProviderStrategy: [],
    },
  ],
};

const getClusters2 = {
  clusterArns: ["arn:of:cluster2"],
};

const getEmptyClusters2Details = {
  clusters: [
    {
      clusterArn: "arn:of:cluster2",
      clusterName: "dlt-ar-multi-region",
      status: "ACTIVE",
      registeredContainerInstancesCount: 0,
      runningTasksCount: 0,
      pendingTasksCount: 0,
      activeServicesCount: 0,
      statistics: [],
      tags: [],
      settings: [],
      capacityProviders: [],
      defaultCapacityProviderStrategy: [],
    },
  ],
};

const getClusters2Details = {
  clusters: [
    {
      clusterArn: "arn:of:cluster2",
      clusterName: "dlt-ar-multi-region",
      status: "ACTIVE",
      registeredContainerInstancesCount: 0,
      runningTasksCount: 1,
      pendingTasksCount: 3,
      activeServicesCount: 0,
      statistics: [
        { name: "runningFargateTasksCount", value: "1" },
        { name: "pendingFargateTasksCount", value: "3" },
      ],
      tags: [],
      settings: [],
      capacityProviders: [],
      defaultCapacityProviderStrategy: [],
    },
  ],
};

const getRegionalClusters = {
  clusterArns: ["arn:of:cluster1"],
};

const dltTaskDefinition1 = {
  taskDefinition: {
    taskDefinitionArn: "arn:aws:ecs:us-east-1:task-definition-arn",
    family: "DLTEcsDLTTaskDefinition",
    taskRoleArn: "arn:aws:iam:task-role",
    executionRoleArn: "arn:aws:iam:execution-role",
    status: "ACTIVE",
    cpu: "2048",
    memory: "4096",
  },
};

const tasks1 = {
  taskArns: ["arn:of:task1", "arn:of:task2", "arn:of:task3"],
  nextToken: true,
};

const tasks2 = {
  taskArns: ["arn:of:task4", "arn:of:task5", "arn:of:task6"],
};

const tasksDescription = {
  tasks: [
    {
      clusterArn: "arn:of:cluster1",
      cpu: "2048",
      group: "groupid1",
      lastStatus: "RUNNING",
      launchType: "FARGATE",
      memory: "4096",
      taskArn: "arn:of:task1",
      taskDefinitionArn: "arn:of:task1",
    },
    {
      clusterArn: "arn:of:cluster1",
      cpu: "2048",
      group: "groupid1",
      lastStatus: "PENDING",
      launchType: "FARGATE",
      memory: "4096",
      taskArn: "arn:of:task2",
      taskDefinitionArn: "arn:of:task1",
    },
    {
      clusterArn: "arn:of:cluster1",
      cpu: "2048",
      group: "groupid1",
      lastStatus: "PROVISIONING",
      launchType: "FARGATE",
      memory: "4096",
      taskArn: "arn:of:task3",
      taskDefinitionArn: "arn:of:task1",
    },
    {
      clusterArn: "arn:of:cluster4",
      cpu: "2048",
      group: "groupid1",
      lastStatus: "RUNNING",
      launchType: "FARGATE",
      memory: "4096",
      taskArn: "arn:of:task1",
      taskDefinitionArn: "arn:of:task1",
    },
    {
      clusterArn: "arn:of:cluster5",
      cpu: "2048",
      group: "groupid1",
      lastStatus: "PENDING",
      launchType: "FARGATE",
      memory: "4096",
      taskArn: "arn:of:task2",
      taskDefinitionArn: "arn:of:task1",
    },
    {
      clusterArn: "arn:of:cluster6",
      cpu: "2048",
      group: "groupid1",
      lastStatus: "PROVISIONING",
      launchType: "FARGATE",
      memory: "4096",
      taskArn: "arn:of:task3",
      taskDefinitionArn: "arn:of:task1",
    },
  ],
  failures: [],
};

const multiRegionTasksList = [
  {
    region: "us-east-1",
    taskArns: ["arn:of:task1", "arn:of:task2", "arn:of:task3", "arn:of:task4", "arn:of:task5", "arn:of:task6"],
  },
  {
    region: "eu-west-1",
    taskArns: ["arn:of:task1", "arn:of:task2", "arn:of:task3", "arn:of:task4", "arn:of:task5", "arn:of:task6"],
  },
];

const updateData = {
  Attributes: { testStatus: "running" },
};
const originalConfig = {
  testName: "mytest",
  testDescription: "test",
  testTaskConfigs: [
    {
      region: "us-east-1",
      concurrency: "5",
      taskCount: "5",
    },
    {
      region: "eu-west-1",
      concurrency: "5",
      taskCount: "5",
    },
  ],
  testScenario: {
    execution: [
      {
        "ramp-up": "30s",
        "hold-for": "1m",
      },
    ],
  },
  scheduleDate: "2018-02-28",
  scheduleTime: "12:30",
  regionalTaskDetails: {
    "us-east-1": {
      dltAvailableTasks: "2000",
    },
    "eu-west-1": {
      dltAvailableTasks: "1000",
    },
  },
};
let config;

const context = {
  functionName: "lambdaFunctionName",
  invokedFunctionArn: "arn:of:lambdaFunctionName",
};

const eventInput = () => ({ body: JSON.stringify(config) });

// const expectClientCallContaining = (client, object, n) => {
//   if (n) {
//     expect(client).toHaveBeenNthCalledWith(n, expect.objectContaining({ input: object }));
//   } else {
//     expect(client).toHaveBeenCalledWith(expect.objectContaining({ input: object }));
//   }
// };

const rulesResponse = {
  Rules: [
    {
      Arn: "arn:of:rule/123",
      Name: "123",
    },
  ],
};

const getRegionalConf = {
  Item: {
    testId: "region-us-east-1",
    ecsCloudWatchLogGroup: "testCluster-DLTEcsDLTCloudWatchLogsGroup",
    taskCluster: "testCluster",
    taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/testTaskDef1:1",
    subnetB: "subnet-123abc",
    region: "us-east-1",
    taskImage: "test-load-tester-image",
    subnetA: "subnet-456def",
    taskSecurityGroup: "sg-000000",
  },
};

const getRegionalConf2 = {
  Item: {
    testId: "region-eu-west-1",
    ecsCloudWatchLogGroup: "testClusterEU-DLTEcsDLTCloudWatchLogsGroup",
    taskCluster: "testClusterEU",
    taskDefinition: "arn:aws:ecs:eu-west-1:123456789012:task-definition/testTaskDef2:1",
    subnetB: "subnet-abc123",
    region: "eu-west-1",
    taskImage: "eu-test-load-tester-image",
    subnetA: "subnet-def456",
    taskSecurityGroup: "sg-111111",
  },
};

const notRegionalConf = {
  ResponseMetadata: {
    RequestId: "1234567890ABCDEF",
  },
};

const getAllRegionalConfs = {
  Items: [
    {
      testId: "region-us-east-1",
      ecsCloudWatchLogGroup: "testClusterUS-DLTEcsDLTCloudWatchLogsGroup",
      taskCluster: "testClusterUS",
      taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/testTaskDef1:1",
      subnetB: "subnet-123abc",
      region: "us-east-1",
      taskImage: "us-test-load-tester-image",
      subnetA: "subnet-456def",
      taskSecurityGroup: "sg-000000",
    },
    {
      testId: "region-eu-west-1",
      ecsCloudWatchLogGroup: "testClusterEU-DLTEcsDLTCloudWatchLogsGroup",
      taskCluster: "testClusterEU",
      taskDefinition: "arn:aws:ecs:eu-west-1:123456789012:task-definition/testTaskDef2:1",
      subnetB: "subnet-abc123",
      region: "eu-west-1",
      taskImage: "eu-test-load-tester-image",
      subnetA: "subnet-def456",
      taskSecurityGroup: "sg-111111",
    },
  ],
};

const historyEntries = {
  Items: [
    {
      testTaskConfigs: [
        {
          taskCount: 1,
          taskCluster: "testTaskCluster1",
          subnetA: "subnet-aaaaa",
          ecsCloudWatchLogGroup: "testEcsCWG1",
          subnetB: "subnet-bbbbbbd",
          taskImage: "testTaskImage1",
          testId: "testId1",
          taskDefinition: "arn:test:taskGroup/testTaskDef:1",
          completed: 1,
          region: "us-west-2",
          taskSecurityGroup: "sg-111111",
          concurrency: 100,
        },
      ],
      testType: "simple",
      status: "complete",
      succPercent: "100.00",
      testRunId: "testRunId",
      startTime: "2022-03-26 23:42:14",
      testDescription: "test description",
      testId: "testId",
      endTime: "2022-03-26 23:48:25",
      results: {
        avg_lt: "0.03658",
        p0_0: "0.127",
        p99_0: "0.375",
        stdev_rt: "0.069",
        avg_ct: "0.02612",
        concurrency: "1",
        p99_9: "1.784",
        labels: [
          {
            avg_lt: "0.03658",
            p0_0: "0.127",
            p99_0: "0.375",
            stdev_rt: "0.069",
            avg_ct: "0.02612",
            label: "https://test.url",
            concurrency: "1",
            p99_9: "1.784",
            fail: 0,
            rc: [],
            succ: 967,
            p100_0: "1.784",
            bytes: "5384054559",
            p95_0: "0.244",
            avg_rt: "0.18487",
            throughput: 967,
            p90_0: "0.219",
            testDuration: "0",
            p50_0: "0.181",
          },
        ],
        fail: 0,
        rc: [],
        succ: 967,
        p100_0: "1.784",
        bytes: "5384054559",
        p95_0: "0.244",
        avg_rt: "0.18487",
        throughput: 967,
        p90_0: "0.219",
        testDuration: "180",
        p50_0: "0.181",
      },
      region: "us-west-2",
      metricS3Location: "testS3Location",
      testScenario: {
        execution: [
          {
            scenario: "testScenario1",
            "ramp-up": "0m",
            "hold-for": "3m",
          },
        ],
        reporting: [
          {
            summary: true,
            "dump-xml": "testXML/location",
            percentiles: true,
            "test-duration": true,
            "summary-labels": true,
            module: "final-stats",
          },
        ],
        scenarios: {
          testScenario: {
            requests: [
              {
                headers: {},
                method: "GET",
                body: {},
                url: "https://test.url",
              },
            ],
          },
        },
      },
    },
  ],
};

const getStackExports = {
  Exports: [
    {
      ExportingStackId: "arn:of:cloudformation:stack/stackName/abc-def-hij-123",
      Name: "RegionalCFTemplate",
      Value: "https://s3-test-url/prefix/regional.template",
    },
    {
      ExportingStackId: "arn:of:cloudformation:stack/notTheStack/xyz-456",
      Name: "NotTheExport",
      Value: "https://s3-test-url/IncorrectURL/wrong.template",
    },
  ],
};

const errorNoStackExports = {
  Exports: [{}],
};

const noUnprocessedItems = { UnprocessedItems: {} };
const unprocessedItems = {
  UnprocessedItems: {
    testHistoryTable: [
      {
        DeleteRequest: {
          Key: {
            testId: "1234",
            testRunId: "testRunId",
          },
        },
      },
    ],
  },
};

const getDisabledECSAccountSettings = {
  settings: [
    {
      name: "fargateVCPULimit",
      value: "disabled",
      principalArn: "arn:of:account:root",
    },
  ],
};

const getEnabledECSAccountSettings = {
  settings: [
    {
      name: "fargateVCPULimit",
      value: "enabled",
      principalArn: "arn:of:account:root",
    },
  ],
};

const getOtherECSAccountSettings = {
  settings: [
    {
      name: "fargateVCPULimit",
      value: "MALFORMED",
      principalArn: "arn:of:account:root",
    },
  ],
};

const serviceQuotaTaskLimit = {
  Quota: {
    ServiceCode: "fargate",
    ServiceName: "AWS Fargate",
    QuotaArn: "arn:of:account/L-790AF391",
    QuotaCode: "L-790AF391",
    QuotaName: "Fargate On-Demand resource count",
    Value: 1000,
    Unit: "None",
    Adjustable: true,
    GlobalQuota: false,
    UsageMetric: {
      MetricNamespace: "AWS/Usage",
      MetricName: "ResourceCount",
      MetricDimensions: [Object],
      MetricStatisticRecommendation: "Maximum",
    },
  },
};

const serviceQuotavCPULimit = {
  Quota: {
    ServiceCode: "fargate",
    ServiceName: "AWS Fargate",
    QuotaArn: "arn:of:account/L-790AF391",
    QuotaCode: "L-3032A538",
    QuotaName: "Fargate On-Demand vCPU resource count",
    Value: 4000,
    Unit: "None",
    Adjustable: true,
    GlobalQuota: false,
    UsageMetric: {
      MetricNamespace: "AWS/Usage",
      MetricName: "ResourceCount",
      MetricDimensions: [Object],
      MetricStatisticRecommendation: "Maximum",
    },
  },
};

process.env.SCENARIOS_BUCKET = "bucket";
process.env.SCENARIOS_TABLE = "testScenariosTable";
process.env.HISTORY_TABLE = "testHistoryTable";
process.env.HISTORY_TABLE_GSI_NAME = "testHistoryTableGSI";
process.env.STATE_MACHINE_ARN = "arn:of:state:machine";
process.env.LAMBDA_ARN = "arn:of:apilambda";
process.env.TASK_CANCELER_ARN = "arn:of:taskCanceler";
process.env.SOLUTION_ID = "SO0062";
process.env.STACK_ID = "arn:of:cloudformation:stack/stackName/abc-def-hij-123";
process.env.VERSION = "3.0.0";

// Mock solution-utils
jest.mock("solution-utils", () => ({
  getOptions: jest.fn(() => ({})),
  generateUniqueId: jest.fn(() => "abc1234567"),
  sendMetric: jest.fn(() => Promise.resolve()),
}));

const lambda = require("./index.js");

describe("#SCENARIOS API:: ", () => {
  beforeEach(() => {
    config = JSON.parse(JSON.stringify(originalConfig));
    getData = JSON.parse(JSON.stringify(origData));
    mockS3.mockReset();
    mockDynamoDB.mockReset();
    mockStepFunctions.mockReset();
    mockEcs.mockReset();
    mockCloudWatch.mockReset();
    mockCloudWatchLogs.mockReset();
    mockCloudWatchEvents.mockReset();
    mockLambda.mockReset();
    mockCloudFormation.mockReset();
    mockServiceQuotas.mockReset();

    jest.useFakeTimers("modern");
    jest.setSystemTime(new Date(Date.UTC(2017, 3, 22, 2, 28, 37))); // Note: Month is 0-indexed
  });

  beforeAll(() => {
    process.env.TZ = "UTC";
  });
  //Positive tests
  it('should return "SUCCESS" when "LISTTESTS" returns success', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(listData));
    // Mock the count queries for each test scenario
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 5 })); // for testId "1234"
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 3 })); // for testId "5678"
    const response = await lambda.listTests();
    expect(response.Items[0].testId).toEqual("1234");
    expect(response.Items[0].totalTestRuns).toEqual(5);
    expect(response.Items[1].totalTestRuns).toEqual(3);
  });

  it('should return "SUCCESS" when "GETTEST" returns success', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementation(() => Promise.resolve(historyEntries));
    // First call: listTasks returns taskArns
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));
    // Second call: describeTasks returns tasks with details
    mockEcs.mockImplementationOnce(() =>
      Promise.resolve({
        tasks: [
          { group: testId, taskArn: "arn:of:task1", lastStatus: "RUNNING", desiredStatus: "RUNNING" },
          { group: testId, taskArn: "arn:of:task2", lastStatus: "RUNNING", desiredStatus: "RUNNING" },
          { group: "notTestId", taskArn: "arn:of:task3", lastStatus: "RUNNING", desiredStatus: "RUNNING" }
        ],
      })
    );

    const response = await lambda.getTest(testId);
    expect(response.name).toEqual("mytest");
  });

  it('should return "SUCCESS" when "listTask" returns success', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));

    const response = await lambda.listTasks();
    expect(response).toEqual(multiRegionTasksList);
  });

  it('should return "SUCCESS" when "getAccountFargatevCPUDetails" returns correct vCPU limit, task definition, and vCPU usage', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getTwoRegionalConf));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));
    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasksDescription));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasksDescription));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({
      "us-east-1": { vCPULimit: 4000, vCPUsInUse: 12, vCPUsPerTask: 2 },
      "us-east-2": { vCPULimit: 4000, vCPUsInUse: 12, vCPUsPerTask: 2 },
    });
  });

  it('should return "SUCCESS" when "getAccountFargatevCPUDetails" returns correct task definition, vCPU usage, and errors on vCPU limit', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getTwoRegionalConf));

    mockServiceQuotas.mockImplementationOnce(() => Promise.reject("SQ ERROR"));
    mockServiceQuotas.mockImplementationOnce(() => Promise.reject("SQ ERROR"));

    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasksDescription));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasksDescription));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({
      "us-east-1": { vCPULimit: undefined, vCPUsInUse: 12, vCPUsPerTask: 2 },
      "us-east-2": { vCPULimit: undefined, vCPUsInUse: 12, vCPUsPerTask: 2 },
    });
  });

  it('should return "SUCCESS" when "getAccountFargatevCPUDetails" returns correct vCPU limit, vCPU usage and errors on task definition', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getTwoRegionalConf));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));
    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));
    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));
    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasksDescription));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasksDescription));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({
      "us-east-1": { vCPULimit: 4000, vCPUsInUse: 12, vCPUsPerTask: undefined },
      "us-east-2": { vCPULimit: 4000, vCPUsInUse: 12, vCPUsPerTask: undefined },
    });
  });

  it('should return "SUCCESS" when "getAccountFargatevCPUDetails" returns correct vCPU limit, task definition, and errors on vCPU usage', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getTwoRegionalConf));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));
    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));

    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));
    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({
      "us-east-1": { vCPULimit: 4000, vCPUsInUse: undefined, vCPUsPerTask: 2 },
      "us-east-2": { vCPULimit: 4000, vCPUsInUse: undefined, vCPUsPerTask: 2 },
    });
  });

  it('should return "SUCCESS" when "getAccountFargatevCPUDetails" fails on "getAllAPIData" but returns correct vCPU Limit and task definition', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getTwoRegionalConf));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));
    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));
    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));

    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));
    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasksDescription));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasksDescription));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({
      "us-east-1": { vCPULimit: 4000, vCPUsInUse: undefined, vCPUsPerTask: 2 },
      "us-east-2": { vCPULimit: 4000, vCPUsInUse: undefined, vCPUsPerTask: 2 },
    });
  });

  it('should return "SUCCESS" when "getAccountFargatevCPUDetails" and errors on vCPU limit, task definition, and vCPU usage', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getTwoRegionalConf));

    mockServiceQuotas.mockImplementationOnce(() => Promise.reject("SQ ERROR"));
    mockServiceQuotas.mockImplementationOnce(() => Promise.reject("SQ ERROR"));

    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));
    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));
    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));
    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));

    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));
    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({
      "us-east-1": { vCPULimit: undefined, vCPUsInUse: undefined, vCPUsPerTask: undefined },
      "us-east-2": { vCPULimit: undefined, vCPUsInUse: undefined, vCPUsPerTask: undefined },
    });
  });

  it('should return "SUCCESS" when "getAccountFargatevCPUDetails" returns correct vCPU usage when tests are running', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getSingleRegionalConf));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasksDescription));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({ "us-east-1": { vCPULimit: 4000, vCPUsInUse: 12, vCPUsPerTask: 2 } });
  });

  it('should return "SUCCESS" when "getAccountFargatevCPUDetails" returns correct vCPU usage when no clusters are running', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getSingleRegionalConf));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));

    mockEcs.mockImplementationOnce(() => Promise.resolve({ clusterArns: [] }));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({ "us-east-1": { vCPULimit: 4000, vCPUsInUse: 0, vCPUsPerTask: 2 } });
  });

  it('should return "SUCCESS" when "getAccountFargatevCPUDetails" returns correct vCPU usage when no tests are running', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getSingleRegionalConf));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.resolve({ taskArns: [] }));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({ "us-east-1": { vCPULimit: 4000, vCPUsInUse: 0, vCPUsPerTask: 2 } });
  });

  it('should return "SUCCESS" when "DELETETEST" returns success', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(historyEntries));
    mockDynamoDB.mockImplementation(() => Promise.resolve(noUnprocessedItems));
    mockCloudWatchLogs.mockImplementation(() => Promise.resolve());
    mockCloudWatch.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve(rulesResponse));
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());

    const response = await lambda.deleteTest(testId, context.functionName);
    const expectedDeleteDashboardParams = [`EcsLoadTesting-${testId}-${getRegionalConf.Item.region}`];
    expect(response).toEqual("success");
    expect(mockCloudWatch).toHaveBeenCalledWith({ DashboardNames: expectedDeleteDashboardParams });
  });

  it('should return "SUCCESS" when "DELETETEST" has unprocessed entries from "deleteTestHistory', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(historyEntries));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(unprocessedItems));
    mockDynamoDB.mockImplementation(() => Promise.resolve(noUnprocessedItems));
    mockCloudWatchLogs.mockImplementation(() => Promise.resolve());
    mockCloudWatch.mockImplementationOnce(() => Promise.resolve());

    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve(rulesResponse));
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());

    const response = await lambda.deleteTest(testId, context.functionName);
    const expectedDeleteDashboardParams = [`EcsLoadTesting-${testId}-${getRegionalConf.Item.region}`];
    expect(response).toEqual("success");
    expect(mockCloudWatch).toHaveBeenCalledWith({ DashboardNames: expectedDeleteDashboardParams });
  });

  it('DELETE should return "SUCCESS" when no metrics are found', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(historyEntries));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(noUnprocessedItems));
    mockCloudWatchLogs.mockImplementation(() =>
      Promise.reject({
        name: "ResourceNotFoundException",
        statusCode: 400,
      })
    );
    mockCloudWatch.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve(rulesResponse));
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());

    const response = await lambda.deleteTest(testId, context.functionName);
    expect(response).toEqual("success");
  });

  it('should return "SUCCESS" when "CREATETEST" returns success', async () => {
    mockS3.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockStepFunctions.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(updateData));
    const response = await lambda.createTest(config, context.functionName);
    expect(response.testStatus).toEqual("running");
    expect(mockStepFunctions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.stringContaining('"prefix":'),
      })
    );
    expect(mockStepFunctions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.stringContaining('"testRunId":'),
      })
    );
  });

  it("should use the right nextRun value for manually triggered recurring tests", async () => {
    config.recurrence = "daily";
    getData.Item.nextRun = "2017-04-23 02:28:37";
    mockS3.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockStepFunctions.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(updateData));
    const response = await lambda.createTest(config, context.functionName);
    expect(response.testStatus).toEqual("running");
    expect(mockDynamoDB).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({
          ":nr": "2017-04-23 02:28:37",
        }),
      })
    );
  });

  it('should record proper date when "CREATETEST" with daily recurrence', async () => {
    config.recurrence = "daily";
    mockS3.mockImplementation(() => Promise.resolve());
    mockStepFunctions.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(updateData));

    const response = await lambda.createTest(config, context.functionName);
    expect(response.testStatus).toEqual("running");
    expect(mockDynamoDB).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({
          ":nr": "2017-04-23 02:28:37",
        }),
      })
    );
  });

  it("should return SUCCESS for eventBridge triggered test", async () => {
    config.eventBridge = "true";
    mockS3.mockImplementation(() => Promise.resolve());
    mockStepFunctions.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(updateData));

    const response = await lambda.createTest(config, context.functionName);
    expect(response.testStatus).toEqual("running");
  });

  it("should return SUCCESS for eventBridge triggered test with cronValue", async () => {
    config.eventBridge = "true";
    config.cronValue = "0 0 * * *";

    mockS3.mockImplementation(() => Promise.resolve());
    mockStepFunctions.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(updateData));

    const response = await lambda.createTest(config, context.functionName);
    expect(response.testStatus).toEqual("running");
  });

  it('should record proper date when "CREATETEST" with weekly recurrence', async () => {
    config.recurrence = "weekly";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockS3.mockImplementation(() => Promise.resolve());
    mockStepFunctions.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockDynamoDB.mockImplementation(() => Promise.resolve(updateData));

    const response = await lambda.createTest(config, context.functionName);
    expect(response.testStatus).toEqual("running");
    expect(mockDynamoDB).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({
          ":nr": "2017-04-29 02:28:37",
        }),
      })
    );
  });

  it('should record proper date when "CREATETEST" with biweekly recurrence', async () => {
    config.recurrence = "biweekly";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockS3.mockImplementation(() => Promise.resolve());
    mockStepFunctions.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockDynamoDB.mockImplementation(() => Promise.resolve(updateData));

    const response = await lambda.createTest(config, context.functionName);
    expect(response.testStatus).toEqual("running");
    expect(mockDynamoDB).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({
          ":nr": "2017-05-06 02:28:37",
        }),
      })
    );
  });

  it('should record proper date when "CREATETEST" with monthly recurrence', async () => {
    config.recurrence = "monthly";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockS3.mockImplementation(() => Promise.resolve());
    mockStepFunctions.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockDynamoDB.mockImplementation(() => Promise.resolve(updateData));
    const response = await lambda.createTest(config, context.functionName);
    expect(response.testStatus).toEqual("running");
    expect(mockDynamoDB).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({
          ":nr": "2017-05-22 02:28:37",
        }),
      })
    );
  });

  it('should return SUCCESS when "CANCELTEST" finds running tasks and returns success', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(listData));
    // Mock count queries for listTests totalTestRuns
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 5 })); // for testId "1234"
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 3 })); // for testId "5678"
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve());

    const response = await lambda.cancelTest(testId);
    expect(response).toEqual("test cancelling");
    expect(mockLambda).toHaveBeenCalledWith(
      expect.objectContaining({
        Payload: JSON.stringify({
          testId: testId,
          testTaskConfig: getData.Item.testTaskConfigs[0],
        }),
      })
    );
  });

  it('should return SUCCESS when "SCHEDULETEST" returns success and scheduleStep is "create"', async () => {
    config.scheduleStep = "create";
    config.recurrence = "daily";

    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ Rules: [] }));
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve(rulesResponse));
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    const response = await lambda.scheduleTest(eventInput(), context);
    expect(response.testStatus).toEqual("scheduled");
  });

  it('should return SUCCESS when "SCHEDULETEST" returns success and scheduleStep is "create" but with cronValue', async () => {
    config.scheduleStep = "create";
    config.recurrence = "";
    config.scheduleDate = "";
    config.scheduleTime = "";
    config.cronValue = "0 0 * * *";
    config.cronExpiryDate = "2017-12-31";

    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ Rules: [] }));
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve(rulesResponse));
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    const response = await lambda.scheduleTest(eventInput(), context);
    expect(response.testStatus).toEqual("scheduled");
  });

  it('should return SUCCESS and record proper next daily run when "SCHEDULETEST" returns success when scheduleStep is start and recurrence exists', async () => {
    config.scheduleStep = "start";
    config.recurrence = "daily";

    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ Rules: [] }));
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ RuleArn: "arn:of:rule/123" }));
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    await lambda.scheduleTest(eventInput(), context);
    expect(mockCloudWatchEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ScheduleExpression: "rate(1 day)",
      })
    );
  });

  it('should return SUCCESS and record proper next weekly run when "SCHEDULETEST" returns success withe scheduleStep is start and recurrence exists', async () => {
    config.scheduleStep = "start";
    config.recurrence = "weekly";

    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve(rulesResponse));
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ RuleArn: "arn:of:rule/123" }));
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    await lambda.scheduleTest(eventInput(), context);
    expect(mockCloudWatchEvents).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        ScheduleExpression: "rate(7 days)",
      })
    );
  });

  it('should return SUCCESS and record proper next weekly run when "SCHEDULETEST" returns success with scheduleStep is start and cronValue exists', async () => {
    config.scheduleStep = "start";
    config.recurrence = "";
    config.cronValue = "0 0 * * *";

    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve(rulesResponse));
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ RuleArn: "arn:of:rule/123" }));
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    await lambda.scheduleTest(eventInput(), context);
    expect(mockCloudWatchEvents).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        ScheduleExpression: "cron(0 0 * * ? 2017)",
      })
    );
  });

  it('should return SUCCESS and record proper next biweekly run when "SCHEDULETEST" returns success withe scheduleStep is start and recurrence exists', async () => {
    config.scheduleStep = "start";
    config.recurrence = "biweekly";

    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ Rules: [] }));
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ RuleArn: "arn:of:rule/123" }));
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    await lambda.scheduleTest(eventInput(), context);
    expect(mockCloudWatchEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ScheduleExpression: "rate(14 days)",
      })
    );
  });

  it('should return SUCCESS and record proper next monthly run when "SCHEDULETEST" returns success and scheduleStep is start and recurrence exists', async () => {
    config.scheduleStep = "start";
    config.recurrence = "monthly";

    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ Rules: [] }));
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ RuleArn: "arn:of:rule/123" }));
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    await lambda.scheduleTest(eventInput(), context);
    expect(mockCloudWatchEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ScheduleExpression: "cron(30 12 28 * ? *)",
      })
    );
  });

  it('should return SUCCESS, and records proper nextRun when "SCHEDULETEST" returns success withe scheduleStep is start and no recurrence', async () => {
    config.scheduleStep = "start";

    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ Rules: [] }));
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ RuleArn: "arn:of:rule/123" }));
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    const response = await lambda.scheduleTest(eventInput(), context);
    expect(response.testStatus).toEqual("scheduled");
    expect(mockDynamoDB).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({
          ":nr": "2018-02-28 12:30:00",
        }),
      })
    );
    expect(mockCloudWatchEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ScheduleExpression: "cron(30 12 28 02 ? 2018)",
      })
    );
  });

  it('should return "SUCCESS" when "getCFUrl" returns a URL', async () => {
    mockCloudFormation.mockImplementation(() => Promise.resolve(getStackExports));

    const response = await lambda.getCFUrl();
    expect(response).toEqual("https://s3-test-url/prefix/regional.template");
  });

  it('should return "SUCCESS" when "getStackInfo" returns stack information', async () => {
    const mockStackResponse = {
      Stacks: [
        {
          CreationTime: new Date("2025-09-09T19:40:22Z"),
          StackId: "arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/12345",
          Tags: [{ Key: "SolutionVersion", Value: "v4.0.1" }],
        },
      ],
    };
    mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackResponse));

    const response = await lambda.getStackInfo();
    expect(response).toEqual({
      created_time: "2025-09-09T19:40:22.000Z",
      region: "us-west-2",
      version: "v4.0.1",
    });
  });

  it('should return "SUCCESS" with unknown version when no SolutionVersion tag exists', async () => {
    const mockStackResponse = {
      Stacks: [
        {
          CreationTime: new Date("2025-09-09T19:40:22Z"),
          StackId: "arn:aws:cloudformation:eu-west-1:123456789012:stack/test-stack/12345",
          Tags: [{ Key: "OtherTag", Value: "value" }],
        },
      ],
    };
    mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackResponse));

    const response = await lambda.getStackInfo();
    expect(response.version).toEqual("unknown");
  });

  it("should extract version from stack description when no SolutionVersion tag exists", async () => {
    const mockStackResponse = {
      Stacks: [
        {
          CreationTime: new Date("2025-09-09T19:40:22Z"),
          StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/12345",
          Description: "Distributed Load Testing Solution v4.0.1 - Creates infrastructure for load testing",
          Tags: [{ Key: "OtherTag", Value: "value" }],
        },
      ],
    };
    mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackResponse));

    const response = await lambda.getStackInfo();
    expect(response).toEqual({
      created_time: "2025-09-09T19:40:22.000Z",
      region: "us-east-1",
      version: "v4.0.1",
    });
  });

  it("should return unknown version when no tag or description version found", async () => {
    const mockStackResponse = {
      Stacks: [
        {
          CreationTime: new Date("2025-09-09T19:40:22Z"),
          StackId: "arn:aws:cloudformation:us-west-1:123456789012:stack/test-stack/12345",
          Description: "Some description without version",
          Tags: [{ Key: "OtherTag", Value: "value" }],
        },
      ],
    };
    mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackResponse));

    const response = await lambda.getStackInfo();
    expect(response.version).toEqual("unknown");
  });

  //Negative Tests
  it('should return "DB ERROR" when "LISTTESTS" fails', async () => {
    mockDynamoDB.mockImplementation(() => Promise.reject("DB ERROR"));

    try {
      await lambda.listTests();
    } catch (error) {
      expect(error).toEqual("DB ERROR");
    }
  });

  it('should return "SUCCESS" with totalTestRuns=0 when count query fails for a scenario', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(listData));
    // Mock the count query to fail for the first test scenario
    mockDynamoDB.mockImplementationOnce(() => Promise.reject("COUNT ERROR"));
    // Mock successful count for the second test scenario
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 2 }));
    const response = await lambda.listTests();
    expect(response.Items[0].testId).toEqual("1234");
    expect(response.Items[0].totalTestRuns).toEqual(0); // Should default to 0 on error
    expect(response.Items[1].totalTestRuns).toEqual(2);
  });

  it('should return "DB ERROR" when "GETTEST" fails', async () => {
    mockDynamoDB.mockImplementation(() => Promise.reject("DB ERROR"));

    try {
      await lambda.getTest(testId);
    } catch (error) {
      expect(error).toEqual("DB ERROR");
    }
  });

  it('should return "DB ERROR" when "DELETETEST" fails', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementation(() => Promise.reject("DB ERROR"));
    mockCloudWatchLogs.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatch.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve(rulesResponse));
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());

    try {
      await lambda.deleteTest(testId, context.functionName);
    } catch (error) {
      expect(error).toEqual("DB ERROR");
    }
  });

  it('should return "DB ERROR" when "DELETETEST" fails when deleting the test', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchLogs.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatch.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve(rulesResponse));
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => Promise.reject("DDB ERROR - DELETE FAILED"));

    try {
      await lambda.deleteTest(testId, context.functionName);
    } catch (error) {
      expect(error).toEqual("DDB ERROR - DELETE FAILED");
    }
  });

  it('should return "METRICS ERROR" when "DELETETEST" fails due to deleteMetricFilter error other than ResourceNotFoundException', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchLogs.mockImplementationOnce(() => Promise.reject("METRICS ERROR"));
    mockCloudWatch.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve(rulesResponse));
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());

    try {
      await lambda.deleteTest(testId, context.functionName);
    } catch (error) {
      expect(error).toEqual("METRICS ERROR");
    }
  });

  it('should return "STEP FUNCTIONS ERROR" when "CREATETEST" fails', async () => {
    mockS3.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockStepFunctions.mockImplementation(() => Promise.reject("STEP FUNCTIONS ERROR"));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    try {
      await lambda.createTest(config, context.functionName);
    } catch (error) {
      expect(error).toEqual("STEP FUNCTIONS ERROR");
    }
  });

  it('should return "DB ERROR" when "CREATETEST" fails', async () => {
    mockDynamoDB.mockImplementation(() => Promise.reject("DB ERROR"));
    mockS3.mockImplementation(() => Promise.resolve());
    mockStepFunctions.mockImplementation(() => Promise.resolve());

    try {
      await lambda.createTest(config, context.functionName);
    } catch (error) {
      expect(error).toEqual("DB ERROR");
    }
  });

  it('should return "InvalidParameter" when "CREATETEST" fails due to task count being less than 1', async () => {
    config.testTaskConfigs[0]["taskCount"] = "0";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    try {
      await lambda.createTest(config, context.functionName);
    } catch (error) {
      expect(error.code).toEqual("InvalidParameter");
    }

    //reset config
    config.testTaskConfigs[0]["taskCount"] = "5";
  });

  it('should return "InvalidParameter" when "CREATETEST" fails due to task count being greater than available tasks for first region', async () => {
    config.testTaskConfigs[0]["taskCount"] = "3000";
    const availableTasks = config.regionalTaskDetails["us-east-1"].dltAvailableTasks;
    let errorThrown = false;
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    try {
      await lambda.createTest(config, context.functionName);
    } catch (error) {
      errorThrown = true;
      expect(error.code).toEqual("InvalidParameter");
      expect(error.message).toEqual(`Task count should be positive number between 1 to ${availableTasks}.`);
    }
    expect(errorThrown).toStrictEqual(true);
    //reset config
    config.testTaskConfigs[0]["taskCount"] = "5";
  });

  it('should return "InvalidParameter" when "CREATETEST" fails due to task count being greater than available task for second region', async () => {
    config.testTaskConfigs[1]["taskCount"] = "2000";
    const availableTasks = config.regionalTaskDetails["eu-west-1"].dltAvailableTasks;
    let errorThrown = false;
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    try {
      await lambda.createTest(config, context.functionName);
    } catch (error) {
      errorThrown = true;
      expect(error.code).toEqual("InvalidParameter");
      expect(error.message).toEqual(`Task count should be positive number between 1 to ${availableTasks}.`);
    }
    expect(errorThrown).toStrictEqual(true);
    //reset config
    config.testTaskConfigs[1]["taskCount"] = "5";
  });

  it('should return "InvalidParameter" when "CREATETEST" fails due to concurrency being less 1', async () => {
    config.testTaskConfigs[0]["concurrency"] = "0";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    try {
      await lambda.createTest(config, context.functionName);
    } catch (error) {
      expect(error.code).toEqual("InvalidParameter");
    }
    //reset config
    config.testTaskConfigs[0]["concurrency"] = "5";
  });

  it('should return "InvalidParameter" when "CREATETEST" fails due to hold-for less than min with no units', async () => {
    config.testScenario.execution[0]["hold-for"] = "0";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    try {
      await lambda.createTest(config, context.functionName);
    } catch (error) {
      expect(error.code).toEqual("InvalidParameter");
    }
    //reset config
    config.testScenario.execution[0]["hold-for"] = "1m";
  });

  it('should return "InvalidParameter" when "CREATETEST" fails due to hold-for less than min with units', async () => {
    config.testScenario.execution[0]["hold-for"] = "0 ms";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    try {
      await lambda.createTest(config, context.functionName);
    } catch (error) {
      expect(error.code).toEqual("InvalidParameter");
    }

    //reset config
    config.testScenario.execution[0]["hold-for"] = "1m";
  });

  it('should return "InvalidParameter" when "CREATETEST" fails due to hold-for units being invalid', async () => {
    config.testScenario.execution[0]["hold-for"] = "2 seconds";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    try {
      await lambda.createTest(config, context.functionName);
    } catch (error) {
      expect(error.code).toEqual("InvalidParameter");
    }
    //reset config
    config.testScenario.execution[0]["hold-for"] = "1m";
  });

  it('should return "InvalidParameter" when "CREATETEST" fails due to hold-for being invalid', async () => {
    config.testScenario.execution[0]["hold-for"] = "a";
    config.testType = "simple";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    try {
      await lambda.createTest(config, context.functionName);
    } catch (error) {
      expect(error.code).toEqual("InvalidParameter");
    }
  });

  it('should return "InvalidParameter" when "CREATETEST" fails due to recurrence being invalid', async () => {
    config.recurrence = "invalid";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    try {
      await lambda.createTest(config, context.functionName);
    } catch (error) {
      expect(error.code).toEqual("InvalidParameter");
    }
  });

  it("should return test duration in seconds when getTestDurationSeconds is passed valid hold-for string in seconds", async () => {
    const testDuration = lambda.getTestDurationSeconds("120s");
    expect(testDuration).toEqual(120);
  });

  it("should return test duration in seconds when getTestDurationSeconds is passed valid hold-for string in minutes", async () => {
    const testDuration = lambda.getTestDurationSeconds("2m");
    expect(testDuration).toEqual(120);
  });

  it("should return an error when invalid hold-for string is provided", async () => {
    try {
      const testDuration = lambda.getTestDurationSeconds("3h");
    } catch (error) {
      expect(error.code).toEqual("InvalidParameter");
    }
  });

  it('should return an exception when "CreateTest" fails to return a regional config', async () => {
    mockS3.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(notRegionalConf));
    await lambda.createTest(config, context.functionName).catch((err) => {
      expect(err.message.toString()).toEqual(
        "The region requested does not have a stored infrastructure configuration."
      );
    });
  });

  it('should return InvalidParameter when "SCHEDULETEST" fails due to invalid recurrence', async () => {
    config.scheduleStep = "start";
    config.recurrence = "invalid";

    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ Rules: [] }));

    try {
      await lambda.scheduleTest(eventInput(), context);
    } catch (error) {
      expect(error.code).toEqual("InvalidParameter");
    }
  });

  it('should return "DB ERROR" when CANCELTEST fails', async () => {
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => Promise.reject("DB ERROR"));

    try {
      await lambda.cancelTest(testId);
    } catch (error) {
      expect(error).toEqual("DB ERROR");
    }
  });

  it('should return "ECS ERROR" when listTasks fails', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));

    try {
      await lambda.listTasks();
    } catch (error) {
      expect(error).toEqual("ECS ERROR");
    }
  });

  it('should return "ECS ERROR" when getAccountFargatevCPUDetails fails on chainAPICalls', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getSingleRegionalConf));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getDisabledECSAccountSettings));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotaTaskLimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getClusters1));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getClusters1Details));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getClusters2));

    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));

    try {
      const response = await lambda.getAccountFargatevCPUDetails();
    } catch (error) {
      expect(error).toEqual("ECS ERROR");
    }
  });

  it('should return "ECS ERROR" when getAccountFargatevCPUDetails fails on getAllAPIData', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getSingleRegionalConf));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getEnabledECSAccountSettings));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));

    try {
      const response = await lambda.getAccountFargatevCPUDetails();
    } catch (error) {
      expect(error).toEqual("ECS ERROR");
    }
  });

  it('should return "ECS ERROR" when getAccountFargatevCPUDetails fails on describeTasks', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getSingleRegionalConf));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getEnabledECSAccountSettings));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));

    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));

    try {
      const response = await lambda.getAccountFargatevCPUDetails();
    } catch (error) {
      expect(error).toEqual("ECS ERROR");
    }
  });

  it('should return "BAD_REQUEST" when "getTestRuns" is called with invalid limit', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(origData)); // getTestEntry

    try {
      await lambda.getTestRuns(testId, { limit: "150" }); // exceeds max of 100
    } catch (error) {
      expect(error.code).toEqual("BAD_REQUEST");
      expect(error.message).toContain("Limit must be between 1 and 100");
    }
  });

  it('should return "BAD_REQUEST" when "getTestRuns" is called with invalid timestamp format', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(origData)); // getTestEntry

    try {
      await lambda.getTestRuns(testId, { start_timestamp: "invalid-date" });
    } catch (error) {
      expect(error.code).toEqual("BAD_REQUEST");
      expect(error.message).toContain("Invalid start_timestamp format");
    }
  });

  it('should return "BAD_REQUEST" when "getTestRuns" is called with invalid next_token', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(origData)); // getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 1 })); // count query

    try {
      await lambda.getTestRuns(testId, { next_token: "invalid-token" });
    } catch (error) {
      expect(error.code).toEqual("BAD_REQUEST");
      expect(error.message).toContain("Invalid next_token format");
    }
  });

  it('should return "TEST_NOT_FOUND" when "getTestRuns" is called with non-existent testId', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // getTestEntry returns empty

    try {
      await lambda.getTestRuns("non-existent-id");
    } catch (error) {
      expect(error.code).toEqual("TEST_NOT_FOUND");
      expect(error.statusCode).toEqual(404);
    }
  });

  it('should return "DB ERROR" when "getTestRuns" fails', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(origData)); // getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.reject("DB ERROR")); // query history table fails

    try {
      await lambda.getTestRuns(testId);
    } catch (error) {
      expect(error).toEqual("DB ERROR");
    }
  });
});

it('should return "SUCCESS" when listClusters receives bad output', async () => {
  mockEcs.mockImplementationOnce(() => Promise.resolve(getEnabledECSAccountSettings));

  mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

  mockEcs.mockImplementationOnce(() => Promise.resolve("MALFORMED OUTPUT"));

  try {
    const response = await lambda.getAccountFargatevCPUDetails();
  } catch (error) {
    expect(error.toString()).toEqual(expect.stringContaining("TypeError: Cannot read prop"));
  }
});

it('should return "DDB ERROR" when listTasks fails', async () => {
  mockDynamoDB.mockImplementationOnce(() => Promise.reject("DDB ERROR"));

  try {
    await lambda.listTasks();
  } catch (error) {
    expect(error).toEqual("DDB ERROR");
  }
});

it('should return "DDB ERROR" when retrieveTestEntry fails', async () => {
  mockDynamoDB.mockImplementationOnce(() => Promise.reject("DDB ERROR"));

  try {
    await lambda.getTest(testId);
  } catch (error) {
    expect(error).toEqual("DDB ERROR");
  }
});

it('should return "DDB ERROR" when retrieveTestRegionConfigs fails', async () => {
  mockDynamoDB.mockImplementationOnce(() => Promise.reject("DDB ERROR"));

  try {
    await lambda.getTest(testId);
  } catch (error) {
    expect(error).toEqual("DDB ERROR");
  }
});

it('should return "InvalidConfiguration" when no testTaskConfigs are returned', async () => {
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getDataWithNoConfigs));

  try {
    await lambda.getTest(testId);
  } catch (error) {
    expect(error.code).toEqual("InvalidConfiguration");
  }
});

it('should return "InvalidInfrastructureConfiguration" when an empty testTaskConfigs are returned', async () => {
  mockDynamoDB.mockImplementation(() => Promise.resolve(getDataWithEmptyConfigs));

  try {
    await lambda.getTest(testId);
  } catch (error) {
    expect(error.code).toEqual("InvalidInfrastructureConfiguration");
  }
});

it("should return an error when no exports returned", async () => {
  mockCloudFormation.mockImplementation(() => Promise.resolve(errorNoStackExports));

  await lambda.getCFUrl(testId).catch((err) => {
    expect(err.toString()).toContain("TypeError");
    expect(err.toString()).toContain("Value");
  });
});

it('should return "STACK_NOT_FOUND" when no STACK_ID is available', async () => {
  const originalStackId = process.env.STACK_ID;
  delete process.env.STACK_ID;

  try {
    await lambda.getStackInfo();
  } catch (error) {
    expect(error.code).toEqual("STACK_NOT_FOUND");
    expect(error.statusCode).toEqual(404);
  }

  if (originalStackId !== undefined) {
    process.env.STACK_ID = originalStackId;
  }
});

it('should return "STACK_NOT_FOUND" when stack is not found', async () => {
  mockCloudFormation.mockImplementation(() => Promise.resolve({ Stacks: [] }));

  try {
    await lambda.getStackInfo();
  } catch (error) {
    expect(error.code).toEqual("STACK_NOT_FOUND");
    expect(error.statusCode).toEqual(404);
  }
});

it('should return "FORBIDDEN" when access is denied', async () => {
  mockCloudFormation.mockImplementation(() => Promise.reject({ name: "AccessDenied" }));

  try {
    await lambda.getStackInfo();
  } catch (error) {
    expect(error.code).toEqual("FORBIDDEN");
    expect(error.statusCode).toEqual(403);
  }
});

it('should return "INTERNAL_SERVER_ERROR" when CloudFormation fails', async () => {
  mockCloudFormation.mockImplementation(() => Promise.reject("CF ERROR"));

  try {
    await lambda.getStackInfo();
  } catch (error) {
    expect(error.code).toEqual("INTERNAL_SERVER_ERROR");
    expect(error.statusCode).toEqual(500);
  }
});

it('should return "S3 ERROR" when "PUTOBJECT" fails', async () => {
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
  mockS3.mockImplementation(() => Promise.reject("S3 ERROR"));

  try {
    await lambda.createTest(config, context.functionName);
  } catch (error) {
    expect(error).toEqual("S3 ERROR");
  }
});

it('should return "SUCCESS" when "getTestRuns" returns test run IDs with pagination', async () => {
  const testRunsData = {
    Items: [
      {
        testId: "1234",
        testRunId: "run-001",
        startTime: "2024-01-01T10:00:00Z",
      },
      {
        testId: "1234",
        testRunId: "run-002",
        startTime: "2024-01-02T10:00:00Z",
      },
    ],
    LastEvaluatedKey: {
      testId: "1234",
      testRunId: "run-002",
    },
  };

  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(origData)); // getTestEntry
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 2 })); // count query
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testRunsData)); // query history table

  const response = await lambda.getTestRuns(testId);
  expect(response.testRuns).toHaveLength(2);
  expect(response.testRuns[0].testRunId).toEqual("run-001");
  expect(response.testRuns[0].startTime).toEqual("2024-01-01T10:00:00Z");
  expect(response.pagination.limit).toEqual(20);
  expect(response.pagination.next_token).toBeTruthy();
});

it('should return "SUCCESS" when "getTestRuns" with latest=true returns only the latest test run', async () => {
  const testRunsData = {
    Items: [
      {
        testId: "1234",
        testRunId: "run-latest",
        startTime: "2024-01-15T14:30:00Z",
      },
    ],
  };

  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(origData)); // getTestEntry
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testRunsData)); // query history table

  const response = await lambda.getTestRuns(testId, { latest: "true" });
  expect(response.testRuns).toHaveLength(1);
  expect(response.testRuns[0].testRunId).toEqual("run-latest");
  expect(response.pagination.limit).toEqual(1);
  expect(response.pagination.next_token).toBeNull();
});

it('should return "SUCCESS" when "getTestRuns" with custom limit returns limited results', async () => {
  const testRunsData = {
    Items: [
      {
        testId: "1234",
        testRunId: "run-001",
        startTime: "2024-01-01T10:00:00Z",
      },
    ],
  };

  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(origData)); // getTestEntry
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 1 })); // count query
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testRunsData)); // query history table

  const response = await lambda.getTestRuns(testId, { limit: "5" });
  expect(response.testRuns).toHaveLength(1);
  expect(response.pagination.limit).toEqual(5);
});

it('should return "SUCCESS" when "getTestRuns" with timestamp filters', async () => {
  const testRunsData = {
    Items: [
      {
        testId: "1234",
        testRunId: "run-001",
        startTime: "2024-01-15T10:00:00Z",
      },
    ],
  };

  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(origData)); // getTestEntry
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 1 })); // count query
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testRunsData)); // query history table

  const response = await lambda.getTestRuns(testId, {
    start_timestamp: "2024-01-01T00:00:00Z",
    end_timestamp: "2024-12-31T23:59:59Z",
  });
  expect(response.testRuns).toHaveLength(1);
  expect(response.testRuns[0].testRunId).toEqual("run-001");
});

it('should return "SUCCESS" when "getTestRuns" with next_token for pagination', async () => {
  const testRunsData = {
    Items: [
      {
        testId: "1234",
        testRunId: "run-003",
        startTime: "2024-01-03T10:00:00Z",
      },
    ],
  };

  const nextToken = Buffer.from(JSON.stringify({ testId: "1234", testRunId: "run-002" })).toString("base64");

  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(origData)); // getTestEntry
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Count: 1 })); // count query
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testRunsData)); // query history table

  const response = await lambda.getTestRuns(testId, { next_token: nextToken });
  expect(response.testRuns).toHaveLength(1);
  expect(response.testRuns[0].testRunId).toEqual("run-003");
});

// normalizeTag tests
describe("normalizeTag", () => {
  it("should normalize basic tags correctly", () => {
    expect(lambda.normalizeTag("Test Tag")).toEqual("test-tag");
    expect(lambda.normalizeTag("UPPERCASE")).toEqual("uppercase");
    expect(lambda.normalizeTag("lowercase")).toEqual("lowercase");
  });

  it("should handle special characters", () => {
    expect(lambda.normalizeTag("test@tag#123")).toEqual("testtag123");
    expect(lambda.normalizeTag("tag!@#$%^&*()_+")).toEqual("tag");
    expect(lambda.normalizeTag("test.tag-name")).toEqual("testtag-name");
  });

  it("should handle multiple spaces and hyphens", () => {
    expect(lambda.normalizeTag("test   multiple   spaces")).toEqual("test-multiple-spaces");
    expect(lambda.normalizeTag("test---multiple---hyphens")).toEqual("test-multiple-hyphens");
    expect(lambda.normalizeTag("  leading and trailing  ")).toEqual("leading-and-trailing");
  });

  it("should handle edge cases", () => {
    expect(lambda.normalizeTag("")).toEqual("");
    expect(lambda.normalizeTag("   ")).toEqual("");
    expect(lambda.normalizeTag("123")).toEqual("123");
    expect(lambda.normalizeTag("-start-end-")).toEqual("start-end");
    expect(lambda.normalizeTag(null)).toEqual("null");
    expect(lambda.normalizeTag(undefined)).toEqual("undefined");
  });
});

// deleteTestRuns tests
describe("deleteTestRuns", () => {
  const testRunIds = ["run-001", "run-002", "run-003"];
  const testData = {
    Item: {
      testId: "1234",
      testName: "mytest",
      status: "complete",
      testScenario: '{"name":"example"}',
    },
  };

  it('should return "SUCCESS" when "deleteTestRuns" deletes multiple test runs', async () => {
    // Mock getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));

    // Mock get calls for validating test runs exist
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-001" } }));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-002" } }));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-003" } }));

    // Mock successful batch delete
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ UnprocessedItems: {} }));

    const response = await lambda.deleteTestRuns("1234", testRunIds);
    expect(response.deletedCount).toEqual(3);
  });

  it('should return "SUCCESS" when "deleteTestRuns" deletes single test run', async () => {
    // Mock getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));

    // Mock get call for validating test run exists
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-001" } }));

    // Mock successful batch delete
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ UnprocessedItems: {} }));

    const response = await lambda.deleteTestRuns("1234", ["run-001"]);
    expect(response.deletedCount).toEqual(1);
  });

  it('should return zero count when "deleteTestRuns" is called with empty array', async () => {
    // Mock getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));

    const response = await lambda.deleteTestRuns("1234", []);
    expect(response.deletedCount).toEqual(0);
  });

  it('should return zero count when "deleteTestRuns" is called with non-existent testRunIds', async () => {
    // Mock getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));

    // Mock get calls returning no items (test runs don't exist)
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({}));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({}));

    const response = await lambda.deleteTestRuns("1234", ["non-existent-1", "non-existent-2"]);
    expect(response.deletedCount).toEqual(0);
  });

  it('should skip non-string testRunIds silently in "deleteTestRuns"', async () => {
    // Mock getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));

    // Mock get call for the valid string testRunId
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-001" } }));

    // Mock successful batch delete
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ UnprocessedItems: {} }));

    const mixedTestRunIds = [123, "run-001", null, undefined, { id: "run-002" }];
    const response = await lambda.deleteTestRuns("1234", mixedTestRunIds);
    expect(response.deletedCount).toEqual(1); // Only the valid string testRunId should be processed
  });

  it('should return "TEST_NOT_FOUND" when "deleteTestRuns" is called with non-existent testId', async () => {
    // Mock getTestEntry returning no item
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({}));

    try {
      await lambda.deleteTestRuns("non-existent-test", testRunIds);
    } catch (error) {
      expect(error.code).toEqual("TEST_NOT_FOUND");
      expect(error.message).toEqual("testId 'non-existent-test' not found");
      expect(error.statusCode).toEqual(404);
    }
  });

  it('should return "BAD_REQUEST" when "deleteTestRuns" is called with non-array body', async () => {
    // Mock getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));

    try {
      await lambda.deleteTestRuns("1234", "not-an-array");
    } catch (error) {
      expect(error.code).toEqual("BAD_REQUEST");
      expect(error.message).toEqual("Request body must be an array of testRunIds");
      expect(error.statusCode).toEqual(400);
    }
  });

  it('should return "BAD_REQUEST" when "deleteTestRuns" is called with object instead of array', async () => {
    // Mock getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));

    try {
      await lambda.deleteTestRuns("1234", { testRunId: "run-001" });
    } catch (error) {
      expect(error.code).toEqual("BAD_REQUEST");
      expect(error.message).toEqual("Request body must be an array of testRunIds");
      expect(error.statusCode).toEqual(400);
    }
  });

  it('should handle DynamoDB errors in "deleteTestRuns" when getting test entry', async () => {
    // Mock getTestEntry failure
    mockDynamoDB.mockImplementationOnce(() => Promise.reject("DB ERROR"));

    try {
      await lambda.deleteTestRuns("1234", testRunIds);
    } catch (error) {
      expect(error).toEqual("DB ERROR");
    }
  });

  it("should skip testRunIds that cause DynamoDB errors during validation and continue processing", async () => {
    // Mock getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));

    // First testRunId causes a DynamoDB error during validation
    mockDynamoDB.mockImplementationOnce(() => Promise.reject(new Error("DB ERROR")));

    // Second testRunId validates successfully
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-002" } }));

    // Third testRunId validates successfully
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-003" } }));

    // Mock successful batch delete for the two valid testRunIds
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ UnprocessedItems: {} }));

    // The function should skip the first testRunId that caused an error and process the other two
    const response = await lambda.deleteTestRuns("1234", testRunIds);
    expect(response.deletedCount).toEqual(2); // Only run-002 and run-003 should be deleted
  });

  it('should handle DynamoDB errors in "deleteTestRuns" when performing batch delete', async () => {
    // Mock getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));

    // Mock get call for validating test run exists
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-001" } }));

    // Mock batch delete failure
    mockDynamoDB.mockImplementationOnce(() => Promise.reject("DB ERROR"));

    try {
      await lambda.deleteTestRuns("1234", ["run-001"]);
    } catch (error) {
      expect(error).toEqual("DB ERROR");
    }
  });

  it('should handle unprocessed items in "deleteTestRuns" batch delete', async () => {
    // Mock getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));

    // Mock get calls for validating test runs exist
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-001" } }));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-002" } }));

    // Mock batch delete with unprocessed items (first attempt)
    mockDynamoDB.mockImplementationOnce(() =>
      Promise.resolve({
        UnprocessedItems: {
          testHistoryTable: [
            {
              DeleteRequest: {
                Key: {
                  testId: "1234",
                  testRunId: "run-002",
                },
              },
            },
          ],
        },
      })
    );

    // Mock successful retry for unprocessed items
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ UnprocessedItems: {} }));

    const response = await lambda.deleteTestRuns("1234", ["run-001", "run-002"]);
    expect(response.deletedCount).toEqual(2);
  });

  it("should skip invalid testRunIds that cause errors and continue with valid ones", async () => {
    // Mock getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testData));

    // First testRunId causes an error
    mockDynamoDB.mockImplementationOnce(() => Promise.reject(new Error("Invalid format")));

    // Second testRunId is valid
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-002" } }));

    // Third testRunId doesn't exist
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({}));

    // Mock successful batch delete for the one valid testRunId
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ UnprocessedItems: {} }));

    const response = await lambda.deleteTestRuns("1234", ["invalid-format", "run-002", "non-existent"]);
    expect(response.deletedCount).toEqual(1); // Only run-002 should be deleted
  });
});

//Baseline management tests
describe("Baseline Management", () => {
  const baselineTestData = {
    Item: {
      testId: "1234",
      testName: "mytest",
      status: "complete",
      testScenario: '{"name":"example"}',
    },
  };

  const baselineHistoryData = {
    Item: {
      testId: "1234",
      testRunId: "run-5678",
      status: "complete",
      startTime: "2022-03-26 23:42:14",
      endTime: "2022-03-26 23:48:25",
      results: {
        avg_lt: "0.03658",
        throughput: 967,
        succ: 967,
        fail: 0,
      },
    },
  };

  const baselineTestDataWithBaseline = {
    Item: {
      ...baselineTestData.Item,
      baselineId: "run-1234",
    },
  };

  describe("PUT (setBaseline) Tests", () => {
    it('should return "SUCCESS" when "setBaseline" sets a new baseline', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestData));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineHistoryData));
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({ Attributes: { testId: "1234", baselineId: "run-5678" } })
      );

      const response = await lambda.setBaseline("1234", "run-5678");
      expect(response.message).toEqual("Baseline set successfully");
      expect(response.testId).toEqual("1234");
      expect(response.baselineId).toEqual("run-5678");
      expect(response.details).toEqual("Test run run-5678 is now the baseline for test 1234");
    });

    it('should return "SUCCESS" when "setBaseline" replaces existing baseline', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestDataWithBaseline));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineHistoryData));
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({ Attributes: { testId: "1234", baselineId: "run-5678" } })
      );

      const response = await lambda.setBaseline("1234", "run-5678");
      expect(response.message).toEqual("Baseline updated successfully");
      expect(response.testId).toEqual("1234");
      expect(response.baselineId).toEqual("run-5678");
      expect(response.previousBaselineId).toEqual("run-1234");
      expect(response.details).toEqual(
        "Test run run-5678 is now the baseline for test 1234, replacing previous baseline run-1234"
      );
    });

    it('should return "INVALID_PARAMETER" when "setBaseline" called without testRunId', async () => {
      try {
        await lambda.setBaseline("1234");
      } catch (error) {
        expect(error.code).toEqual("INVALID_PARAMETER");
        expect(error.message).toEqual("testRunId is required");
      }
    });

    it('should return "TEST_NOT_FOUND" when "setBaseline" called with non-existent testId', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({}));

      try {
        await lambda.setBaseline("non-existent", "run-5678");
      } catch (error) {
        expect(error.code).toEqual("TEST_NOT_FOUND");
        expect(error.message).toEqual("testId 'non-existent' not found");
      }
    });

    it('should return "TESTRUN_NOT_FOUND" when "setBaseline" called with non-existent testRunId', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestData));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({}));

      try {
        await lambda.setBaseline("1234", "non-existent-run");
      } catch (error) {
        expect(error.code).toEqual("TESTRUN_NOT_FOUND");
        expect(error.message).toEqual("testRunId 'non-existent-run' not found for test '1234'");
      }
    });

    it('should return "DB ERROR" when "setBaseline" fails on DynamoDB operation', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestData));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineHistoryData));
      mockDynamoDB.mockImplementationOnce(() => Promise.reject("DB ERROR"));

      try {
        await lambda.setBaseline("1234", "run-5678");
      } catch (error) {
        expect(error).toEqual("DB ERROR");
      }
    });
  });

  describe("GET (getBaseline) Tests", () => {
    it('should return baseline info when "getBaseline" called with existing baseline', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestDataWithBaseline));

      const response = await lambda.getBaseline("1234");
      expect(response.testId).toEqual("1234");
      expect(response.baselineId).toEqual("run-1234");
      expect(response.message).toEqual("Baseline retrieved successfully");
    });

    it('should return baseline with test run details when "getBaseline" called with includeResults=true', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestDataWithBaseline));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineHistoryData));

      const response = await lambda.getBaseline("1234", true);
      expect(response.testId).toEqual("1234");
      expect(response.baselineId).toEqual("run-1234");
      expect(response.message).toEqual("Baseline retrieved successfully");
      expect(response.testRunDetails).toBeDefined();
      expect(response.testRunDetails.testRunId).toEqual("run-5678");
      expect(response.testRunDetails.status).toEqual("complete");
      expect(response.testRunDetails.results).toBeDefined();
    });

    it('should return "NO_BASELINE_SET" response when test exists but has no baseline', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestData));

      const response = await lambda.getBaseline("1234");
      expect(response.testId).toEqual("1234");
      expect(response.baselineId).toBeNull();
      expect(response.message).toEqual("No baseline set for this test");
    });

    it('should return "TEST_NOT_FOUND" when "getBaseline" called with non-existent testId', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({}));

      try {
        await lambda.getBaseline("non-existent");
      } catch (error) {
        expect(error.code).toEqual("TEST_NOT_FOUND");
        expect(error.message).toEqual("testId 'non-existent' not found");
      }
    });

    it("should handle orphaned baseline gracefully when test run details not found", async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestDataWithBaseline));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // No test run found

      const response = await lambda.getBaseline("1234", true);
      expect(response.testId).toEqual("1234");
      expect(response.baselineId).toEqual("run-1234");
      expect(response.message).toEqual("Baseline retrieved successfully");
      expect(response.testRunDetails).toBeNull();
      expect(response.warning).toEqual("Baseline test run details not found - may have been deleted");
    });

    it('should return "DB ERROR" when "getBaseline" fails on DynamoDB operation', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.reject("DB ERROR"));

      try {
        await lambda.getBaseline("1234");
      } catch (error) {
        expect(error).toEqual("DB ERROR");
      }
    });

    it('should return "DB ERROR" when "getBaseline" fails on history lookup with includeResults=true', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestDataWithBaseline));
      mockDynamoDB.mockImplementationOnce(() => Promise.reject("DB ERROR"));

      try {
        await lambda.getBaseline("1234", true);
      } catch (error) {
        expect(error).toEqual("DB ERROR");
      }
    });
  });

  describe("DELETE (clearBaseline) Tests", () => {
    it('should return "SUCCESS" when "clearBaseline" removes existing baseline', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestDataWithBaseline));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Attributes: { testId: "1234" } }));

      const response = await lambda.clearBaseline("1234");
      expect(response.message).toEqual("Baseline cleared successfully");
      expect(response.testId).toEqual("1234");
      expect(response.details).toEqual("Baseline removed for test 1234");
    });

    it('should return "TEST_NOT_FOUND" when "clearBaseline" called with non-existent testId', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({}));

      try {
        await lambda.clearBaseline("non-existent");
      } catch (error) {
        expect(error.code).toEqual("TEST_NOT_FOUND");
        expect(error.message).toEqual("testId 'non-existent' not found");
      }
    });

    it('should return "NO_BASELINE_SET" when "clearBaseline" called with no existing baseline', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestData));

      try {
        await lambda.clearBaseline("1234");
      } catch (error) {
        expect(error.code).toEqual("NO_BASELINE_SET");
        expect(error.message).toEqual("No baseline is currently set for test '1234'");
      }
    });

    it('should return "DB ERROR" when "clearBaseline" fails on DynamoDB operation', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestDataWithBaseline));
      mockDynamoDB.mockImplementationOnce(() => Promise.reject("DB ERROR"));

      try {
        await lambda.clearBaseline("1234");
      } catch (error) {
        expect(error).toEqual("DB ERROR");
      }
    });
  });

  describe("GET (getTestRun) Tests", () => {
    it('should return "SUCCESS" when "getTestRun" called with existing test run', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineHistoryData));

      const response = await lambda.getTestRun("1234", "run-5678");

      expect(response.testRunId).toEqual("run-5678");
      expect(response.status).toEqual("complete");
      expect(response.startTime).toEqual("2022-03-26 23:42:14");
      expect(response.endTime).toEqual("2022-03-26 23:48:25");
      expect(response.results).toBeDefined();
    });

    it('should return "TESTRUN_NOT_FOUND" when "getTestRun" called with non-existent test run', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // Empty response

      try {
        await lambda.getTestRun("1234", "non-existent-run");
      } catch (error) {
        expect(error.code).toEqual("TESTRUN_NOT_FOUND");
        expect(error.message).toEqual("Test run 'non-existent-run' not found for test '1234'");
        expect(error.statusCode).toEqual(404);
      }
    });

    it('should return "INVALID_PARAMETER" when "getTestRun" called without testId', async () => {
      try {
        await lambda.getTestRun("", "run-5678");
      } catch (error) {
        expect(error.code).toEqual("INVALID_PARAMETER");
        expect(error.message).toEqual("testId is required");
        expect(error.statusCode).toEqual(400);
      }
    });

    it('should return "INVALID_PARAMETER" when "getTestRun" called without testRunId', async () => {
      try {
        await lambda.getTestRun("1234", "");
      } catch (error) {
        expect(error.code).toEqual("INVALID_PARAMETER");
        expect(error.message).toEqual("testRunId is required");
        expect(error.statusCode).toEqual(400);
      }
    });

    it('should return "INTERNAL_SERVER_ERROR" when "getTestRun" fails due to unexpected error', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.reject(new Error("Unexpected database error")));

      try {
        await lambda.getTestRun("1234", "run-5678");
      } catch (error) {
        expect(error.code).toEqual("INTERNAL_SERVER_ERROR");
        expect(error.message).toContain("Failed to retrieve test run");
        expect(error.statusCode).toEqual(500);
      }
    });
  });
});
