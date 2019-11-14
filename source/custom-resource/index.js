/*******************************************************************************
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. 
 *
 * Licensed under the Amazon Software License (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0    
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 *
 ********************************************************************************/

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

                case ('S3PutNotification'):
                    await s3.putNotification(config.Bucket, config.LambdaArn);
                    break;

                case ('CopyAssets'):
                    await s3.copyAssets(config.SrcBucket, config.SrcPath, config.ManifestFile, config.DestBucket);
                    break;
                
                case ('ConfigFile'):
                    await s3.configFile(config.AwsExports, config.DestBucket);
                    break;

                case ('AnonymousMetric'):
                    await metrics.send(config.SolutionId, config.Version, config.Region, config.UUID);
                    break;

                    default:
                    throw Error(resource + ' not defined as a resource');
            }
        }
        if (event.RequestType === 'Update') {
            //Update not required for metrics
        }
        
        if (event.RequestType === 'Delete') {
            //Delete not required for metrics
        }
        
        await cfn.send(event, context, 'SUCCESS', responseData, resource);
        
    } 
    catch (err) {
        console.log(err, err.stack);
        cfn.send(event, context, 'FAILED',{},resource);
    }
};
