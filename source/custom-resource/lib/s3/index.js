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

const AWS = require('aws-sdk');
AWS.config.logger = console;

/**
 * create a event notification to trigger results-parser Lambda function.
 */
const putNotification = async (bucket,lambdaArn) => {

	const s3 = new AWS.S3();

	try {
		const params = {
			Bucket: bucket,
			NotificationConfiguration: {
				LambdaFunctionConfigurations: [{
					Events: ['s3:ObjectCreated:*'],
					LambdaFunctionArn: lambdaArn,
					Filter: {
						Key: {
							FilterRules: [{
								Name: 'suffix',
								Value: 'xml'
							}]
						}
					}
				}]
			}
		};
		await s3.putBucketNotificationConfiguration(params).promise();
	} catch (err) {
		throw err;
	}
	return 'success';
};

/**
 * Copy Console assets and Container assets from source to destination buckets
 */
const copyAssets = async (srcBucket, srcPath, manifestFile, destBucket) => {
	
	const s3 = new AWS.S3();
	
	try {
		// get file manifest from s3
		const params = {
			Bucket: srcBucket,
			Key:`${srcPath}/${manifestFile}`
		};
		
		const data = await s3.getObject(params).promise();
		const manifest = JSON.parse(data.Body);
		console.log('Manifest:', JSON.stringify(manifest,null,2));
		
		// Loop through manifest and copy files to the destination bucket
		await Promise.all(manifest.map(async (file) => {
			let params = {
				Bucket: destBucket,
				CopySource: `${srcBucket}/${srcPath}/${file}`,
				Key: file
			};
			const resp = await s3.copyObject(params).promise();
			console.log('file copied to s3: ', resp);
		}));
		
	} catch (err) {
		throw err;
	}
	return 'success';
};


/**
 * generate the aws exports file containing cognito and API congig details.
 */
const configFile = async (file, destBucket) => {

	const s3 = new AWS.S3();
	
	try {
		//write exports file to the console 
		const params = {
			Bucket: destBucket,
			Key:'console/assets/aws_config.js',
			Body: file
		};
		console.log(`creating config file: ${JSON.stringify(params)}`);
		await s3.putObject(params).promise();
	} catch (err) {
		throw err;
	}
	return 'success';
};


module.exports = {
	putNotification:putNotification,
	copyAssets: copyAssets,
	configFile: configFile
};