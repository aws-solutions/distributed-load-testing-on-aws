// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const yaml = require("js-yaml");
// Mock AWS SDK
const mockS3 = {
  getObject: jest.fn(),
  putObject: jest.fn(),
  copyObject: jest.fn(),
};

jest.mock("@aws-sdk/client-s3", () => ({
  S3: jest.fn(() => ({
    getObject: mockS3.getObject,
    putObject: mockS3.putObject,
    copyObject: mockS3.copyObject,
  })),
}));

process.env.SOLUTION_ID = "SO0062";
process.env.VERSION = "3.0.0";
const lambda = require("./index.js");

//fake template for putRegionalTemplate tests
const template = {
  Mappings: {
    Solution: {
      Config: {
        MainRegionLambdaTaskRoleArn: "Main_Region_Lambda_Task_Role_Arn",
        MainRegionStack: "Main_Region_Stack",
        ScenariosBucket: "Scenarios_Bucket",
        ScenariosTable: "Scenarios_Table",
      },
    },
  },
};

//event body for putRegionalTemplate tests
const putRegionalTemplateEventBody = {
  MainRegionLambdaTaskRoleArn: "test-services-role",
  MainRegionStack: "test-region",
  DestBucket: "test-bucket",
  ScenariosTable: "test-table",
};

describe("#S3::", () => {
  beforeEach(() => {
    mockS3.getObject.mockReset();
    mockS3.putObject.mockReset();
    mockS3.copyObject.mockReset();
  });

  it('should return "success" on ConfigFile success', async () => {
    mockS3.putObject.mockResolvedValue({});

    const response = await lambda.configFile("file", "destBucket");
    expect(response).toEqual("success");
  });

  it('should return "ERROR" on ConfigFile failure', async () => {
    mockS3.putObject.mockRejectedValue("ERROR");

    try {
      await lambda.configFile("file", "destBucket");
    } catch (error) {
      expect(error).toEqual("ERROR");
    }
  });

  it('should return "SUCCESS" on putRegionalTemplate success', async () => {
    mockS3.getObject.mockResolvedValueOnce({
      Body: {
        transformToString: () => Promise.resolve(Buffer.from(JSON.stringify(template))),
      },
    });

    mockS3.putObject.mockResolvedValueOnce({});

    const response = await lambda.putRegionalTemplate(putRegionalTemplateEventBody);
    expect(mockS3.putObject).toHaveBeenCalledWith({
      Bucket: "test-bucket",
      Key: "regional-template/distributed-load-testing-on-aws-regional.template",
      Body: JSON.stringify({
        Mappings: {
          Solution: {
            Config: {
              MainRegionLambdaTaskRoleArn: "test-services-role",
              MainRegionStack: "test-region",
              ScenariosBucket: "test-bucket",
              ScenariosTable: "test-table",
            },
          },
        },
      }),
    });
    expect(response).toEqual("success");
  });

  it('should return "ERROR" on putRegionalTemplate failure', async () => {
    mockS3.getObject.mockRejectedValue("ERROR");

    try {
      await lambda.putRegionalTemplate(putRegionalTemplateEventBody);
    } catch (error) {
      expect(error).toEqual("ERROR");
    }
  });
});
