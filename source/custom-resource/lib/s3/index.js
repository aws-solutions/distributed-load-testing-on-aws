// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');
AWS.config.logger = console;

const s3 = new AWS.S3();

/**
 * Copy Console assets and Container assets from source to destination buckets
 */
const copyAssets = async (srcBucket, srcPath, manifestFile, destBucket) => {
	try {
		// get file manifest from s3
		const getParams = {
			Bucket: srcBucket,
			Key:`${srcPath}/${manifestFile}`
		};

		const data = await s3.getObject(getParams).promise();
		const manifest = JSON.parse(data.Body);
		console.log('Manifest:', JSON.stringify(manifest, null, 2));

		// Loop through manifest and copy files to the destination bucket
		const response = await Promise.all(manifest.map(async (file) => {
			let copyParams = {
				Bucket: destBucket,
				CopySource: `${srcBucket}/${srcPath}/${file}`,
				Key: file
			};
			return s3.copyObject(copyParams).promise();
		}));
		console.log('file copied to s3: ', response);
	} catch (err) {
		throw err;
	}
	return 'success';
};

/**
 * generate the aws exports file containing cognito and API congig details.
 */
const configFile = async (file, destBucket) => {
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
	copyAssets: copyAssets,
	configFile: configFile
};