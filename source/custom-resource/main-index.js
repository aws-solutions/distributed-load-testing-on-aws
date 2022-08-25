// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const uuid = require('uuid');
const cfn = require('./lib/cfn');
const metrics = require('./lib/metrics');
const s3 = require('./lib/s3');
const iot = require('./lib/iot');
const storeConfig = require('./lib/config-storage');

exports.handler = async (event, context) => {
  console.log(`event: ${JSON.stringify(event, null, 2)}`);

  const resource = event.ResourceProperties.Resource;
  const config = event.ResourceProperties;
  const requestType = event.RequestType;
  let responseData = {};

  try {
    switch (resource) {
      case ('TestingResourcesConfigFile'):
        if (requestType === 'Delete') {
          await storeConfig.delTestingResourcesConfigFile(config.TestingResourcesConfig);
        } else {
          await storeConfig.testingResourcesConfigFile(config.TestingResourcesConfig);
        }
        break;
      case ('UUID'):
        if (requestType === 'Create') {
          responseData = {
            UUID: uuid.v4(),
            SUFFIX: uuid.v4().slice(-10)
          }
        }
        break;
      case ('CopyAssets'):
        if (requestType !== 'Delete') {
          await s3.copyAssets(config.SrcBucket, config.SrcPath, config.ManifestFile, config.DestBucket);
        }
        break;
      case ('ConfigFile'):
        if (requestType !== 'Delete') {
          await s3.configFile(config.AwsExports, config.DestBucket);
        }
        break;
      case ('PutRegionalTemplate'):
        if (requestType !== 'Delete') {
          await s3.putRegionalTemplate(config);
        }
        break;
      case ('GetIotEndpoint'):
        if (requestType === 'Create') {
          const iotEndpoint = await iot.getIotEndpoint();
          responseData = {
            IOT_ENDPOINT: iotEndpoint
          };
        }
        break;
      case ('DetachIotPolicy'):
        if (requestType === 'Delete') {
          await iot.detachIotPolicy(config.IotPolicyName);
        }
        break;
      case ('AnonymousMetric'):
        await metrics.send(config, requestType);
        break;
      default:
        throw Error(`${resource} not supported`);
    }
    await cfn.send(event, context, 'SUCCESS', responseData, resource);
  }
  catch (err) {
    console.log(err, err.stack);
    cfn.send(event, context, 'FAILED', {}, resource);
  }
};
