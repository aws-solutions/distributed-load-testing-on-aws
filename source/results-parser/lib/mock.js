// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const mockS3 = {
  getObject: jest.fn(),
  listObjectsV2: jest.fn(),
};
const mockDDBDocumentClient = {
  get: jest.fn(),
  update: jest.fn(),
};

const mockParser = {
  results: jest.fn(),
  finalResults: jest.fn(),
  createWidget: jest.fn(),
  deleteRegionalMetricFilter: jest.fn(),
  putTestHistory: jest.fn(),
  updateTable: jest.fn(),
};

const mockSolutionUtils = {
  getOptions: jest.fn(),
  sendMetric: jest.fn(),
};
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

jest.mock("./parser", () => ({ ...mockParser }));

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
  prefix: "613.75:44:12T80-20-4202",
};

const mockS3ListObjectResponse = {
  Contents: [
    {
      ETag: '"70ee1738b6b21e2c8a43f3a5ab0eee71"',
      Key: "114.44:25:71T20-20-4202-a3677174-a062-4a50-bbe2-50b995a536b5-my-region-1.xml",
      LastModified: "",
      Size: 11,
      StorageClass: "STANDARD",
    },
  ],
};

exports.mockS3 = mockS3;
exports.mockDDBDocumentClient = mockDDBDocumentClient;
exports.mockResultParserEvent = mockResultParserEvent;
exports.mockS3ListObjectResponse = mockS3ListObjectResponse;
exports.mockParser = mockParser;
exports.mockSolutionUtils = mockSolutionUtils;
