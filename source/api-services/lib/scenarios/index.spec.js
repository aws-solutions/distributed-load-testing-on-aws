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
const mockScheduler = jest.fn();
const { NotFound } = jest.requireActual("@aws-sdk/client-s3");

const s3NotFound = () =>
  new NotFound({
    message: "Not Found",
    $metadata: { httpStatusCode: 404 },
  });

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
jest.doMock(
  "@aws-sdk/client-scheduler",
  createMockFactory("@aws-sdk/client-scheduler", "Scheduler", mockScheduler)
);

// Mock @amzn/dlt-common's RSS fetch so tests never hit the public Solutions feed.
// checkRegionalCompatibility and isUpdateAvailable forward to the real implementations.
const mockGetLatestVersionFromRss = jest.fn();
jest.doMock("@amzn/dlt-common", () => {
  const actual = jest.requireActual("@amzn/dlt-common");
  return {
    ...actual,
    getLatestVersionFromRss: mockGetLatestVersionFromRss,
  };
});

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
  Items: [{ testId: "1234", totalTestRuns: 5 }, { testId: "5678", totalTestRuns: 3 }],
};

// A prior run in a terminal (safe) state: this is the realistic state of an
// existing scenario when a new run is started. Starting over an active run is
// now rejected by the server-side single-run guard (see concurrency-guard.spec.js),
// so createTest "start" tests use a terminal status here. Read-only tests
// (getTest, getTestRuns) do not depend on this value.
const origData = {
  Item: {
    testId: "1234",
    testName: "mytest",
    testType: "simple",
    status: "complete",
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
    testName: "mytest",
    testType: "simple",
    status: "running",
    testScenario: '{"name":"example"}',
  },
};

let getDataWithEmptyConfigs = {
  Item: {
    testId: "1234",
    testName: "mytest",
    testType: "simple",
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
      version: "3.0.0",
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
      version: "3.0.0",
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
      version: "3.0.0",
    },
  ],
};

// Thin-spoke: only hub (us-east-1) has taskDefinition, regional stack does not
const getTwoRegionalConfThinSpoke = {
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
      version: "3.0.0",
    },
    {
      testId: "region-us-east-2",
      ecsCloudWatchLogGroup: "testClusterUS-DLTEcsDLTCloudWatchLogsGroup",
      taskCluster: "testClusterUS",
      subnetB: "subnet-123abc",
      region: "us-east-2",
      subnetA: "subnet-456def",
      taskSecurityGroup: "sg-000000",
      version: "3.0.0",
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

const nativeTaskDefinitions = {
  jmeter: "arn:aws:ecs:us-east-1:123456789012:task-definition/testJmeterTaskDef:1",
  k6: "arn:aws:ecs:us-east-1:123456789012:task-definition/testK6TaskDef:1",
  locust: "arn:aws:ecs:us-east-1:123456789012:task-definition/testLocustTaskDef:1",
};

// The hub region's row. nativeTaskDefinitions is absent on a hub deployed
// before native mode — see the legacy-hub test below.
const getRegionalConf = {
  Item: {
    testId: "region-us-east-1",
    ecsCloudWatchLogGroup: "testCluster-DLTEcsDLTCloudWatchLogsGroup",
    taskCluster: "testCluster",
    taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/testTaskDef1:1",
    nativeTaskDefinitions,
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
      version: "3.0.0",
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
      version: "3.0.0",
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
      Name: "stackName-RegionalCFTemplate",
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
process.env.STACK_NAME = "stackName";
process.env.VERSION = "3.0.0";
process.env.MIN_COMPATIBLE_VERSION = "3.0.0";
process.env.AWS_REGION = "us-east-1";

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
    mockScheduler.mockReset();
    mockGetLatestVersionFromRss.mockReset();
    mockGetLatestVersionFromRss.mockResolvedValue("9.9.9");

    jest.useFakeTimers("modern");
    jest.setSystemTime(new Date(Date.UTC(2017, 3, 22, 2, 28, 37))); // Note: Month is 0-indexed
  });

  beforeAll(() => {
    process.env.TZ = "UTC";
  });
  //Positive tests
  it('should return "SUCCESS" when "LISTTESTS" returns success', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(listData));
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
    expect(response.testName).toEqual("mytest");
  });

  it("getTest derives scheduleDate/scheduleTime from nextRun for a one-time schedule", async () => {
    // One-time schedule: nextRun set, no cronValue. The pair is never persisted,
    // so it must be derived on read (FC-075) for the edit form to restore Run Once.
    getData.Item.nextRun = "2026-12-25 14:30:00";
    getData.Item.scheduleTimezone = "America/New_York";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementation(() => Promise.resolve(historyEntries));

    const response = await lambda.getTest(testId);
    expect(response.scheduleDate).toEqual("2026-12-25");
    // Seconds dropped: the client time field expects HH:MM.
    expect(response.scheduleTime).toEqual("14:30");
    expect(response.scheduleTimezone).toEqual("America/New_York");
  });

  it("getTest does not derive schedule fields for a recurring (cron) schedule", async () => {
    // Recurring: nextRun is the next occurrence, not the configured time, so the
    // pair must not be derived from it.
    getData.Item.cronValue = "0 8 * * *";
    getData.Item.nextRun = "2026-12-25 14:30:00";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementation(() => Promise.resolve(historyEntries));

    const response = await lambda.getTest(testId);
    expect(response.scheduleDate).toBeUndefined();
    expect(response.scheduleTime).toBeUndefined();
  });

  it("listTests derives one-time schedule fields but leaves recurring untouched", async () => {
    const oneTime = { testId: "ot", nextRun: "2026-12-25 14:30:00", scheduleTimezone: "America/New_York" };
    const recurring = { testId: "rec", nextRun: "2026-12-26 08:00:00", cronValue: "0 8 * * *" };
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Items: [oneTime, recurring] }));

    const response = await lambda.listTests();
    const otItem = response.Items.find((i) => i.testId === "ot");
    const recItem = response.Items.find((i) => i.testId === "rec");
    expect(otItem.scheduleDate).toEqual("2026-12-25");
    expect(otItem.scheduleTime).toEqual("14:30");
    expect(recItem.scheduleDate).toBeUndefined();
    expect(recItem.scheduleTime).toBeUndefined();
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

    // Hub describeTaskDefinition (once)
    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));

    // Per-region: ServiceQuotas, listClusters, listTasks (paginated), describeTasks
    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));
    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));
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

    // Hub describeTaskDefinition (once)
    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));

    mockServiceQuotas.mockImplementationOnce(() => Promise.reject("SQ ERROR"));
    mockServiceQuotas.mockImplementationOnce(() => Promise.reject("SQ ERROR"));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));
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

    // Hub describeTaskDefinition fails
    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));
    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));
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

    // Hub describeTaskDefinition (once)
    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));
    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));
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

    // Hub describeTaskDefinition (once)
    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));
    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));
    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({
      "us-east-1": { vCPULimit: 4000, vCPUsInUse: undefined, vCPUsPerTask: 2 },
      "us-east-2": { vCPULimit: 4000, vCPUsInUse: undefined, vCPUsPerTask: 2 },
    });
  });

  it('should return "SUCCESS" when "getAccountFargatevCPUDetails" and errors on vCPU limit, task definition, and vCPU usage', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getTwoRegionalConf));

    // Hub describeTaskDefinition fails
    mockEcs.mockImplementationOnce(() => Promise.reject("ECS ERROR"));

    mockServiceQuotas.mockImplementationOnce(() => Promise.reject("SQ ERROR"));
    mockServiceQuotas.mockImplementationOnce(() => Promise.reject("SQ ERROR"));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));
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

    // Hub describeTaskDefinition (once)
    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks1));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasks2));

    mockEcs.mockImplementationOnce(() => Promise.resolve(tasksDescription));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({ "us-east-1": { vCPULimit: 4000, vCPUsInUse: 12, vCPUsPerTask: 2 } });
  });

  it('should return "SUCCESS" when "getAccountFargatevCPUDetails" returns correct vCPU usage when no clusters are running', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getSingleRegionalConf));

    // Hub describeTaskDefinition (once)
    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve({ clusterArns: [] }));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({ "us-east-1": { vCPULimit: 4000, vCPUsInUse: 0, vCPUsPerTask: 2 } });
  });

  it('should return "SUCCESS" when "getAccountFargatevCPUDetails" returns correct vCPU usage when no tests are running', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getSingleRegionalConf));

    // Hub describeTaskDefinition (once)
    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));

    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve(getRegionalClusters));

    mockEcs.mockImplementationOnce(() => Promise.resolve({ taskArns: [] }));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({ "us-east-1": { vCPULimit: 4000, vCPUsInUse: 0, vCPUsPerTask: 2 } });
  });

  it('should use hub task definition for vCPUsPerTask when regional stack has no task definition (thin spoke)', async () => {
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getTwoRegionalConfThinSpoke));

    // Hub describeTaskDefinition (once, from hub config)
    mockEcs.mockImplementationOnce(() => Promise.resolve(dltTaskDefinition1));

    // Per-region: ServiceQuotas + ECS for vCPUsInUse
    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));
    mockServiceQuotas.mockImplementationOnce(() => Promise.resolve(serviceQuotavCPULimit));

    mockEcs.mockImplementationOnce(() => Promise.resolve({ clusterArns: [] }));
    mockEcs.mockImplementationOnce(() => Promise.resolve({ clusterArns: [] }));

    const response = await lambda.getAccountFargatevCPUDetails();
    expect(response).toEqual({
      "us-east-1": { vCPULimit: 4000, vCPUsInUse: 0, vCPUsPerTask: 2 },
      "us-east-2": { vCPULimit: 4000, vCPUsInUse: 0, vCPUsPerTask: 2 },
    });
  });

  it('should return "SUCCESS" when "DELETETEST" returns success', async () => {
    getData.Item.status = "complete";
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
    getData.Item.status = "complete";
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
    getData.Item.status = "complete";
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

  it('should return "SUCCESS" when "DELETETEST" is called with empty ecsCloudWatchLogGroup (deleted regional stack)', async () => {
    getData.Item.status = "complete";
    // Simulate a deleted regional stack: the custom resource writes empty strings
    // to the DDB config entry when the regional stack is removed
    const deletedRegionalConf = {
      Item: {
        testId: "region-us-east-1",
        ecsCloudWatchLogGroup: "",
        taskCluster: "",
        taskDefinition: "",
        subnetB: "",
        region: "us-east-1",
        taskImage: "",
        subnetA: "",
        taskSecurityGroup: "",
      },
    };
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(deletedRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(historyEntries));
    mockDynamoDB.mockImplementation(() => Promise.resolve(noUnprocessedItems));
    mockCloudWatch.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve(rulesResponse));
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());

    const response = await lambda.deleteTest(testId, context.functionName);
    expect(response).toEqual("success");
    expect(mockCloudWatchLogs).not.toHaveBeenCalled();
  });

  it('should return "SUCCESS" when "DELETETEST" is called and the regional config entry no longer exists', async () => {
    getData.Item.status = "complete";
    // Simulate a fully removed regional stack: the "region-<region>" config entry is gone,
    // so getRegionInfraConfigs throws InvalidRegionRequest. Delete must still succeed.
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData)); // getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // getRegionInfraConfigs -> no Item
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve()); // deleteDDBTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(historyEntries));
    mockDynamoDB.mockImplementation(() => Promise.resolve(noUnprocessedItems));
    mockCloudWatch.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve(rulesResponse));
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve());
    mockLambda.mockImplementationOnce(() => Promise.resolve());

    const response = await lambda.deleteTest(testId, context.functionName);
    expect(response).toEqual("success");
  });

  it('should return "SUCCESS" when "GETTEST" is called and the regional config entry no longer exists', async () => {
    getData.Item.status = "complete";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData)); // getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // getRegionInfraConfigs -> no Item
    mockDynamoDB.mockImplementation(() => Promise.resolve(historyEntries)); // getTotalCount + history

    const response = await lambda.getTest(testId);
    expect(response.testName).toEqual("mytest");
  });

  it.each(["running", "cancelling", "provisioning", "cleaning up", "parsing results"])(
    'should return 409 CONFLICT when "DELETETEST" is called on a %s test',
    async (status) => {
      expect.assertions(2);
      getData.Item.status = status;
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));

      try {
        await lambda.deleteTest(testId, context.functionName);
      } catch (err) {
        expect(err.code).toEqual("TEST_RUNNING");
        expect(err.statusCode).toEqual(409);
      }
    }
  );

  it('should return "SUCCESS" when "CREATETEST" returns success', async () => {
    mockS3.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot
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

  describe("test asset validation", () => {
    it.each([
      ["jmeter", "script", "public/test-scenarios/jmeter/asset-test.jmx"],
      ["locust", "script", "public/test-scenarios/locust/asset-test.py"],
      ["jmeter", "zip", "public/test-scenarios/jmeter/asset-test.zip"],
      ["k6", "zip", "public/test-scenarios/k6/asset-test.zip"],
      ["locust", "zip", "public/test-scenarios/locust/asset-test.zip"],
    ])("checks the expected %s %s object", async (testType, fileType, expectedKey) => {
      mockS3.mockResolvedValueOnce({});

      await lambda.validateTestAssetExists(testType, fileType, "asset-test");

      expect(mockS3).toHaveBeenCalledWith({
        Bucket: "bucket",
        Key: expectedKey,
      });
    });

    it("checks k6 TypeScript before falling back to JavaScript", async () => {
      mockS3.mockRejectedValueOnce(s3NotFound()).mockResolvedValueOnce({});

      await lambda.validateTestAssetExists("k6", "script", "asset-test");

      expect(mockS3).toHaveBeenNthCalledWith(1, {
        Bucket: "bucket",
        Key: "public/test-scenarios/k6/asset-test.ts",
      });
      expect(mockS3).toHaveBeenNthCalledWith(2, {
        Bucket: "bucket",
        Key: "public/test-scenarios/k6/asset-test.js",
      });
    });

    it("returns TEST_ASSET_NOT_FOUND when every candidate is absent", async () => {
      mockS3.mockRejectedValue(s3NotFound());

      await expect(lambda.validateTestAssetExists("k6", "script", "missing-test")).rejects.toMatchObject({
        code: "TEST_ASSET_NOT_FOUND",
        statusCode: 400,
      });
      expect(mockS3).toHaveBeenCalledTimes(2);
    });

    it("returns TEST_ASSET_VALIDATION_FAILED for non-404 S3 failures", async () => {
      mockS3.mockRejectedValueOnce({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } });

      await expect(lambda.validateTestAssetExists("jmeter", "script", "asset-test")).rejects.toMatchObject({
        code: "TEST_ASSET_VALIDATION_FAILED",
        statusCode: 500,
      });
      expect(mockS3).toHaveBeenCalledTimes(1);
    });

    it("rejects fileType none for a script-based test without calling S3", async () => {
      await expect(lambda.validateTestAssetExists("locust", "none", "asset-test")).rejects.toMatchObject({
        code: "INVALID_FILE_TYPE",
        statusCode: 400,
      });
      expect(mockS3).not.toHaveBeenCalled();
    });

    it("skips S3 validation for simple tests", async () => {
      await lambda.validateTestAssetExists("simple", "none", "asset-test");
      expect(mockS3).not.toHaveBeenCalled();
    });

    it("defaults omitted fileType to script and fails create before downstream work when the asset is absent", async () => {
      config.testId = "missing-create";
      config.testType = "jmeter";
      mockS3.mockRejectedValueOnce(s3NotFound());

      await expect(lambda.createTest(config, context.functionName)).rejects.toMatchObject({
        code: "TEST_ASSET_NOT_FOUND",
        statusCode: 400,
      });
      expect(mockS3).toHaveBeenCalledWith({
        Bucket: "bucket",
        Key: "public/test-scenarios/jmeter/missing-create.jmx",
      });
      expect(mockDynamoDB).not.toHaveBeenCalled();
      expect(mockStepFunctions).not.toHaveBeenCalled();
    });

    it("fails scheduling before deleting or creating schedules when the required asset is absent", async () => {
      config.testId = "missing-schedule";
      config.testType = "locust";
      config.fileType = "script";
      config.scheduleStep = "create";
      config.recurrence = "daily";
      mockS3.mockRejectedValueOnce(s3NotFound());

      await expect(lambda.scheduleTest(eventInput(), context)).rejects.toMatchObject({
        code: "TEST_ASSET_NOT_FOUND",
        statusCode: 400,
      });
      expect(mockScheduler).not.toHaveBeenCalled();
      expect(mockCloudWatchEvents).not.toHaveBeenCalled();
      expect(mockDynamoDB).not.toHaveBeenCalled();
    });
  });

  describe("native mode", () => {
    // Mock order matches createTest: scenario read, then the regional config
    // lookups, then the final update.
    const primeCreateTestMocks = () => {
      mockS3.mockImplementation(() => Promise.resolve());
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
      mockStepFunctions.mockImplementation(() => Promise.resolve());
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(updateData));
    };

    const stepFunctionInput = () => JSON.parse(mockStepFunctions.mock.calls[0][0].input);

    it("sends the native fields to the step function", async () => {
      primeCreateTestMocks();
      config.nativeRunMode = {
        maxTestDurationSeconds: 3600,
      };

      await lambda.createTest(config, context.functionName);

      const input = stepFunctionInput();
      expect(input.nativeRunMode).toEqual(config.nativeRunMode);
      expect(input.runMode).toBe("native");
    });

    it("keeps testDuration as ramp-up plus hold-for for a native test", async () => {
      primeCreateTestMocks();
      config.nativeRunMode = { maxTestDurationSeconds: 7200 };

      await lambda.createTest(config, context.functionName);

      const input = stepFunctionInput();
      expect(input.nativeRunMode.maxTestDurationSeconds).toBe(7200);
      expect(input.testDuration).not.toBe(7200);
    });

    it("sends null nativeRunMode on a legacy test", async () => {
      primeCreateTestMocks();

      await lambda.createTest(config, context.functionName);

      const input = stepFunctionInput();
      expect(input.nativeRunMode).toBeNull();
      expect(input.runMode).toBe("standard");
    });

    it("passes the hub's native task definitions through", async () => {
      primeCreateTestMocks();
      config.nativeRunMode = { maxTestDurationSeconds: 60 };

      await lambda.createTest(config, context.functionName);

      expect(stepFunctionInput().nativeTaskDefinitions).toEqual(nativeTaskDefinitions);
    });

    it("persists nativeRunMode as one object", async () => {
      primeCreateTestMocks();
      config.testType = "k6";
      config.nativeRunMode = {
        maxTestDurationSeconds: 1800,
      };

      await lambda.createTest(config, context.functionName);

      const updateCall = mockDynamoDB.mock.calls
        .map(([params]) => params)
        .find((params) => params?.UpdateExpression?.startsWith("set #n = :n"));
      expect(updateCall.UpdateExpression).toContain("#nrm = :nrm");
      expect(updateCall.ExpressionAttributeNames["#nrm"]).toBe("nativeRunMode");
      expect(updateCall.ExpressionAttributeValues[":nrm"]).toEqual(config.nativeRunMode);
    });

    it("removes nativeRunMode from a legacy scenario", async () => {
      primeCreateTestMocks();

      await lambda.createTest(config, context.functionName);

      const updateCall = mockDynamoDB.mock.calls
        .map(([params]) => params)
        .find((params) => params?.UpdateExpression?.startsWith("set #n = :n"));
      expect(updateCall.UpdateExpression).toContain("remove #nrm");
      expect(updateCall.ExpressionAttributeNames["#nrm"]).toBe("nativeRunMode");
      expect(updateCall.ExpressionAttributeValues[":nrm"]).toBeUndefined();
    });

    it("persists nativeRunMode without overrides when the script decides its own load", async () => {
      primeCreateTestMocks();
      config.nativeRunMode = { maxTestDurationSeconds: 60 };

      await lambda.createTest(config, context.functionName);

      const updateCall = mockDynamoDB.mock.calls
        .map(([params]) => params)
        .find((params) => params?.UpdateExpression?.startsWith("set #n = :n"));
      expect(updateCall.ExpressionAttributeValues[":nrm"]).toEqual({ maxTestDurationSeconds: 60 });
    });
  });

  // Taurus' k6 executor renders the hold stage as (hold-for - ramp-up), so the
  // scenario file it reads carries ramp-up + hold-for as its hold-for. Nothing
  // else may see that adjusted value.
  // https://github.com/Blazemeter/taurus/blob/1.17.1/bzt/modules/k6.py#L57
  describe("k6 ramp-up compensation", () => {
    // Mock order matches createTest: scenario read, then the regional config
    // lookups, then the final update.
    const primeCreateTestMocks = () => {
      mockS3.mockImplementation(() => Promise.resolve());
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
      mockStepFunctions.mockImplementation(() => Promise.resolve());
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(updateData));
    };

    const scenarioFilesWritten = () =>
      mockS3.mock.calls.map(([params]) => params).filter((params) => params?.Key?.startsWith("test-scenarios/"));

    const scenarioFileFor = (region) =>
      JSON.parse(scenarioFilesWritten().find((params) => params.Key.endsWith(`-${region}.json`)).Body);

    const storedScenario = () => {
      const updateCall = mockDynamoDB.mock.calls
        .map(([params]) => params)
        .find((params) => params?.ExpressionAttributeNames?.["#t"] === "testScenario");
      return JSON.parse(updateCall.ExpressionAttributeValues[":t"]);
    };

    const stepFunctionInput = () => JSON.parse(mockStepFunctions.mock.calls[0][0].input);

    beforeEach(() => {
      config.testType = "k6";
      config.testScenario.execution[0].executor = "k6";
    });

    it("sends ramp-up plus hold-for as the hold-for Taurus reads", async () => {
      primeCreateTestMocks();

      await lambda.createTest(config, context.functionName);

      // ramp-up 30s + hold-for 1m, so Taurus renders --stage 30s:C --stage 60s:C
      // for a 90 second run instead of collapsing it to 60.
      expect(scenarioFilesWritten()).toHaveLength(2);
      for (const params of scenarioFilesWritten()) {
        const execution = JSON.parse(params.Body).execution[0];
        expect(execution["hold-for"]).toBe("90s");
        expect(execution["ramp-up"]).toBe("30s");
      }
    });

    it("keeps the customer's hold-for out of the stored scenario and the step function duration", async () => {
      primeCreateTestMocks();

      await lambda.createTest(config, context.functionName);

      expect(storedScenario().execution[0]["hold-for"]).toBe("1m");
      expect(storedScenario().execution[0]["ramp-up"]).toBe("30s");
      expect(stepFunctionInput().testDuration).toBe(90);
    });

    it("keeps a longer ramp-up than hold-for off the negative stage duration", async () => {
      primeCreateTestMocks();
      config.testScenario.execution[0]["ramp-up"] = "2m";

      await lambda.createTest(config, context.functionName);

      // Taurus would otherwise emit --stage -60s:C and k6 would refuse to start.
      expect(scenarioFileFor("us-east-1").execution[0]["hold-for"]).toBe("180s");
    });

    it("keeps each region's own task count and concurrency", async () => {
      primeCreateTestMocks();
      config.testTaskConfigs[0].taskCount = "3";
      config.testTaskConfigs[1].taskCount = "7";

      await lambda.createTest(config, context.functionName);

      expect(scenarioFileFor("us-east-1").execution[0].taskCount).toBe(3);
      expect(scenarioFileFor("eu-west-1").execution[0].taskCount).toBe(7);
      expect(scenarioFileFor("us-east-1").execution[0].concurrency).toBe(5);
    });

    it("leaves the scenario alone when ramp-up is zero", async () => {
      primeCreateTestMocks();
      config.testScenario.execution[0]["ramp-up"] = "0s";

      await lambda.createTest(config, context.functionName);

      // Taurus takes its --vus/--duration path here, which already honours hold-for.
      expect(scenarioFileFor("us-east-1").execution[0]["hold-for"]).toBe("1m");
    });

    it.each(["jmeter", "locust"])("leaves a %s scenario alone", async (executor) => {
      primeCreateTestMocks();
      config.testType = executor;
      config.testScenario.execution[0].executor = executor;

      await lambda.createTest(config, context.functionName);

      expect(scenarioFileFor("us-east-1").execution[0]["hold-for"]).toBe("1m");
    });

    it("leaves a scenario without an executor alone", async () => {
      primeCreateTestMocks();
      delete config.testScenario.execution[0].executor;

      await lambda.createTest(config, context.functionName);

      // Taurus falls back to its default executor, JMeter, which handles ramp-up.
      expect(scenarioFileFor("us-east-1").execution[0]["hold-for"]).toBe("1m");
    });

    it("leaves a native mode k6 scenario alone", async () => {
      primeCreateTestMocks();
      config.nativeRunMode = {
        maxTestDurationSeconds: 3600,
      };

      await lambda.createTest(config, context.functionName);

      // The native runner downloads this same object and already sums the
      // stages itself, so compensating would count the ramp-up twice.
      for (const params of scenarioFilesWritten()) {
        expect(JSON.parse(params.Body).execution[0]["hold-for"]).toBe("1m");
      }
    });

    it("leaves the scenario alone for durations the seconds parser cannot read", async () => {
      // h and d suffixes pass API validation but already fail createTest's own
      // testDuration calculation, which is a separate pre-existing bug.
      // Compensation must not add an earlier failure of its own.
      primeCreateTestMocks();
      config.testScenario.execution[0]["hold-for"] = "2h";

      await expect(lambda.createTest(config, context.functionName)).rejects.toThrow();

      expect(scenarioFileFor("us-east-1").execution[0]["hold-for"]).toBe("2h");
    });
  });

  it("should use the right nextRun value for manually triggered recurring tests", async () => {
    config.recurrence = "daily";
    getData.Item.nextRun = "2017-04-23 02:28:37";
    mockS3.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot
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
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
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
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(updateData));

    const response = await lambda.createTest(config, context.functionName);
    expect(response.testStatus).toEqual("running");
  });

  it("should return SUCCESS for eventBridge triggered test with cronValue", async () => {
    config.eventBridge = "true";
    config.cronValue = "0 0 * * *";

    mockS3.mockImplementation(() => Promise.resolve());
    mockStepFunctions.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(updateData));

    const response = await lambda.createTest(config, context.functionName);
    expect(response.testStatus).toEqual("running");
  });

  it('should record proper date when "CREATETEST" with weekly recurrence', async () => {
    config.recurrence = "weekly";
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot
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
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot
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
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot
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
    // Only an active run can be cancelled; origData is terminal ("complete").
    getData.Item.status = "running";
    // getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    // getTestAndRegionConfigs (getTestEntry + getRegionConfigs)
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    // tryTransitionToCancelling (atomic conditional write; succeeds for an active run)
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve());
    // describeServiceTaskCounts (ECS describeServices)
    mockEcs.mockImplementationOnce(() => Promise.resolve({ services: [{ runningCount: 1, pendingCount: 0, desiredCount: 1 }] }));
    // lambda.invoke (task canceler)
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    // s3.listObjectsV2 (check for partial results)
    mockS3.mockImplementationOnce(() => Promise.resolve({ Contents: [] }));

    const response = await lambda.cancelTest(testId);
    expect(response).toEqual(expect.objectContaining({ status: "test cancelling" }));
    expect(mockLambda).toHaveBeenCalledWith(
      expect.objectContaining({
        Payload: JSON.stringify({ testId: testId }),
      })
    );
  });

  it('should return 409 CONFLICT when "CANCELTEST" is called on a run that is not active', async () => {
    // The atomic transition to "cancelling" is gated on the run being active.
    // When it is not (a terminal run, or a run that went terminal mid-cancel),
    // the conditional write fails and cancelTest must surface 409 without
    // invoking the canceler — otherwise the scenario status would be rewritten
    // while the run/history record keeps its true outcome.
    const { ConditionalCheckFailedException } = jest.requireActual("@aws-sdk/client-dynamodb");
    // getTestEntry
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    // getRegionInfraConfigs (per region)
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    // tryTransitionToCancelling: conditional write fails (run not active)
    mockDynamoDB.mockImplementationOnce(() =>
      Promise.reject(new ConditionalCheckFailedException({ message: "conditional request failed", $metadata: {} }))
    );

    await expect(lambda.cancelTest(testId)).rejects.toMatchObject({
      code: "TEST_NOT_ACTIVE",
      statusCode: 409,
    });

    // The cancel flow must not proceed: the canceler is never invoked.
    expect(mockLambda).not.toHaveBeenCalled();
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

    const updateCall = mockDynamoDB.mock.calls
      .map(([params]) => params)
      .find((params) => params?.UpdateExpression?.startsWith("set #n = :n"));
    expect(updateCall.UpdateExpression).toContain("remove #nrm");
  });

  it('should preserve nativeRunMode when "SCHEDULETEST" creates a schedule', async () => {
    config.scheduleStep = "create";
    config.recurrence = "daily";
    config.testType = "k6";
    config.nativeRunMode = {
      maxTestDurationSeconds: 3600,
    };

    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve({ Rules: [] }));
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve(rulesResponse));
    mockLambda.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementationOnce(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      const scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    await lambda.scheduleTest(eventInput(), context);

    const scheduleCall = mockScheduler.mock.calls.at(-1)[0];
    const scheduledEvent = JSON.parse(scheduleCall.Target.Input);
    expect(JSON.parse(scheduledEvent.body).nativeRunMode).toEqual(config.nativeRunMode);

    const updateCall = mockDynamoDB.mock.calls
      .map(([params]) => params)
      .find((params) => params?.UpdateExpression?.startsWith("set #n = :n"));
    expect(updateCall.ExpressionAttributeValues[":nrm"]).toEqual(config.nativeRunMode);
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

  it('should return SUCCESS and delete past eventbridge rules when "SCHEDULETEST" runs with a testId', async () => {
    config.testId = "test-id";
    config.scheduleStep = "start";
    config.recurrence = "daily";

    // deleteSchedules (scheduler.getSchedule + scheduler.deleteSchedule)
    mockScheduler.mockImplementation(() => Promise.resolve());
    // deleteRules: legacy CloudWatch Events cleanup
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve({ Rules: [] }));
    mockLambda.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    await lambda.scheduleTest(eventInput(), context);
    expect(mockScheduler).toHaveBeenCalledWith(
      expect.objectContaining({
        ScheduleExpression: "rate(1 day)",
      })
    );
  });

  it('should return SUCCESS and record proper next weekly run when "SCHEDULETEST" returns success withe scheduleStep is start and recurrence exists', async () => {
    config.scheduleStep = "start";
    config.recurrence = "weekly";

    mockScheduler.mockImplementation(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve({ Rules: [] }));
    mockLambda.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    await lambda.scheduleTest(eventInput(), context);
    expect(mockScheduler).toHaveBeenCalledWith(
      expect.objectContaining({
        ScheduleExpression: "rate(7 days)",
      })
    );
  });

  it('should return SUCCESS and record proper next daily run when "SCHEDULETEST" returns success when scheduleStep is start and recurrence exists', async () => {
    config.scheduleStep = "start";
    config.recurrence = "daily";

    mockScheduler.mockImplementation(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve({ Rules: [] }));
    mockLambda.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    await lambda.scheduleTest(eventInput(), context);
    expect(mockScheduler).toHaveBeenCalledWith(
      expect.objectContaining({
        ScheduleExpression: "rate(1 day)",
      })
    );
  });

  it('should return SUCCESS and record proper next weekly run when "SCHEDULETEST" returns success withe scheduleStep is start and recurrence exists', async () => {
    config.scheduleStep = "start";
    config.recurrence = "weekly";

    mockScheduler.mockImplementation(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve({ Rules: [] }));
    mockLambda.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    await lambda.scheduleTest(eventInput(), context);
    expect(mockScheduler).toHaveBeenCalledWith(
      expect.objectContaining({
        ScheduleExpression: "rate(7 days)",
      })
    );
  });

  it('should return SUCCESS and record proper next weekly run when "SCHEDULETEST" returns success with scheduleStep is start and cronValue exists', async () => {
    config.scheduleStep = "start";
    config.recurrence = "";
    config.cronValue = "0 0 * * *";

    mockScheduler.mockImplementation(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve({ Rules: [] }));
    mockLambda.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    await lambda.scheduleTest(eventInput(), context);
    expect(mockScheduler).toHaveBeenCalledWith(
      expect.objectContaining({
        ScheduleExpression: expect.stringContaining("cron(0 0 *"),
      })
    );
  });

  it('should return SUCCESS and record proper next biweekly run when "SCHEDULETEST" returns success withe scheduleStep is start and recurrence exists', async () => {
    config.scheduleStep = "start";
    config.recurrence = "biweekly";

    mockScheduler.mockImplementation(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve({ Rules: [] }));
    mockLambda.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    await lambda.scheduleTest(eventInput(), context);
    expect(mockScheduler).toHaveBeenCalledWith(
      expect.objectContaining({
        ScheduleExpression: "rate(14 days)",
      })
    );
  });

  it('should return SUCCESS and record proper next monthly run when "SCHEDULETEST" returns success and scheduleStep is start and recurrence exists', async () => {
    config.scheduleStep = "start";
    config.recurrence = "monthly";

    mockScheduler.mockImplementation(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve({ Rules: [] }));
    mockLambda.mockImplementation(() => Promise.resolve());
    mockDynamoDB.mockImplementation(() => {
      let scheduleData = updateData;
      scheduleData.Attributes.testStatus = "scheduled";
      return Promise.resolve(scheduleData);
    });

    await lambda.scheduleTest(eventInput(), context);
    expect(mockScheduler).toHaveBeenCalledWith(
      expect.objectContaining({
        ScheduleExpression: "cron(30 12 28 * ? *)",
      })
    );
  });

  it('should return SUCCESS, and records proper nextRun when "SCHEDULETEST" returns success withe scheduleStep is start and no recurrence', async () => {
    config.scheduleStep = "start";

    mockScheduler.mockImplementation(() => Promise.resolve());
    mockCloudWatchEvents.mockImplementation(() => Promise.resolve({ Rules: [] }));
    mockLambda.mockImplementation(() => Promise.resolve());
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
    expect(mockScheduler).toHaveBeenCalledWith(
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
          Outputs: [
            { OutputKey: "SolutionUUID", OutputValue: "abc-uuid-123" },
            { OutputKey: "SolutionTemplate", OutputValue: "cloudfront" },
          ],
        },
      ],
    };
    mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackResponse));

    const response = await lambda.getStackInfo();
    expect(response).toEqual({
      account_id: "123456789012",
      created_time: "2025-09-09T19:40:22.000Z",
      deployment_id: "abc-uuid-123",
      deployment_method: "cloudformation",
      mcp_endpoint: undefined,
      region: "us-west-2",
      version: "v4.0.1",
      stack_id: "arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/12345",
      solution_template: "cloudfront",
      latest_version: "9.9.9",
      is_update_available: true,
    });
  });

  it('should return "SUCCESS" with unknown version when no SolutionVersion tag exists', async () => {
    const mockStackResponse = {
      Stacks: [
        {
          CreationTime: new Date("2025-09-09T19:40:22Z"),
          StackId: "arn:aws:cloudformation:eu-west-1:123456789012:stack/test-stack/12345",
          Tags: [{ Key: "OtherTag", Value: "value" }],
          Outputs: [{ OutputKey: "SolutionTemplate", OutputValue: "cloudfront" }],
        },
      ],
    };
    mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackResponse));

    const response = await lambda.getStackInfo();
    expect(response.version).toEqual("unknown");
    expect(response.deployment_method).toEqual("cloudformation");
  });

  it("should extract version from stack description when no SolutionVersion tag exists", async () => {
    const mockStackResponse = {
      Stacks: [
        {
          CreationTime: new Date("2025-09-09T19:40:22Z"),
          StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/12345",
          Description: "Distributed Load Testing Solution v4.0.1 - Creates infrastructure for load testing",
          Tags: [{ Key: "OtherTag", Value: "value" }],
          Outputs: [{ OutputKey: "SolutionTemplate", OutputValue: "cloudfront" }],
        },
      ],
    };
    mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackResponse));

    const response = await lambda.getStackInfo();
    expect(response).toEqual({
      account_id: "123456789012",
      created_time: "2025-09-09T19:40:22.000Z",
      deployment_id: undefined,
      deployment_method: "cloudformation",
      mcp_endpoint: undefined,
      region: "us-east-1",
      version: "v4.0.1",
      stack_id: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/12345",
      solution_template: "cloudfront",
      latest_version: "9.9.9",
      is_update_available: true,
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
          Outputs: [{ OutputKey: "SolutionTemplate", OutputValue: "cloudfront" }],
        },
      ],
    };
    mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackResponse));

    const response = await lambda.getStackInfo();
    expect(response.version).toEqual("unknown");
    expect(response.deployment_method).toEqual("cloudformation");
  });

  it("should detect launch-wizard deployment method from LaunchWizardResourceGroupID tag", async () => {
    const mockStackResponse = {
      Stacks: [
        {
          CreationTime: new Date("2025-09-09T19:40:22Z"),
          StackId: "arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/12345",
          Tags: [
            { Key: "SolutionVersion", Value: "v4.1.0" },
            { Key: "LaunchWizardResourceGroupID", Value: "some-group-id" },
          ],
          Outputs: [{ OutputKey: "SolutionTemplate", OutputValue: "cloudfront" }],
        },
      ],
    };
    mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackResponse));

    const response = await lambda.getStackInfo();
    expect(response.deployment_method).toEqual("launch-wizard");
  });

  it("should return solution_template from the SolutionTemplate stack output", async () => {
    const mockStackResponse = {
      Stacks: [
        {
          CreationTime: new Date("2025-09-09T19:40:22Z"),
          StackId: "arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/12345",
          Tags: [{ Key: "SolutionVersion", Value: "v4.1.0" }],
          Outputs: [{ OutputKey: "SolutionTemplate", OutputValue: "alb-ecs" }],
        },
      ],
    };
    mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackResponse));

    const response = await lambda.getStackInfo();
    expect(response.solution_template).toEqual("alb-ecs");
  });

  it("should throw INTERNAL_SERVER_ERROR when SolutionTemplate output is missing", async () => {
    const mockStackResponse = {
      Stacks: [
        {
          CreationTime: new Date("2025-09-09T19:40:22Z"),
          StackId: "arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/12345",
          Tags: [{ Key: "SolutionVersion", Value: "v4.1.0" }],
          Outputs: [],
        },
      ],
    };
    mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackResponse));

    await expect(lambda.getStackInfo()).rejects.toMatchObject({
      code: "MISSING_SOLUTION_TEMPLATE_OUTPUT",
      statusCode: 500,
    });
  });

  it("should return latest_version undefined and is_update_available false when RSS fetch fails", async () => {
    const mockStackResponse = {
      Stacks: [
        {
          CreationTime: new Date("2025-09-09T19:40:22Z"),
          StackId: "arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/12345",
          Tags: [{ Key: "SolutionVersion", Value: "v4.0.1" }],
          Outputs: [{ OutputKey: "SolutionTemplate", OutputValue: "cloudfront" }],
        },
      ],
    };
    mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackResponse));
    mockGetLatestVersionFromRss.mockResolvedValue(undefined);

    const response = await lambda.getStackInfo();
    expect(response.latest_version).toBeUndefined();
    expect(response.is_update_available).toBe(false);
    expect(response.version).toEqual("v4.0.1");
  });

  it("should return is_update_available false when current version suffix matches the latest base version", async () => {
    const mockStackResponse = {
      Stacks: [
        {
          CreationTime: new Date("2025-09-09T19:40:22Z"),
          StackId: "arn:aws:cloudformation:us-west-2:123456789012:stack/test-stack/12345",
          Tags: [{ Key: "SolutionVersion", Value: "v4.1.0-ITL" }],
          Outputs: [{ OutputKey: "SolutionTemplate", OutputValue: "cloudfront" }],
        },
      ],
    };
    mockCloudFormation.mockImplementation(() => Promise.resolve(mockStackResponse));
    mockGetLatestVersionFromRss.mockResolvedValue("4.1.0");

    const response = await lambda.getStackInfo();
    expect(response.latest_version).toEqual("4.1.0");
    expect(response.is_update_available).toBe(false);
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

  it('should default totalTestRuns to 0 when not present on item', async () => {
    const listDataNoCount = { Items: [{ testId: "1234" }, { testId: "5678" }] };
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(listDataNoCount));
    const response = await lambda.listTests();
    expect(response.Items[0].totalTestRuns).toEqual(0);
    expect(response.Items[1].totalTestRuns).toEqual(0);
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
    getData.Item.status = "complete";
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
    getData.Item.status = "complete";
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
    getData.Item.status = "complete";
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
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getData));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getRegionalConf2));
    mockStepFunctions.mockImplementation(() => Promise.reject("STEP FUNCTIONS ERROR"));
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
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
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
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
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
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
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
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
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
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // claimRunSlot
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

it('should return "TEST_NOT_FOUND" when record fails schema validation (missing testTaskConfigs)', async () => {
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getDataWithNoConfigs));

  await expect(lambda.getTest(testId)).rejects.toMatchObject({
    code: "TEST_NOT_FOUND",
  });
});

it('should return "TEST_NOT_FOUND" when record fails schema validation (invalid testTaskConfigs)', async () => {
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getDataWithEmptyConfigs));

  await expect(lambda.getTest(testId)).rejects.toMatchObject({
    code: "TEST_NOT_FOUND",
  });
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
  mockDynamoDB.mockImplementationOnce(() => Promise.resolve(getAllRegionalConfs));
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
      testType: "simple",
      status: "complete",
      testScenario: '{"name":"example"}',
      testTaskConfigs: [{ region: "us-east-1", taskCount: "1", concurrency: "1" }],
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

  it('should return "BASELINE_CONFLICT" when attempting to delete the baseline test run', async () => {
    const testDataWithBaseline = {
      Item: {
        testId: "1234",
        testName: "mytest",
        testType: "simple",
        status: "complete",
        testScenario: '{"name":"example"}',
        testTaskConfigs: [{ region: "us-east-1", taskCount: "1", concurrency: "1" }],
        baselineId: "run-002",
      },
    };

    // Mock getTestEntry returning a test with a baseline set
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testDataWithBaseline));

    await expect(
      lambda.deleteTestRuns("1234", ["run-001", "run-002", "run-003"])
    ).rejects.toMatchObject({
      code: "BASELINE_CONFLICT",
      statusCode: 409,
      message: expect.stringContaining("run-002"),
    });
  });

  it('should allow deletion when baseline is set but not included in testRunIds', async () => {
    const testDataWithBaseline = {
      Item: {
        testId: "1234",
        testName: "mytest",
        testType: "simple",
        status: "complete",
        testScenario: '{"name":"example"}',
        testTaskConfigs: [{ region: "us-east-1", taskCount: "1", concurrency: "1" }],
        baselineId: "run-baseline",
      },
    };

    // Mock getTestEntry returning a test with a baseline set
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testDataWithBaseline));

    // Mock get calls for validating test runs exist
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-001" } }));
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-002" } }));

    // Mock successful batch delete
    mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ UnprocessedItems: {} }));

    const response = await lambda.deleteTestRuns("1234", ["run-001", "run-002"]);
    expect(response.deletedCount).toEqual(2);
  });

  describe("scenario reconciliation after deletion", () => {
    beforeEach(() => {
      mockDynamoDB.mockReset();
    });

    const queueDeletionMocks = (testEntryData) => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(testEntryData)); // getTestEntry
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: { testId: "1234", testRunId: "run-001" } })); // validate run
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ UnprocessedItems: {} })); // batch delete
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // decrementTestRunCount
    };

    it("should update the scenario record to reflect the most recent remaining run", async () => {
      queueDeletionMocks(testData);
      // GSI Query returns the latest surviving summary (sorted desc by startTime, Limit = deletedCount + 1)
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Items: [
            {
              testRunId: "run-new",
              status: "cancelled",
              startTime: "2024-02-01 10:00:00",
              endTime: "2024-02-01 10:02:00",
              results: { total: { avg_rt: "0.5" } },
            },
          ],
        })
      );
      // GetItem on base table returns the full run (adds completeTasks not in GSI projection)
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Item: {
            testRunId: "run-new",
            status: "cancelled",
            startTime: "2024-02-01 10:00:00",
            endTime: "2024-02-01 10:02:00",
            results: { total: { avg_rt: "0.5" } },
            completeTasks: { "us-east-1": 2 },
          },
        })
      );
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // reconcile update

      const response = await lambda.deleteTestRuns("1234", ["run-001"]);
      expect(response.deletedCount).toEqual(1);

      const gsiQueryParams = mockDynamoDB.mock.calls[mockDynamoDB.mock.calls.length - 3][0];
      expect(gsiQueryParams.IndexName).toBeDefined();
      expect(gsiQueryParams.ScanIndexForward).toEqual(false);
      expect(gsiQueryParams.Limit).toEqual(2); // deletedIds.length (1) + 1

      const getParams = mockDynamoDB.mock.calls[mockDynamoDB.mock.calls.length - 2][0];
      expect(getParams.Key).toEqual({ testId: "1234", testRunId: "run-new" });

      const updateParams = mockDynamoDB.mock.calls[mockDynamoDB.mock.calls.length - 1][0];
      expect(updateParams.Key).toEqual({ testId: "1234" });
      expect(updateParams.ExpressionAttributeValues).toEqual({
        ":s": "cancelled",
        ":st": "2024-02-01 10:00:00",
        ":et": "2024-02-01 10:02:00",
        ":r": { total: { avg_rt: "0.5" } },
        ":ct": { "us-east-1": 2 },
        ":zero": 0,
      });
      expect(updateParams.UpdateExpression).toContain("taskFailureCount = :zero");
      expect(updateParams.UpdateExpression).toContain("remove errorReason");
    });

    it("should skip the reconcile update when the most recent remaining run is the one the scenario already reflects", async () => {
      const currentStartTime = "2024-07-01 10:00:00";
      const scenarioAlreadyOnLatest = {
        Item: { ...testData.Item, startTime: currentStartTime },
      };
      queueDeletionMocks(scenarioAlreadyOnLatest);
      // GSI Query returns the same run the scenario already reflects (an older run was deleted)
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Items: [
            {
              testRunId: "run-current",
              status: "complete",
              startTime: currentStartTime,
              endTime: "2024-07-01 10:05:00",
              results: { total: { avg_rt: "0.4" } },
            },
          ],
        })
      );

      const response = await lambda.deleteTestRuns("1234", ["run-001"]);
      expect(response.deletedCount).toEqual(1);

      // Only the 4 deletion mocks + the GSI Query should have fired — no GetItem, no scenario update.
      // Critically, taskFailureCount on the scenario is NOT rewritten to 0 for the still-displayed run.
      expect(mockDynamoDB).toHaveBeenCalledTimes(5);
    });

    it("should filter out just-deleted testRunIds returned by a stale GSI read", async () => {
      queueDeletionMocks(testData);
      // GSI stale-reads and returns the just-deleted run alongside the real survivor
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Items: [
            { testRunId: "run-001", status: "cancelled", startTime: "2024-06-01 10:00:00" }, // ghost
            {
              testRunId: "run-survivor",
              status: "complete",
              startTime: "2024-05-01 10:00:00",
              endTime: "2024-05-01 10:05:00",
              results: { total: { avg_rt: "0.3" } },
            },
          ],
        })
      ); // GSI Query
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Item: {
            testRunId: "run-survivor",
            status: "complete",
            startTime: "2024-05-01 10:00:00",
            endTime: "2024-05-01 10:05:00",
            results: { total: { avg_rt: "0.3" } },
            completeTasks: { "us-east-1": 1 },
          },
        })
      ); // GetItem
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // reconcile update

      const response = await lambda.deleteTestRuns("1234", ["run-001"]);
      expect(response.deletedCount).toEqual(1);

      const getParams = mockDynamoDB.mock.calls[mockDynamoDB.mock.calls.length - 2][0];
      expect(getParams.Key).toEqual({ testId: "1234", testRunId: "run-survivor" }); // ghost skipped

      const updateParams = mockDynamoDB.mock.calls[mockDynamoDB.mock.calls.length - 1][0];
      expect(updateParams.ExpressionAttributeValues[":s"]).toEqual("complete");
      expect(updateParams.ExpressionAttributeValues[":st"]).toEqual("2024-05-01 10:00:00");
    });

    it("should treat a GSI query response with no Items field as no runs remaining", async () => {
      queueDeletionMocks(testData);
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // GSI Query - no Items field at all
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // reconcile update

      const response = await lambda.deleteTestRuns("1234", ["run-001"]);
      expect(response.deletedCount).toEqual(1);

      const updateParams = mockDynamoDB.mock.calls[mockDynamoDB.mock.calls.length - 1][0];
      expect(updateParams.ExpressionAttributeValues[":s"]).toEqual("created");
    });

    it("should treat a stale GSI read that only returns just-deleted runs as no runs remaining", async () => {
      queueDeletionMocks(testData);
      // GSI stale-reads and only returns the ghost of the just-deleted run
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Items: [{ testRunId: "run-001", status: "cancelled", startTime: "2024-06-01 10:00:00" }],
        })
      ); // GSI Query
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // reconcile update

      const response = await lambda.deleteTestRuns("1234", ["run-001"]);
      expect(response.deletedCount).toEqual(1);

      // Should go to the empty branch and reset the scenario, not sync to the ghost
      const updateParams = mockDynamoDB.mock.calls[mockDynamoDB.mock.calls.length - 1][0];
      expect(updateParams.ExpressionAttributeValues).toEqual({
        ":s": "created",
        ":st": "",
        ":et": "",
        ":r": {},
        ":zero": 0,
      });
    });

    it("should carry over errorReason when the most recent remaining run failed", async () => {
      queueDeletionMocks(testData);
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Items: [
            {
              testRunId: "run-failed",
              status: "failed",
              startTime: "2024-03-01 10:00:00",
              endTime: "2024-03-01 10:01:00",
              results: {},
            },
          ],
        })
      ); // GSI Query
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Item: {
            testRunId: "run-failed",
            status: "failed",
            startTime: "2024-03-01 10:00:00",
            endTime: "2024-03-01 10:01:00",
            results: {},
            completeTasks: { "us-east-1": 0 },
            errorReason: "Task failure threshold breached: 1/1 tasks failed",
          },
        })
      ); // GetItem
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // reconcile update

      const response = await lambda.deleteTestRuns("1234", ["run-001"]);
      expect(response.deletedCount).toEqual(1);

      const updateParams = mockDynamoDB.mock.calls[mockDynamoDB.mock.calls.length - 1][0];
      expect(updateParams.ExpressionAttributeValues[":s"]).toEqual("failed");
      expect(updateParams.ExpressionAttributeValues[":e"]).toEqual(
        "Task failure threshold breached: 1/1 tasks failed"
      );
      expect(updateParams.ExpressionAttributeValues[":zero"]).toEqual(0);
      expect(updateParams.UpdateExpression).not.toContain("remove");
    });

    it("should handle a most recent remaining run with missing optional fields", async () => {
      queueDeletionMocks(testData);
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Items: [{ testRunId: "run-sparse", status: "cancelled" }],
        })
      ); // GSI Query
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({ Item: { testRunId: "run-sparse", status: "cancelled" } })
      ); // GetItem
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // reconcile update

      const response = await lambda.deleteTestRuns("1234", ["run-001"]);
      expect(response.deletedCount).toEqual(1);

      const updateParams = mockDynamoDB.mock.calls[mockDynamoDB.mock.calls.length - 1][0];
      expect(updateParams.ExpressionAttributeValues).toEqual({
        ":s": "cancelled",
        ":st": "",
        ":et": "",
        ":r": {},
        ":zero": 0,
      });
      expect(updateParams.UpdateExpression).toContain("remove completeTasks, errorReason");
    });

    it("should fall back to the GSI summary when the base-table GetItem returns nothing", async () => {
      queueDeletionMocks(testData);
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({
          Items: [
            {
              testRunId: "run-only-in-gsi",
              status: "complete",
              startTime: "2024-05-01 10:00:00",
              endTime: "2024-05-01 10:05:00",
              results: { total: { avg_rt: "0.4" } },
            },
          ],
        })
      ); // GSI Query
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // GetItem returns no Item
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // reconcile update

      const response = await lambda.deleteTestRuns("1234", ["run-001"]);
      expect(response.deletedCount).toEqual(1);

      const updateParams = mockDynamoDB.mock.calls[mockDynamoDB.mock.calls.length - 1][0];
      expect(updateParams.ExpressionAttributeValues[":s"]).toEqual("complete");
      expect(updateParams.ExpressionAttributeValues[":st"]).toEqual("2024-05-01 10:00:00");
      expect(updateParams.ExpressionAttributeValues[":zero"]).toEqual(0);
      expect(updateParams.UpdateExpression).toContain("remove completeTasks, errorReason");
    });

    it("should reset the scenario to 'created' when the last run is deleted", async () => {
      queueDeletionMocks(testData);
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Items: [] })); // GSI Query - no remaining runs
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // reconcile update

      const response = await lambda.deleteTestRuns("1234", ["run-001"]);
      expect(response.deletedCount).toEqual(1);

      const updateParams = mockDynamoDB.mock.calls[mockDynamoDB.mock.calls.length - 1][0];
      expect(updateParams.ExpressionAttributeValues).toEqual({
        ":s": "created",
        ":st": "",
        ":et": "",
        ":r": {},
        ":zero": 0,
      });
      expect(updateParams.UpdateExpression).toContain("remove completeTasks, errorReason");
    });

    it("should reset the scenario to 'scheduled' when the last run is deleted and a schedule is active", async () => {
      const scheduledTestData = {
        Item: { ...testData.Item, nextRun: "2026-08-01 10:00:00" },
      };
      queueDeletionMocks(scheduledTestData);
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Items: [] })); // GSI Query - no remaining runs
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({})); // reconcile update

      const response = await lambda.deleteTestRuns("1234", ["run-001"]);
      expect(response.deletedCount).toEqual(1);

      const updateParams = mockDynamoDB.mock.calls[mockDynamoDB.mock.calls.length - 1][0];
      expect(updateParams.ExpressionAttributeValues[":s"]).toEqual("scheduled");
    });

    it("should not reconcile the scenario when the test is actively running", async () => {
      const runningTestData = {
        Item: { ...testData.Item, status: "running" },
      };
      queueDeletionMocks(runningTestData);

      const response = await lambda.deleteTestRuns("1234", ["run-001"]);
      expect(response.deletedCount).toEqual(1);

      // getTestEntry, run validation, batch delete, decrement - no GSI query, no GetItem, no reconcile update
      expect(mockDynamoDB).toHaveBeenCalledTimes(4);
    });

    it("should not fail the deletion when reconciliation errors", async () => {
      queueDeletionMocks(testData);
      mockDynamoDB.mockImplementationOnce(() => Promise.reject(new Error("DB ERROR"))); // GSI Query fails

      const response = await lambda.deleteTestRuns("1234", ["run-001"]);
      expect(response.deletedCount).toEqual(1);
    });
  });
});

//Baseline management tests
describe("Baseline Management", () => {
  const baselineTestData = {
    Item: {
      testId: "1234",
      testName: "mytest",
      testType: "simple",
      status: "complete",
      testScenario: '{"name":"example"}',
      testTaskConfigs: [{ region: "us-east-1", taskCount: "1", concurrency: "1" }],
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

    it('should return "INVALID_BASELINE_STATUS" (409) when "setBaseline" targets a non-complete run', async () => {
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestData));
      mockDynamoDB.mockImplementationOnce(() =>
        Promise.resolve({ Item: { ...baselineHistoryData.Item, status: "failed" } })
      );

      try {
        await lambda.setBaseline("1234", "run-5678");
        throw new Error("Expected setBaseline to reject a non-complete run");
      } catch (error) {
        expect(error.code).toEqual("INVALID_BASELINE_STATUS");
        expect(error.statusCode).toEqual(409);
      }
    });

    it('should reject "setBaseline" when the run has no recorded status (not complete)', async () => {
      const noStatusItem = { ...baselineHistoryData.Item };
      delete noStatusItem.status;
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve(baselineTestData));
      mockDynamoDB.mockImplementationOnce(() => Promise.resolve({ Item: noStatusItem }));

      try {
        await lambda.setBaseline("1234", "run-5678");
        throw new Error("Expected setBaseline to reject a run with no status");
      } catch (error) {
        expect(error.code).toEqual("INVALID_BASELINE_STATUS");
        expect(error.statusCode).toEqual(409);
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

describe("getTestRunCount", () => {
  it("returns the COUNT from the history table", async () => {
    mockDynamoDB.mockImplementation(() => Promise.resolve({ Count: 5 }));
    const count = await lambda.getTestRunCount("test-123");
    expect(count).toBe(5);
  });

  it("returns null when DynamoDB throws", async () => {
    mockDynamoDB.mockImplementation(() => Promise.reject(new Error("db error")));
    const count = await lambda.getTestRunCount("test-123");
    expect(count).toBeNull();
  });
});

describe("computeChangedFields", () => {
  const { computeChangedFields } = require("./index");

  it("should return empty array when nothing changed", () => {
    const existing = { testName: "Test", testDescription: "Desc", testType: "simple" };
    const incoming = { testName: "Test", testDescription: "Desc", testType: "simple" };
    expect(computeChangedFields(existing, incoming)).toEqual([]);
  });

  it("should detect changed scalar fields", () => {
    const existing = { testName: "Old", testDescription: "Desc" };
    const incoming = { testName: "New", testDescription: "Desc" };
    expect(computeChangedFields(existing, incoming)).toEqual(["testName"]);
  });

  it("should detect multiple changed fields", () => {
    const existing = { testName: "Old", testDescription: "Old Desc", showLive: false };
    const incoming = { testName: "New", testDescription: "New Desc", showLive: true };
    expect(computeChangedFields(existing, incoming)).toEqual(["testName", "testDescription", "showLive"]);
  });

  it("should compare testScenario as JSON string from DynamoDB against object", () => {
    const scenario = { execution: [{ "hold-for": "1m" }] };
    const existing = { testScenario: JSON.stringify(scenario) };
    const incoming = { testScenario: scenario };
    expect(computeChangedFields(existing, incoming)).toEqual([]);
  });

  it("should detect testScenario change when stored as JSON string", () => {
    const existing = { testScenario: JSON.stringify({ execution: [{ "hold-for": "1m" }] }) };
    const incoming = { testScenario: { execution: [{ "hold-for": "2m" }] } };
    expect(computeChangedFields(existing, incoming)).toEqual(["testScenario"]);
  });

  it("should compare array fields like testTaskConfigs by value", () => {
    const configs = [{ region: "us-east-1", taskCount: 1 }];
    const existing = { testTaskConfigs: configs };
    const incoming = { testTaskConfigs: [{ region: "us-east-1", taskCount: 2 }] };
    expect(computeChangedFields(existing, incoming)).toEqual(["testTaskConfigs"]);
  });

  it("should treat undefined and missing fields as equal", () => {
    const existing = {};
    const incoming = {};
    expect(computeChangedFields(existing, incoming)).toEqual([]);
  });

  it("should only track fields in TRACKED_FIELDS list", () => {
    const existing = { testName: "Same", unknownField: "old" };
    const incoming = { testName: "Same", unknownField: "new" };
    expect(computeChangedFields(existing, incoming)).toEqual([]);
  });
});
