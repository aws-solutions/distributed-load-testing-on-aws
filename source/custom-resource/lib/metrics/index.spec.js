// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require("axios");
const MockAdapter = require("axios-mock-adapter");

const { CloudFormationClient, DescribeStacksCommand } = require("@aws-sdk/client-cloudformation");

const lambda = require("./index.js");

// Mock the CloudFormation client
jest.mock("@aws-sdk/client-cloudformation", () => {
  const mockSend = jest.fn();
  return {
    CloudFormationClient: jest.fn(() => ({ send: mockSend })),
    DescribeStacksCommand: jest.fn(),
    __mockSend: mockSend,
  };
});

const { __mockSend: mockCfnSend } = require("@aws-sdk/client-cloudformation");

const _config = {
  SolutionId: "SO00XX",
  Version: "testVersion",
  UUID: "999-999",
  Region: "testRegion",
  existingVPC: "testTest",
  AccountId: "123456789012",
  AutoUpdateContainerImage: "Yes",
  DeployMcpServer: "No",
};

const _stackId = "arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/guid";

describe("#SEND METRICS", () => {
  let mock;

  beforeEach(() => {
    process.env.METRIC_URL = "TestEndpoint";
    mock = new MockAdapter(axios);
    mock.onPost().reply(200);
    mockCfnSend.mockReset();
  });

  afterEach(() => {
    delete process.env.METRIC_URL;
    mock.restore();
  });

  it("send metrics success without Launch Wizard tag", async () => {
    // Arrange
    mockCfnSend.mockResolvedValue({
      Stacks: [{ Tags: [{ Key: "SomeOtherTag", Value: "SomeValue" }] }],
    });

    const expected_metric_object = {
      Solution: _config.SolutionId,
      Version: _config.Version,
      UUID: _config.UUID,
      MetricSchemaVersion: 1,
      AccountId: _config.AccountId,
      Data: {
        Type: "Create",
        Region: _config.Region,
        ExistingVpc: _config.existingVPC,
        AutoUpdateContainerImage: _config.AutoUpdateContainerImage,
        DeployMcpServer: _config.DeployMcpServer,
      },
    };

    // Act
    await lambda.send(_config, "Create", _stackId);

    // Assert
    expect(mock.history.post.length).toEqual(1);
    expect(mock.history.post[0].url).toEqual(process.env.METRIC_URL);
    expect(typeof Date.parse(JSON.parse(mock.history.post[0].data).TimeStamp)).toEqual("number");
    const postedData = JSON.parse(mock.history.post[0].data);
    expect(postedData).toMatchObject(expected_metric_object);
    expect(postedData.Data.LaunchWizardResourceGroupID).toBeUndefined();
  });

  it("send metrics success with Launch Wizard tag", async () => {
    // Arrange
    const resourceGroupId = "lw-abc123";
    mockCfnSend.mockResolvedValue({
      Stacks: [{ Tags: [{ Key: "LaunchWizardResourceGroupID", Value: resourceGroupId }] }],
    });

    const expected_metric_object = {
      Solution: _config.SolutionId,
      Version: _config.Version,
      UUID: _config.UUID,
      MetricSchemaVersion: 1,
      AccountId: _config.AccountId,
      Data: {
        Type: "Create",
        Region: _config.Region,
        ExistingVpc: _config.existingVPC,
        AutoUpdateContainerImage: _config.AutoUpdateContainerImage,
        DeployMcpServer: _config.DeployMcpServer,
        LaunchWizardResourceGroupID: resourceGroupId,
      },
    };

    // Act
    await lambda.send(_config, "Create", _stackId);

    // Assert
    expect(mock.history.post.length).toEqual(1);
    const postedData = JSON.parse(mock.history.post[0].data);
    expect(postedData).toMatchObject(expected_metric_object);
  });

  it("send metrics success when DescribeStacks fails", async () => {
    // Arrange
    mockCfnSend.mockRejectedValue(new Error("Access Denied"));

    const expected_metric_object = {
      Solution: _config.SolutionId,
      Version: _config.Version,
      UUID: _config.UUID,
      MetricSchemaVersion: 1,
      AccountId: _config.AccountId,
      Data: {
        Type: "Create",
        Region: _config.Region,
        ExistingVpc: _config.existingVPC,
        AutoUpdateContainerImage: _config.AutoUpdateContainerImage,
        DeployMcpServer: _config.DeployMcpServer,
      },
    };

    // Act
    await lambda.send(_config, "Create", _stackId);

    // Assert
    expect(mock.history.post.length).toEqual(1);
    const postedData = JSON.parse(mock.history.post[0].data);
    expect(postedData).toMatchObject(expected_metric_object);
    expect(postedData.Data.LaunchWizardResourceGroupID).toBeUndefined();
  });

  it("send metrics success when no stackId provided", async () => {
    // Arrange
    const expected_metric_object = {
      Solution: _config.SolutionId,
      Version: _config.Version,
      UUID: _config.UUID,
      MetricSchemaVersion: 1,
      AccountId: _config.AccountId,
      Data: {
        Type: "Create",
        Region: _config.Region,
        ExistingVpc: _config.existingVPC,
        AutoUpdateContainerImage: _config.AutoUpdateContainerImage,
        DeployMcpServer: _config.DeployMcpServer,
      },
    };

    // Act
    await lambda.send(_config, "Create");

    // Assert
    expect(mock.history.post.length).toEqual(1);
    expect(mockCfnSend).not.toHaveBeenCalled();
    const postedData = JSON.parse(mock.history.post[0].data);
    expect(postedData).toMatchObject(expected_metric_object);
    expect(postedData.Data.LaunchWizardResourceGroupID).toBeUndefined();
  });

  it("send regional stack metrics success", async () => {
    // Arrange
    const regionalConfig = {
      SolutionId: "SO00XX",
      Version: "testVersion",
      UUID: "999-999",
      Region: "eu-west-1",
      AccountId: "123456789012",
      StackType: "regional",
    };
    const expected_metric_object = {
      Solution: regionalConfig.SolutionId,
      Version: regionalConfig.Version,
      UUID: regionalConfig.UUID,
      MetricSchemaVersion: 1,
      AccountId: regionalConfig.AccountId,
      Data: {
        Type: "Create",
        Region: regionalConfig.Region,
        StackType: "regional",
      },
    };
    const mock = new MockAdapter(axios);
    mock.onPost().reply(200);

    // Act
    await lambda.send(regionalConfig, "Create");

    // Assert
    expect(mock.history.post.length).toEqual(1);
    expect(mock.history.post[0].url).toEqual(process.env.METRIC_URL);
    const sentData = JSON.parse(mock.history.post[0].data);
    expect(typeof Date.parse(sentData.TimeStamp)).toEqual("number");
    expect(sentData).toMatchObject(expected_metric_object);
    // Ensure main stack fields are not present
    expect(sentData.Data.ExistingVpc).toBeUndefined();
    expect(sentData.Data.AutoUpdateContainerImage).toBeUndefined();
    expect(sentData.Data.DeployMcpServer).toBeUndefined();
  });

  it("should not throw error, when metric send fails", async () => {
    // Arrange
    mockCfnSend.mockResolvedValue({ Stacks: [{ Tags: [] }] });
    mock.restore();
    mock = new MockAdapter(axios);
    mock.onPost().networkError();

    // Act
    await lambda.send(_config, "Create", _stackId);

    // Assert
    expect(mock.history.post.length).toBe(1);
  });
});
