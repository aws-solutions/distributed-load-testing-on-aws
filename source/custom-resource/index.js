// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const uuid = require('uuid');
const cfn = require('./lib/cfn');
const metrics = require('./lib/metrics');
const s3 = require('./lib/s3');

exports.handler = async (event, context) => {
    console.log(`event: ${JSON.stringify(event,null,2)}`);

    const resource = event.ResourceProperties.Resource;
    const config = event.ResourceProperties;
    let responseData = {};

    try {
        if (event.RequestType === 'Create') {
            switch (resource) {
                case ('UUID'):
                    responseData = {
                        UUID: uuid.v4()
                    };
                    break;
                case ('CopyAssets'):
                    await s3.copyAssets(config.SrcBucket, config.SrcPath, config.ManifestFile, config.DestBucket);
                    break;
                case ('ConfigFile'):
                    await s3.configFile(config.AwsExports, config.DestBucket);
                    break;
                case ('AnonymousMetric'):
                    await metrics.send(config, event.RequestType);
                    break;
                default:
                    throw Error(resource + ' not defined as a resource');
            }
        } else if (event.RequestType === 'Update') {
            switch (resource) {
                case ('CopyAssets'):
                    await s3.copyAssets(config.SrcBucket, config.SrcPath, config.ManifestFile, config.DestBucket);
                    break;
                case ('ConfigFile'):
                    await s3.configFile(config.AwsExports, config.DestBucket);
                    break;
                case ('AnonymousMetric'):
                    await metrics.send(config, event.RequestType);
                    break;
                default:
                    break;
            }
        } else if (event.RequestType === 'Delete') {
            await metrics.send(config, event.RequestType);
        }

        await cfn.send(event, context, 'SUCCESS', responseData, resource);
    }
    catch (err) {
        console.log(err, err.stack);
        cfn.send(event, context, 'FAILED',{},resource);
    }
};
