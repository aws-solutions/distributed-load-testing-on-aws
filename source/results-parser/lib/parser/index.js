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
const moment = require('moment');
const shortid = require('shortid');
const stats = require('stats-lite');

/**
 * @function results
 * Description: dowloads json results from s3 and writes results to DynamoDB.
 * @bucket {string} s3 bucket extracted from the S3 event passed to lambda.
 * @key {string} s3 key for the json file extracted from the S3 event passed to lambda.
 * @uuid {string} the id of the individual task container.
 * @testId {string} the unique id of test scenario.
 */
const results = async (bucket, key, uuid, testId) => {

    console.log(`processing results, bucket:${bucket}, key:${key}, uuid:${uuid}, testId:${testId}`);

    const s3 = new AWS.S3();
    const dynamo = new AWS.DynamoDB.DocumentClient({
        region: process.env.AWS_REGION
    });

    let response;

    try {
        // Download json results
        let params = {
            Bucket: bucket,
            Key: key
        };
        const jsonFile = await s3.getObject(params).promise();
        const jsonData = JSON.parse('[' + jsonFile.Body.toString().replace(/\n/g, ',').slice(0, -1) + ']');

        const metrics = {};
        let firstTime;

        // Loop through records, gathering into metric arrays
        for (let record of jsonData) {
            if (record.type === 'Metric') {
                // Record is a metric definition
                metrics[record.data.name] = record.data;
                metrics[record.data.name].values = [];
            } else {
                // Record is a point value - add to a metric
                metrics[record.metric].values.push(record.data.value);
                if (!firstTime)
                    firstTime = record.data.time;
            }
        }
        const lastTime = jsonData[jsonData.length - 1].data.time;

        // Loop for metrics, computing counts, averages, percentiles, etc.
        const results = {};
        for (let name in metrics) {
            let metric = metrics[name];
            switch (metric.type) {
                case 'counter':
                    results[metric.name] = { type: 'counter', value: metric.values.reduce((t, v) => t += v) };
                    break;
                case 'gauge':
                    results[metric.name] = { type: 'gauge', value: metric.values[metric.values.length - 1] };
                    break;
                case 'rate':
                    results[metric.name] = { type: 'rate', value: metric.values.reduce((t, v) => t += v ? 1 : 0) / metric.values.length };
                    break;
                case 'trend':
                    results[metric.name] = {
                        type: 'trend',
                        min: metric.values.reduce((t, v) => v < t ? v : t),
                        max: metric.values.reduce((t, v) => v > t ? v : t),
                        avg: stats.mean(metric.values),
                        med: stats.median(metric.values),
                        p90: stats.percentile(metric.values, 0.9),
                        p95: stats.percentile(metric.values, 0.95)
                    };
                    break;
            }
        }
//        console.log('results=' + JSON.stringify(results, null, '    '));
        const testDuration = (Date.parse(lastTime) - Date.parse(firstTime)) / 1000;

        // Set TTL for DynamoDB entry so records expire after 7 days
        const ttlDel = moment().utc().add(7, 'days').format('YYYY-MM-DD HH:mm:ss.S');

        params = {
            TableName: process.env.RESULTS_TABLE,
            Key: {
                uuid: uuid
            },
            UpdateExpression: 'set #i=:i, #d=:d, #r=:r, #t=:t',
            ExpressionAttributeNames: {
                '#i': 'testId',
                '#d': 'testDuration',
                '#r': 'results',
                '#t': 'ttlDel'
            },
            ExpressionAttributeValues: {
                ':i': testId,
                ':d': testDuration,
                ':r': results,
                ':t': ttlDel
            },
        };
        await dynamo.update(params).promise();

        // Update the list of completed tasks, this is used to by the final Results
        // function to check to see if all the tasks have completed.
        params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            UpdateExpression: 'set #t = list_append(if_not_exists(#t, :l), :t)',
            ExpressionAttributeNames: {
                '#t': 'taskIds'
            },
            ExpressionAttributeValues: {
                ':t': [uuid],
                ':l': []
            },
            ReturnValues: 'ALL_NEW'
        };
        const data = await dynamo.update(params).promise();

        response = {
            duration: testDuration,
            taskCount: data.Attributes.taskCount,
            taskIds: data.Attributes.taskIds
        };
    } catch (err) {
        throw err;
    }
    return response;
};

/**
 * @function finalResults
 * Description: gets all of the results from the results table for a specific testId and
 * stores the average for each metric value (final results)
 * @testId {string} the unique id of test scenario.
 */
const finalResults = async (testId) => {

    console.log(`Parsing Final Results for ${testId}`);

    const dynamo = new AWS.DynamoDB.DocumentClient({
        region: process.env.AWS_REGION
    });

    const cloudwatch = new AWS.CloudWatch({
        region: process.env.AWS_REGION
    });

    const endTime = moment().utc().format('YYYY-MM-DD HH:mm:ss');

    try {
        // get all Items from the results table for the testId 
        let params = {
            TableName: process.env.RESULTS_TABLE,
            FilterExpression: 'testId = :id',
            ExpressionAttributeValues: {
                ':id': testId
            }
        };
        let data = await dynamo.scan(params).promise();

        // Combine all metrics fields into arrays and then get the aggregate for each metric
        let combined = {};
        for (let i in data.Items) {
            const results = data.Items[i].results;
            for (let name in results) {
                const metric = results[name];
                if (!combined[name])
                    combined[name] = { type: metric.type };
                for (let field in metric) {
                    if (field !== 'type') {
                        if (!combined[name][field])
                            combined[name][field] = [];
                        combined[name][field].push(metric[field])
                    }
                }
            }
        }
        let finalResults = {};
        for (let name in combined) {
            finalResults[name] = { type: combined[name].type };
            for (let field in combined[name]) {
                if (field !== 'type') {
                    switch (combined[name].type) {
                    case 'counter':
                        finalResults[name][field] = stats.sum(combined[name][field]);
                        break;
                    case 'gauge':
                        finalResults[name][field] = combined[name][field].reduce((t, v) => v > t ? v : t);  // max
                        break;
                    case 'rate':
                        finalResults[name][field] = stats.mean(combined[name][field]);
                        break;
                    case 'trend':
                        switch(field) {
                            case 'min':
                                finalResults[name][field] = combined[name][field].reduce((t, v) => v < t ? v : t);  // min
                                break;
                            case 'max':
                                finalResults[name][field] = combined[name][field].reduce((t, v) => v < t ? v : t);  // max
                                break;
                            case 'avg':
                                finalResults[name][field] = stats.mean(combined[name][field]);
                                break;
                            case 'med':
                            case 'p90':
                            case 'p95':
                                // TODO: Mathematically, this is meaningless (pun intended!) - maybe the median (or max) is more useful?
                                // See, for example, https://www.circonus.com/2018/11/the-problem-with-percentiles-aggregation-brings-aggravation/
                                finalResults[name][field] = stats.mean(combined[name][field]);
                                break;
                        }
                        break;
                    default:
                        finalResults[name][field] = stats.mean(combined[name][field]);
                    }
                }
            }
        }
//        console.log('Final Results: ', JSON.stringify(finalResults, null, 2));

        // Get Cloudwatch metrics image for the test.
        params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            AttributesToGet: [
                'startTime'
            ],
        };
        data = await dynamo.get(params).promise();
        console.log(JSON.stringify(data, null, 2))
        const widget = {
            title: 'CloudWatch Metrics',
            width: 600,
            height: 395,
            metrics: [
                [
                    "distributed-load-testing", "Avg Response Time",
                    {
                        color: '#FF9900',
                        label: 'Avg Response Time'
                    }
                ]
            ],

            period: 10,
            stacked: true,
            stat: 'Average',
            view: 'timeSeries',
            start: new Date(data.Item.startTime).toISOString(),
            end: new Date(endTime).toISOString()
        };
        params = {
            MetricWidget: JSON.stringify(widget)
        };
        console.log(widget);

        const image = await cloudwatch.getMetricWidgetImage(params).promise();
        const metricWidgetImage = Buffer.from(image.MetricWidgetImage).toString('base64');

        //Update Scenarios Table with final results.
        params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            UpdateExpression: 'set #r=:r, #t=:t, #i=:i',
            ExpressionAttributeNames: {
                '#r': 'results',
                '#t': 'endTime',
                '#i': 'metricWidgetImage'
            },
            ExpressionAttributeValues: {
                ':r': finalResults,
                ':t': endTime,
                ':i': metricWidgetImage
            },
            ReturnValues: 'ALL_NEW'
        };
        data = await dynamo.update(params).promise();

        // Update Scenarios Table with history
        const history = {
            id: shortid.generate(),
            startTime: data.Attributes.runTime,
            endTime: endTime,
            results: finalResults
        };
        params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            UpdateExpression: 'set #s = :s, #h = list_append(if_not_exists(#h, :l), :h)',

            ExpressionAttributeNames: {
                '#s': 'status',
                '#h': 'history'
            },
            ExpressionAttributeValues: {
                ':s': 'complete',
                ':h': [history],
                ':l': []
            },
            ReturnValues: 'ALL_NEW'
        };
        await dynamo.update(params).promise();

    } catch (err) {
        throw err;
    }
    return 'success';
};

module.exports = {
    results: results,
    finalResults: finalResults
};
