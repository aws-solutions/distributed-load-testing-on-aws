// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');
const parser = require('xml-js');
const moment = require('moment');
const shortid = require('shortid');

const s3 = new AWS.S3();
const dynamo = new AWS.DynamoDB.DocumentClient({
    region: process.env.AWS_REGION
});
const cloudwatch = new AWS.CloudWatch({
    region: process.env.AWS_REGION
});

/**
 * Parses test result XML from S3 to JSON, and return the result summary.
 * @param {object} content S3 list object content
 * @param {string} testId Test ID
 * @return {Promise<{ stats: object, endPoints: object[], duration: string }>} Test result from one task
 */
async function results(content, testId) {
    console.log(`Processing results, testId: ${testId}`);

    try {
        // Download xml result
        const s3GetObjectParam = {
            Bucket: process.env.SCENARIOS_BUCKET,
            Key: content.Key
        };
        const xmlFile = await s3.getObject(s3GetObjectParam).promise();
        const options = {
            nativeType: true,
            compact: true,
            ignoreAttributes: false
        };
        const json = parser.xml2js(xmlFile.Body, options);
        const jsonData = json.FinalStatus;
        let endPoints = [];
        let result = {};

        console.log(`xml to json: ${JSON.stringify(jsonData, null, 2)}`);

        // loop through results
        for (let i = 0; i < jsonData.Group.length; i++) {
            const group = jsonData.Group[i];
            const endpoint = group._attributes.label;
            let stats = {
                rc: []
            };

            // loop through group results
            for (let r in group) {
                if (r !== '_attributes' && r !== 'perc' && r !== 'rc') {
                    stats[r] = group[r].value._text;
                }
            }

            // loop through response codes, rc is a object for single responses array for multiple
            if (Array.isArray(group.rc)) {
                for (let j = 0; j < group.rc.length; j++) {
                    if (group.rc[j]._attributes.param !== '200') {
                        stats.rc.push({ code: group.rc[j]._attributes.param, count: group.rc[j].value._text });
                    }
                }
            } else {
                if (group.rc._attributes.param !== '200') {
                    stats.rc.push({ code: group.rc._attributes.param, count: group.rc._attributes.value });
                }
            }

            // loop through percentiles and rename/convert keys to strings
            for (let j = 0; j < group.perc.length; j++) {
                const perc = 'p' + group.perc[j]._attributes.param.replace('.', '_');
                stats[perc] = group.perc[j].value._text;
            }
            // check if the resuts are for the group (label '') or for a specific endpoint
            // label '' are the average results for all the endpoints.
            if (endpoint) {
                stats.endpoint = endpoint;
                endPoints.push(stats);
            } else {
                result = stats;
            }
        }
        result.testDuration = jsonData.TestDuration._text;

        return {
            stats: result,
            endPoints,
            duration: jsonData.TestDuration._text
        };
    } catch (error) {
        console.error(error);
        throw error;
    }
}

/**
 * Integrates the all test results and updates DynamoDB record
 * @param {string} testId Test ID
 * @param {object} data Test result data
 *
 */
 async function finalResults(testId, data) {
    console.log(`Parsing Final Results for ${testId}`);

    // function to return the average value of an array
    const getAvg = (array) => {
        if (array.length === 0) return 0;
        return array.reduce((a, b) => a + b, 0) / array.length;
    };

    const endTime = moment().utc().format('YYYY-MM-DD HH:mm:ss');
    let testFinalResults = {};
    let all = {
        "avg_ct": [],
        "avg_lt": [],
        "avg_rt": [],
        "bytes": [],
        "concurrency": [],
        "fail": [],
        "p0_0": [],
        "p100_0": [],
        "p50_0": [],
        "p90_0": [],
        "p95_0": [],
        "p99_0": [],
        "p99_9": [],
        "stdev_rt": [],
        "succ": [],
        "testDuration": [],
        "throughput": [],
        "rc": []
    };

    try {
        for (let result of data)  {
            const { stats } = result;
            for (let r in stats) {
                if (r !== 'rc') {
                    all[r].push(stats[r]);
                } else {
                    // response codes is a list of objects, adding objects to all list.
                    all.rc = all.rc.concat(stats.rc);
                }
            }
        }

        // find duplicates in response codes and sum count
        if (all.rc.length > 0) {
            all.rc = all.rc.reduce((accumulator, currentValue) => {
                const { count } = currentValue;
                currentValue.count = isNaN(parseInt(count)) ? 0 : parseInt(count);

                let existing = accumulator.find(acc => acc.code === currentValue.code);
                if (existing) {
                    existing.count += currentValue.count;
                } else {
                    accumulator.push(currentValue);
                }
                return accumulator;
            }, []);
        }

        // parse all of the results to generate the final results.
        for (let i in all) {
            switch (i) {
                case 'concurrency':
                case 'testDuration':
                case 'bytes':
                    testFinalResults[i] = getAvg(all[i]).toFixed(0);
                    break;
                case 'fail':
                case 'succ':
                case 'throughput':
                    testFinalResults[i] = all[i].reduce((a, b) => a + b);
                    break;
                case 'avg_ct':
                case 'avg_lt':
                case 'avg_rt':
                    testFinalResults[i] = getAvg(all[i]).toFixed(5);
                    break;
                case 'rc':
                    testFinalResults[i] = all[i];
                    break;
                default:
                    testFinalResults[i] = getAvg(all[i]).toFixed(3);
            }
        }
        console.log('Final Results: ',JSON.stringify(testFinalResults, null, 2));

        // get cloudwatch metrics image for the test.
        const ddbParams = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            AttributesToGet: [
                'startTime'
            ]
        };
        const ddbGetResponse = await dynamo.get(ddbParams).promise();
        console.log(JSON.stringify(ddbGetResponse, null, 2));

        const widget = {
            title: 'CloudWatch Metrics',
            width: 600,
            height: 395,
            metrics : [
               [
                   "distribuited-load-testing", "Avg Response Time",
                    {
                        color:'#FF9900',
                        label:'Avg Response Time'
                    }
                ]
            ],
            period: 10,
            stacked: true,
            stat: 'Average',
            view: 'timeSeries',
            start: new Date(ddbGetResponse.Item.startTime).toISOString(),
            end: new Date(endTime).toISOString()
        };
        const cwParams = {
            MetricWidget: JSON.stringify(widget)
        };
        console.log(widget);

        const image = await cloudwatch.getMetricWidgetImage(cwParams).promise();
        const metricWidgetImage = Buffer.from(image.MetricWidgetImage).toString('base64');

        // Update Scenarios Table with final results and history.
        const history = {
            id: shortid.generate(),
            startTime: ddbGetResponse.Item.startTime,
            endTime: endTime,
            results: testFinalResults
        };
        const ddbUpdateParams = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            UpdateExpression: 'set #r = :r, #t = :t, #i = :i, #s = :s, #h = list_append(if_not_exists(#h, :l), :h)',
            ExpressionAttributeNames: {
                '#r': 'results',
                '#t': 'endTime',
                '#i': 'metricWidgetImage',
                '#s': 'status',
                '#h': 'history'
            },
            ExpressionAttributeValues: {
                ':r': testFinalResults,
                ':t': endTime,
                ':i': metricWidgetImage,
                ':s': 'complete',
                ':h': [history],
                ':l': []
            },
            ReturnValues: 'ALL_NEW'
        };
        await dynamo.update(ddbUpdateParams).promise();

        return 'success';
    } catch (error) {
        throw error;
    }
}

module.exports = {
    results,
    finalResults
}