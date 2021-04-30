// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');
const parser = require('xml-js');
const moment = require('moment');
const shortid = require('shortid');
const { SOLUTION_ID, VERSION } = process.env; 
let options = {};
if (SOLUTION_ID && VERSION && SOLUTION_ID.trim() && VERSION.trim()) {
  options.customUserAgent = `AwsSolution/${SOLUTION_ID}/${VERSION}`;
}
options.region = process.env.AWS_REGION;
const dynamoDb = new AWS.DynamoDB.DocumentClient(options);
const cloudwatch = new AWS.CloudWatch(options);

/**
 * Parses test result XML from S3 to JSON, and return the result summary.
 * @param {object} content S3 object body - XML
 * @param {string} testId Test ID
 * @return {Promise<{ stats: object, labels: object[], duration: string }>} Test result from one task
 */
function results(content, testId) {
    console.log(`Processing results, testId: ${testId}`);

    try {
        const options = {
            nativeType: true,
            compact: true,
            ignoreAttributes: false
        };
        const json = parser.xml2js(content, options);
        const jsonData = json.FinalStatus;
        let labels = [];
        let result = {};

        console.log(`xml to json: ${JSON.stringify(jsonData, null, 2)}`);

        // loop through results
        for (let i = 0; i < jsonData.Group.length; i++) {
            const group = jsonData.Group[i];
            const label = group._attributes.label;
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
                        stats.rc.push({ code: group.rc[j]._attributes.param, count: parseInt(group.rc[j]._attributes.value) });
                    }
                }
            } else {
                if (group.rc._attributes.param !== '200') {
                    stats.rc.push({ code: group.rc._attributes.param, count: parseInt(group.rc._attributes.value) });
                }
            }

            // loop through percentiles and rename/convert keys to strings
            for (let j = 0; j < group.perc.length; j++) {
                const perc = 'p' + group.perc[j]._attributes.param.replace('.', '_');
                stats[perc] = group.perc[j].value._text;
            }
            // check if the resuts are for the group (label '') or for a specific label
            // label '' is the average results for all the labels.
            if (label) {
                stats.label = label;
                labels.push(stats);
            } else {
                result = stats;
            }
        }
        result.testDuration = jsonData.TestDuration._text;

        return {
            stats: result,
            labels,
            duration: jsonData.TestDuration._text
        };
    } catch (error) {
        console.error('results function error', error);
        throw error;
    }
}

/**
 * Integrates the all test results and updates DynamoDB record
 * @param {string} testId Test ID
 * @param {object} data Test result data
 * @param {string} startTime Test start time
 */
 async function finalResults(testId, data, startTime) {
    console.log(`Parsing Final Results for ${testId}`);

    /**
     * Retruns the average value of an array.
     * @param {number[]} array Number array to get the average value
     * @return {number} Average number of the numbers in the array
     */
    const getAvg = (array) => {
        if (array.length === 0) return 0;
        return array.reduce((a, b) => a + b, 0) / array.length;
    };

    /**
     * Returns the summarized response codes and sum count.
     * @param {object[]} array Response code object array which includes { code: string, count: number|string } objects
     * @return {object[]} Summarized response codes and sum count
     */
    const getReducedResponceCodes = (array) => {
        return array.reduce((accumulator, currentValue) => {
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
    };

    /**
     * Aggregates the all results from Taurus to one result object.
     * @param {object} stats Stats object which includes all the results from Taurus
     * @param {object} result Result object which aggregates the same key values into
     */
    const createAggregatedData = (stats, result) => {
        for (let key in stats) {
            if (key === 'label') {
                result.label = stats[key];
            } else if (key === 'rc') {
                result.rc = result.rc.concat(stats.rc);
            } else {
                result[key].push(stats[key]);
            }
        }
    };

    /**
     * Created the final results
     * @param {object} source Aggregated Taurus results
     * @param {object} result Summarized final results
     */
    const createFinalResults = (source, result) => {
        for (let key in source) {
            switch (key) {
                case 'label':
                case 'labels':
                case 'rc':
                    result[key] = source[key];
                    break;
                case 'fail':
                case 'succ':
                case 'throughput':
                    result[key] = source[key].reduce((a, b) => a + b);
                    break;
                case 'bytes':
                case 'concurrency':
                case 'testDuration':
                    result[key] = getAvg(source[key]).toFixed(0);
                    break;
                case 'avg_ct':
                case 'avg_lt':
                case 'avg_rt':
                    result[key] = getAvg(source[key]).toFixed(5);
                    break;
                default:
                    result[key] = getAvg(source[key]).toFixed(3);
            }
        }
    };

    const endTime = moment().utc().format('YYYY-MM-DD HH:mm:ss');
    let testFinalResults = {};
    let all = {
        avg_ct: [],
        avg_lt: [],
        avg_rt: [],
        bytes: [],
        concurrency: [],
        fail: [],
        p0_0: [],
        p100_0: [],
        p50_0: [],
        p90_0: [],
        p95_0: [],
        p99_0: [],
        p99_9: [],
        stdev_rt: [],
        succ: [],
        testDuration: [],
        throughput: [],
        rc: [],
        labels: []
    };

    try {
        for (let result of data)  {
            const { labels, stats } = result;
            createAggregatedData(stats, all);

            // Sub results if any
            if (labels.length > 0) {
                all.labels = all.labels.concat(labels);
            }
        }

        // find duplicates in response codes and sum count
        if (all.rc.length > 0) {
            all.rc = getReducedResponceCodes(all.rc);
        }

        // summarize the test result per label
        if (all.labels.length > 0) {
            let set = new Set();
            let labels = [];

            for (let label of all.labels) {
                set.add(label.label);
            }

            for (let label of set.keys()) {
                let labelTestFinalResults = {};
                let labelAll = {
                    avg_ct: [],
                    avg_lt: [],
                    avg_rt: [],
                    bytes: [],
                    concurrency: [],
                    fail: [],
                    label: '',
                    p0_0: [],
                    p100_0: [],
                    p50_0: [],
                    p90_0: [],
                    p95_0: [],
                    p99_0: [],
                    p99_9: [],
                    stdev_rt: [],
                    succ: [],
                    testDuration: [],
                    throughput: [],
                    rc: []
                };

                const labelStats = all.labels.filter((stats) => stats.label === label);
                for (let stat of labelStats) {
                    createAggregatedData(stat, labelAll);
                }

                // find duplicates in response codes and sum count
                if (labelAll.rc.length > 0) {
                    labelAll.rc = getReducedResponceCodes(labelAll.rc);
                }

                // parse all of the results to generate the final results.
                createFinalResults(labelAll, labelTestFinalResults);
                labels.push(labelTestFinalResults);
            }

            all.labels = labels;
        }

        // parse all of the results to generate the final results.
        createFinalResults(all, testFinalResults);
        console.log('Final Results: ',JSON.stringify(testFinalResults, null, 2));

        const widget = {
            title: 'CloudWatch Metrics',
            width: 600,
            height: 395,
            metrics : [
                [
                   "distributed-load-testing", `${testId}-avgRt`,
                    {
                        color:'#FF9900',
                        label:'Avg Response Time'
                    }
                ],
                [
                    ".", `${testId}-numVu`, 
                    {
                        "color": "#1f77b4",
                        "yAxis": "right", 
                        "stat": "Sum", 
                        "label": "Virtual Users"
                    }
                ],
                [
                    ".", `${testId}-numSucc`, 
                    {
                        "color": "#2CA02C",
                        "yAxis": "right", 
                        "stat": "Sum", 
                        "label": "Succcess"
                    }
                ],
                [
                    ".", `${testId}-numFail`, 
                    {
                        "color": "#D62728",
                        "yAxis": "right", 
                        "stat": "Sum", 
                        "label": "Failures"
                    }
                ]
            ],
            period: 10,
            yAxis: {
                "left": {
                    "showUnits": false,
                    "label": "Seconds"
                },
                "right": {
                    "showUnits": false,
                    "label": "Total"
                }
            },
            stat: 'Average',
            view: 'timeSeries',
            start: new Date(startTime).toISOString(),
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
            startTime,
            endTime,
            results: testFinalResults
        };
        const ddbUpdateParams = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            UpdateExpression: 'set #r = :r, #t = :t, #i = :i, #s = :s, #h = list_append(if_not_exists(#h, :l), :h), #ct = :ct',
            ExpressionAttributeNames: {
                '#r': 'results',
                '#t': 'endTime',
                '#i': 'metricWidgetImage',
                '#s': 'status',
                '#h': 'history',
                '#ct': 'completeTasks'
            },
            ExpressionAttributeValues: {
                ':r': testFinalResults,
                ':t': endTime,
                ':i': metricWidgetImage,
                ':s': 'complete',
                ':h': [history],
                ':l': [],
                ':ct': data.length
            },
            ReturnValues: 'ALL_NEW'
        };
        await dynamoDb.update(ddbUpdateParams).promise();

        return testFinalResults;
    } catch (error) {
        console.error('finalResults function error', error);
        throw error;
    }
}

module.exports = {
    results,
    finalResults
}