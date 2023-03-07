// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require("aws-sdk");
const utils = require("solution-utils");
AWS.config.logger = console;
let options = { region: process.env.MAIN_REGION };
options = utils.getOptions(options);
const iot = new AWS.Iot(options);

/**
 * Get the IoT endpoint
 */
const getIotEndpoint = async () => {
  let params = {
    endpointType: "iot:Data-ATS",
  };
  const data = await iot.describeEndpoint(params).promise();
  return data.endpointAddress;
};

/**
 * Detach IoT policy on CloudFormation DELETE.
 */
const detachIotPolicy = async (iotPolicyName) => {
  const response = await iot.listTargetsForPolicy({ policyName: iotPolicyName }).promise();
  const targets = response.targets;

  for (let target of targets) {
    const params = {
      policyName: iotPolicyName,
      principal: target,
    };

    await iot.detachPrincipalPolicy(params).promise();
    console.log(`${target} is detached from ${iotPolicyName}`);
  }

  return "success";
};

module.exports = {
  getIotEndpoint: getIotEndpoint,
  detachIotPolicy: detachIotPolicy,
};
