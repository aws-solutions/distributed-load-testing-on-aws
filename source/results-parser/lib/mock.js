// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const mockS3 = {
  getObject: jest.fn(),
  listObjectsV2: jest.fn(),
  putObject: jest.fn(),
};
const mockDDBDocumentClient = {
  update: jest.fn(),
};

const mockParser = {
  results: jest.fn(),
  finalResults: jest.fn(),
  updateTestHistoryResults: jest.fn(),
  updateFrameworkExitSummary: jest.fn(),
  updateTable: jest.fn(),
};

const mockSolutionUtils = {
  getOptions: jest.fn(),
  sendMetric: jest.fn(),
};
const locustResultFixture = require("../../load-tester/test/fixtures/locust-result.json");

jest.mock("@aws-sdk/client-s3", () => ({
  S3: jest.fn(() => ({
    ...mockS3,
  })),
}));

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDB: jest.fn(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocument: {
    from: jest.fn(() => ({ ...mockDDBDocumentClient })),
  },
}));

// lib/native imports acceptedCodes from the parser rather than keeping its own copy,
// so the real list has to survive the mock.
jest.mock("./parser", () => ({ ...mockParser, acceptedCodes: jest.requireActual("./parser").acceptedCodes }));

jest.mock("solution-utils", () => ({ ...mockSolutionUtils }));

const mockResultParserEvent = {
  testTaskConfig: [
    {
      concurrency: 2,
      taskCount: 5,
      region: "my-region-1",
      ecsCloudWatchLogGroup: "myLogGroup",
      taskCluster: "myTaskCluster",
      testId: "myTestId",
      taskDefinition: "myTaskDefinition",
      subnetB: "mySubnetB",
      taskImage: "myImage",
      subnetA: "mySubnetA",
      taskSecurityGroup: "mySecurityGroup",
    },
  ],
  testId: "Q9Isyy5DIK",
  testType: "simple",
  fileType: "none",
  showLive: true,
  testDuration: 60,
  prefix: "2024-01-15T14-30-25_abc1234567",
  testRunId: "abc1234567",
  nativeRunMode: null,
  executionFailed: false,
};

const mockS3ListObjectResponse = {
  Contents: [
    {
      ETag: '"70ee1738b6b21e2c8a43f3a5ab0eee71"',
      Key: "2024-01-15T14-30-25_abc1234567/a3677174-a062-4a50-bbe2-50b995a536b5-my-region-1.xml",
      LastModified: "",
      Size: 11,
      StorageClass: "STANDARD",
    },
  ],
};

const mockNativeArtifact = (overrides = {}) => ({
  ...structuredClone(locustResultFixture),
  testId: "Q9Isyy5DIK",
  taskId: "task-1",
  region: "my-region-1",
  startTime: "2024-01-15T14:30:25Z",
  endTime: "2024-01-15T14:31:25Z",
  testDurationSeconds: 60,
  task: { vcpus: 2, memoryMiB: 4096, ecsDurationSeconds: 70 },
  ...overrides,
});

const nativeResultKey = (region, taskId) =>
  `results/Q9Isyy5DIK/2024-01-15T14-30-25_abc1234567/${region}/${taskId}/result.json`;

exports.mockS3 = mockS3;
exports.mockDDBDocumentClient = mockDDBDocumentClient;
exports.mockResultParserEvent = mockResultParserEvent;
exports.mockS3ListObjectResponse = mockS3ListObjectResponse;
exports.mockParser = mockParser;
exports.mockSolutionUtils = mockSolutionUtils;
exports.mockNativeArtifact = mockNativeArtifact;
exports.nativeResultKey = nativeResultKey;
