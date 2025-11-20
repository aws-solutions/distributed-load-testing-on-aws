// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const uuid = require("uuid");
const cfn = require("./lib/cfn");
const metrics = require("./lib/metrics");
const storeConfig = require("./lib/config-storage");
const iot = require("./lib/iot");

exports.handler = async (event, context) => {
  console.log(`Custom resource: ${event.ResourceProperties?.Resource}, RequestType: ${event.RequestType}`);

  const resource = event.ResourceProperties.Resource;
  const config = event.ResourceProperties;
  const requestType = event.RequestType;
  let responseData = {};

  try {
    switch (resource) {
      case "TestingResourcesConfigFile":
        if (requestType === "Delete") {
          await storeConfig.delTestingResourcesConfigFile(config.TestingResourcesConfig);
        } else {
          await storeConfig.testingResourcesConfigFile(config.TestingResourcesConfig);
        }
        break;
      case "UUID":
        if (requestType === "Create") {
          responseData = {
            UUID: uuid.v4(),
            SUFFIX: uuid.v4().slice(-10),
          };
        }
        break;
      case "GetIotEndpoint":
        if (requestType !== "Delete") {
          const iotEndpoint = await iot.getIotEndpoint();
          responseData = {
            IOT_ENDPOINT: iotEndpoint,
          };
        }
        break;
      case "Metric":
        await metrics.send(config, requestType);
        break;
      default:
        throw Error(`${resource} not supported`);
    }
    await cfn.send(event, context, "SUCCESS", responseData, resource);
  } catch (err) {
    console.error(`Error in custom resource ${resource}: ${err.message}, Code: ${err.code || 'N/A'}, RequestType: ${requestType}`);
    await cfn.send(event, context, "FAILED", {}, resource);
    throw new Error(`Custom resource ${resource} failed: ${err.message || 'Unknown error'}`);
  }
};
