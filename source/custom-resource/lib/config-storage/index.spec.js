// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockDynamoDb = {
  put: jest.fn(),
};

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocument: {
    from: jest.fn(() => ({
      put: mockDynamoDb.put,
    })),
  },
}));

process.env = {
  AWS_REGION: "us-west-2",
  DDB_TABLE: "testDDBTable",
  MAIN_REGION: "us-east-2",
  S3_BUCKET: "tests3bucket",
  SOLUTION_ID: "SO00XX",
  VERSION: "3.0.0",
};

const lambda = require("./index.js");

const testingResourcesConfig = {
  testId: `region-${process.env.AWS_REGION}`,
  ecsCloudWatchLogGroup: "testCloudWatchGroup",
  region: "us-west-2",
  subnetA: "subnet-testA",
  subnetB: "subnet-testB",
  taskSecurityGroup: "testFargateSG",
  taskDefinition: "testFargateTestDefinition",
  taskImage: "test-load-tester",
  taskCluster: "testCluster",
};

const deletedTestingResourcesConfig = {
  testId: `region-${process.env.AWS_REGION}`,
  ecsCloudWatchLogGroup: "",
  region: "us-west-2",
  subnetA: "",
  subnetB: "",
  taskSecurityGroup: "",
  taskDefinition: "",
  taskImage: "",
  taskCluster: "",
};

describe("#Write Configs::", () => {
  beforeEach(() => {
    mockDynamoDb.put.mockReset();
  });

  it('should return "success" for writing to S3 and DynamoDB', async () => {
    mockDynamoDb.put.mockResolvedValue({});

    const response = await lambda.testingResourcesConfigFile(testingResourcesConfig, () => {
      expect(this.options.customUserAgent).toBeDefined();
      expect(this.options.customUserAgent).toHaveValue("AwsSolution/SO00XX/3.0.0");
      expect(mockDynamoDb.put).toHaveBeenCalledWith({
        TableName: "testDDBTable",
        Item: expect.objectContaining(testingResourcesConfig),
      });
    });
    expect(response).toEqual("success");
  });

  it('should return "ERROR" on ConfigFile failure', async () => {
    mockDynamoDb.put.mockRejectedValue("ERROR");

    try {
      await lambda.testingResourcesConfigFile(testingResourcesConfig);
    } catch (error) {
      expect(error).toEqual("ERROR");
      expect(mockDynamoDb.put).toHaveBeenCalledWith({
        TableName: "testDDBTable",
        Item: expect.objectContaining(testingResourcesConfig),
      });
    }
  });
});

describe("#Delete Configs::", () => {
  beforeEach(() => {
    mockDynamoDb.put.mockReset();
  });

  it('should return "success" for deleting S3 object and DynamoDB item', async () => {
    mockDynamoDb.put.mockResolvedValue({});

    const response = await lambda.delTestingResourcesConfigFile(testingResourcesConfig);
    expect(response).toEqual("success");
    expect(mockDynamoDb.put).toHaveBeenCalledWith({
      TableName: "testDDBTable",
      Item: expect.objectContaining(deletedTestingResourcesConfig),
    });
  });

  it('should return "ERROR" on delete failure', async () => {
    mockDynamoDb.put.mockRejectedValue("ERROR");

    try {
      await lambda.delTestingResourcesConfigFile(testingResourcesConfig);
    } catch (error) {
      expect(error).toEqual("ERROR");
      expect(mockDynamoDb.put).toHaveBeenCalledWith({
        TableName: "testDDBTable",
        Item: expect.objectContaining(deletedTestingResourcesConfig),
      });
    }
  });
});
