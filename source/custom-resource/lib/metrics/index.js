// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require("axios");
const { CloudFormationClient, DescribeStacksCommand } = require("@aws-sdk/client-cloudformation");

/**
 * Retrieves the value of the LaunchWizardResourceGroupID tag from the stack.
 * Returns the tag value if present, or undefined if not found or on error.
 */
const getLaunchWizardResourceGroupId = async (stackId) => {
  try {
    if (!stackId) {
      return undefined;
    }
    const client = new CloudFormationClient({});
    const response = await client.send(new DescribeStacksCommand({ StackName: stackId }));
    const tags = response.Stacks?.[0]?.Tags || [];
    const tag = tags.find((t) => t.Key === "LaunchWizardResourceGroupID");
    return tag?.Value;
  } catch (err) {
    console.error(`Failed to retrieve stack tags: ${err.message}`);
    return undefined;
  }
};

const send = async (config, type, stackId) => {
  try {
    const launchWizardResourceGroupId = await getLaunchWizardResourceGroupId(stackId);
    const data = {
      Type: type,
      Region: config.Region,
    };

    // Main stack metric fields
    if (config.existingVPC !== undefined) data.ExistingVpc = config.existingVPC;
    if (config.AutoUpdateContainerImage !== undefined) data.AutoUpdateContainerImage = config.AutoUpdateContainerImage;
    if (config.DeployMcpServer !== undefined) data.DeployMcpServer = config.DeployMcpServer;

    // Regional stack metric fields
    if (config.StackType !== undefined) data.StackType = config.StackType;

    if (launchWizardResourceGroupId) {
      data.LaunchWizardResourceGroupID = launchWizardResourceGroupId;
    }

    const metrics = {
      Solution: config.SolutionId,
      Version: config.Version,
      UUID: config.UUID,
      // Date and time instant in a java.sql.Timestamp compatible format
      TimeStamp: new Date().toISOString().replace("T", " ").replace("Z", ""),
      MetricSchemaVersion: 1,
      AccountId: config.AccountId,
      Data: data,
    };
    const params = {
      method: "post",
      port: 443,
      url: process.env.METRIC_URL,
      headers: {
        "Content-Type": "application/json",
      },
      data: metrics,
    };
    //Send Metrics & return status code.
    await axios(params);
  } catch (err) {
    //Not returning an error to avoid Metrics affecting the Application
    console.error(err);
  }
};

module.exports = {
  send: send,
};
