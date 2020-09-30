// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const parser = require('./lib/parser/');
const metrics = require('./lib/metrics/');
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

exports.handler = async (event) => {
    console.log(JSON.stringify(event, null, 2));

    try {
        const { scenario, prefix } = event;
        const { testId } = scenario;
        const bucket = process.env.SCENARIOS_BUCKET;
        let totalDuration = 0;

        // Get the latest test result from S3
        const resultList = await s3.listObjectsV2({ Bucket: bucket, Prefix: `results/${testId}/${prefix}`}).promise();
        if (resultList.Contents) {
            const data = [];
            for (const content of resultList.Contents) {
                const parsedResult = await parser.results(content, testId);
                let duration = parseInt(parsedResult.duration);
                totalDuration += isNaN(duration) ? 0 : duration;

                data.push(parsedResult);
            }

            // Send anonymous metrics
            if (process.env.SEND_METRIC === 'Yes') {
                await metrics.send(totalDuration);
            }
            console.log('All Task Complete');

            //Parser final results and update dynamodb
            await parser.finalResults(testId, data);
        }
        return 'success';
	} catch (err) {
        console.error(err);
		throw err;
    }
};
