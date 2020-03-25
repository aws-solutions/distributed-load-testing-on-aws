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

const parser = require('./lib/parser/');
const metrics = require('./lib/metrics/');


exports.handler = async (event) => {

    console.log(JSON.stringify(event, null, 2));

    try {

        const bucket = event.Records[0].s3.bucket.name;
        const key = event.Records[0].s3.object.key;
        const testId = key.split('/').slice(1, 2)[0];
        const uuid = key.split('/').slice(2, 3)[0].slice(0, -4);

        // Parse results from an individual task and update dynamodb 
        const results = await parser.results(bucket, key, uuid, testId);

        // Send anonymous metrics
        await metrics.send(results.duration);

        if (results.taskIds.length >= results.taskCount) {
            console.log('All Task Complete');
            // Parser final results and update dynamodb
            await parser.finalResults(testId);
        } else {
            console.log('tasks still running');
        }

    } catch (err) {
        throw err;
    }
    return 'success';
};
