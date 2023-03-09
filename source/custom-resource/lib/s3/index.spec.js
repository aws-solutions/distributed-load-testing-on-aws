// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const yaml = require("js-yaml");
// Mock AWS SDK
const mockS3 = jest.fn();
const mockAWS = require("aws-sdk");
mockAWS.S3 = jest.fn(() => ({
  getObject: mockS3,
  putObject: mockS3,
  copyObject: mockS3,
}));
mockAWS.config = jest.fn(() => ({
  logger: Function,
}));
process.env.SOLUTION_ID = "SO0062";
process.env.VERSION = "3.0.0";
const lambda = require("./index.js");

//fake template for putRegionalTemplate tests
const template = yaml.dump({
  Mappings: {
    Solution: {
      Config: {
        APIServicesLambdaRoleName: "PLACEHOLDER",
        MainStackRegion: "PLACEHOLDER",
        ScenariosTable: "PLACEHOLDER",
        TaskRunnerRoleName: "PLACEHOLDER",
        TaskCancelerRoleName: "PLACEHOLDER",
        TaskStatusCheckerRoleName: "PLACEHOLDER",
        ScenariosS3Bucket: "PLACEHOLDER",
        Uuid: "PLACEHOLDER",
      },
    },
  },
});

//event body for putRegionalTemplate tests
const putRegionalTemplateEventBody = {
  APIServicesLambdaRoleName: "test-services-role",
  MainStackRegion: "test-region",
  ScenariosTable: "test-table",
  TaskRunnerRoleName: "test-runner-role",
  TaskCancelerRoleName: "test-canceler-role",
  TaskStatusCheckerRoleName: "test-checker-role",
  DestBucket: "test-bucket",
  Uuid: "test-uuid",
};

describe("#S3::", () => {
  beforeEach(() => {
    mockS3.mockReset();
  });

  it('should return "success" on copyAssets success', async () => {
    const data = { Body: '["console/file1","console/file2"]' };
    mockS3
      .mockImplementationOnce(() => ({
        promise() {
          // getObject
          return Promise.resolve(data);
        },
      }))
      .mockImplementation(() => ({
        promise() {
          // copyObject
          return Promise.resolve({});
        },
      }));

    const response = await lambda.copyAssets("srcBucket", "srcPath", "manifestFile", "destBucket");
    expect(response).toEqual("success");
  });

  it('should return "ERROR" on copyAssets failure', async () => {
    mockS3.mockImplementation(() => ({
      promise() {
        // getObject
        return Promise.reject("ERROR");
      },
    }));

    try {
      await lambda.copyAssets("srcBucket", "srcPath", "manifestFile", "destBucket");
    } catch (error) {
      expect(error).toEqual("ERROR");
    }
  });

  it('should return "success" on ConfigFile success', async () => {
    mockS3.mockImplementation(() => ({
      promise() {
        // putObject
        return Promise.resolve();
      },
    }));

    const response = await lambda.configFile("file", "destBucket");
    expect(response).toEqual("success");
  });

  it('should return "ERROR" on ConfigFile failure', async () => {
    mockS3.mockImplementation(() => ({
      promise() {
        // putObject
        return Promise.reject("ERROR");
      },
    }));

    try {
      await lambda.configFile("file", "destBucket");
    } catch (error) {
      expect(error).toEqual("ERROR");
    }
  });

  it('should return "SUCCESS" on putRegionalTemplate success', async () => {
    mockS3.mockImplementationOnce(() => ({
      promise() {
        // getObject
        return Promise.resolve({ Body: template });
      },
    }));

    mockS3.mockImplementationOnce(() => ({
      promise() {
        // putObject
        return Promise.resolve();
      },
    }));

    const response = await lambda.putRegionalTemplate(putRegionalTemplateEventBody);
    const expectedTemplate = yaml.dump({
      Mappings: {
        Solution: {
          Config: {
            APIServicesLambdaRoleName: "test-services-role",
            MainStackRegion: "test-region",
            ScenariosTable: "test-table",
            TaskRunnerRoleName: "test-runner-role",
            TaskCancelerRoleName: "test-canceler-role",
            TaskStatusCheckerRoleName: "test-checker-role",
            ScenariosS3Bucket: "test-bucket",
            Uuid: "test-uuid",
          },
        },
      },
    });
    expect(mockS3).toHaveBeenNthCalledWith(2, expect.objectContaining({ Body: expectedTemplate }));
    expect(response).toEqual("success");
  });

  it('should return "ERROR" on putRegionalTemplate failure', async () => {
    mockS3.mockImplementation(() => ({
      promise() {
        // putObject
        return Promise.reject("ERROR");
      },
    }));

    try {
      await lambda.putRegionalTemplate(putRegionalTemplateEventBody);
    } catch (error) {
      expect(error).toEqual("ERROR");
    }
  });
});
