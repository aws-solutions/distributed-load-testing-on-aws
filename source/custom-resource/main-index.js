// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const crypto = require("crypto");
const cfn = require("./lib/cfn");
const metrics = require("./lib/metrics");
const s3 = require("./lib/s3");
const iot = require("./lib/iot");
const storeConfig = require("./lib/config-storage");
const backCompat = require('./lib/backcompat');
const cloudfrontCsp = require("./lib/cloudfront-csp");
const scenarios = require("./lib/scenarios");

const RequestType = Object.freeze({
  CREATE: 'Create',
  UPDATE: 'Update',
  DELETE: 'Delete',
})

const testingResourcesConfigFile = async (config, requestType) => {
  if (requestType === RequestType.DELETE) {
    await storeConfig.delTestingResourcesConfigFile(config.TestingResourcesConfig);
  } else {
    await storeConfig.testingResourcesConfigFile(config.TestingResourcesConfig);
  }
};

const s3Handler = async (config, requestType, resource) => {
  switch (resource) { // NOSONAR
    case "PutRegionalTemplate":
      if (requestType !== RequestType.DELETE) {
        await s3.putRegionalTemplate(config);
      }
      break;
    case "CopyJMeterBundle":
      if (requestType !== RequestType.DELETE) {
        await s3.copyJMeterBundle(config);
      }
      break;
  }
};

exports.handler = async (event, context) => {
  console.log(`Custom resource: ${event.ResourceProperties?.Resource}, RequestType: ${event.RequestType}`);

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
        if (requestType === RequestType.CREATE) {
          responseData = {
            UUID: crypto.randomUUID(),
            SUFFIX: crypto.randomUUID().slice(-10),
          };
        }
        break;
      case "ConfigFile":
      case "PutRegionalTemplate":
      case "CopyJMeterBundle":
        await s3Handler(config, requestType, resource);
        break;
      case "GetIotEndpoint":
        if (requestType === RequestType.CREATE) {
          const iotEndpoint = await iot.getIotEndpoint();
          responseData = {
            IOT_ENDPOINT: iotEndpoint,
          };
        }
        break;
      case "DetachIotPolicy":
        if (requestType === RequestType.DELETE) {
          await iot.detachIotPolicy(config.IotPolicyName);
        }
        break;
      case "Metric":
        await metrics.send(config, requestType, event.StackId);
        break;
      case "V3toV4BackCompat":
        if (requestType === RequestType.CREATE) {
          // DLT v3 to v4 Backwards compatibility updates only apply
          // when the BackCompat custom-resource is created for the first time
          // The only cases a CREATE event occurs are when:
          // 1. Stack is updated from a version that never had this custom resource (i.e. v3)
          // 2. Stack is created for the first time which includes this custom resource
          // We are interested in updating the test configs for the former case, and we
          // shouldn't be concerned about the latter case because there will be no tests to update
          await backCompat.updateScheduledTests();
        }
        break;
      case "UpdateCsp":
        if (requestType !== RequestType.DELETE) {
          await cloudfrontCsp.updateCsp(config);
        }
        break;
      case "CleanUpTestScenarios":
        if (requestType === RequestType.DELETE) {
          await scenarios.cleanUpTestScenarioResources();
        }
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
