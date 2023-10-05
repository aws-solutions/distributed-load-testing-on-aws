// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const uuid = require("uuid");
const cfn = require("./lib/cfn");
const metrics = require("./lib/metrics");
const s3 = require("./lib/s3");
const iot = require("./lib/iot");
const storeConfig = require("./lib/config-storage");

const testingResourcesConfigFile = async (config, requestType) => {
  if (requestType === "Delete") {
    await storeConfig.delTestingResourcesConfigFile(config.TestingResourcesConfig);
  } else {
    await storeConfig.testingResourcesConfigFile(config.TestingResourcesConfig);
  }
};

const s3Handler = async (config, requestType, resource) => {
  switch (resource) {
    case "CopyAssets":
      if (requestType !== "Delete") {
        await s3.copyAssets(config.SrcBucket, config.SrcPath, config.ManifestFile, config.DestBucket);
      }
      break;
    case "ConfigFile":
      if (requestType !== "Delete") {
        await s3.configFile(config.AwsExports, config.DestBucket);
      }
      break;
    case "PutRegionalTemplate":
      if (requestType !== "Delete") {
        await s3.putRegionalTemplate(config);
      }
      break;
  }
};

exports.handler = async (event, context) => {
  console.log(`event: ${JSON.stringify(event, null, 2)}`);

  const resource = event.ResourceProperties.Resource;
  const config = event.ResourceProperties;
  const requestType = event.RequestType;
  let responseData = {};

  try {
    switch (resource) {
      case "TestingResourcesConfigFile":
        await testingResourcesConfigFile(config, requestType);
        break;
      case "UUID":
        if (requestType === "Create") {
          responseData = {
            UUID: uuid.v4(),
            SUFFIX: uuid.v4().slice(-10),
          };
        }
        break;
      case "CopyAssets":
      case "ConfigFile":
      case "PutRegionalTemplate":
        await s3Handler(config, requestType, resource);
        break;
      case "GetIotEndpoint":
        if (requestType === "Create") {
          const iotEndpoint = await iot.getIotEndpoint();
          responseData = {
            IOT_ENDPOINT: iotEndpoint,
          };
        }
        break;
      case "DetachIotPolicy":
        if (requestType === "Delete") {
          await iot.detachIotPolicy(config.IotPolicyName);
        }
        break;
      case "AnonymizedMetric":
        await metrics.send(config, requestType);
        break;
      default:
        throw Error(`${resource} not supported`);
    }
    await cfn.send(event, context, "SUCCESS", responseData, resource);
  } catch (err) {
    console.log(err, err.stack);
    cfn.send(event, context, "FAILED", {}, resource);
  }
};
