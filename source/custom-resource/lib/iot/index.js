// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { IoT } = require("@aws-sdk/client-iot");

const utils = require("solution-utils");

let options = utils.getOptions({ region: process.env.MAIN_REGION });
const iot = new IoT(options);

/**
 * Get the IoT endpoint
 */
const getIotEndpoint = async () => {
  let params = {
    endpointType: "iot:Data-ATS",
  };
  const data = await iot.describeEndpoint(params);
  return data.endpointAddress;
};

/**
 * Detach IoT policy on CloudFormation DELETE.
 */
const detachIotPolicy = async (iotPolicyName) => {
  const response = await iot.listTargetsForPolicy({ policyName: iotPolicyName });
  const targets = response.targets;

  for (let target of targets) {
    const params = {
      policyName: iotPolicyName,
      principal: target,
    };

    await iot.detachPrincipalPolicy(params);
    console.log(`${target} is detached from ${iotPolicyName}`);
  }

  return "success";
};

module.exports = {
  getIotEndpoint: getIotEndpoint,
  detachIotPolicy: detachIotPolicy,
};
