// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const moment = require('moment');
const parser = require('./lib/parser/');
const metrics = require('./lib/metrics/');
const AWS = require('aws-sdk');
const utils = require('solution-utils');
let options = {};
options = utils.getOptions(options);
const s3 = new AWS.S3(options);
const dynamoDb = new AWS.DynamoDB.DocumentClient(options);

exports.handler = async (event) => {
  console.log(JSON.stringify(event, null, 2));
  const { testId, fileType, prefix, testTaskConfig: eventConfigs } = event;

  try {
    const ddbParams = {
      TableName: process.env.SCENARIOS_TABLE,
      Key: {
        testId: testId
      },
      AttributesToGet: [
        'startTime',
        'status',
        'testTaskConfigs',
        'testType',
        'testScenario',
        'testDescription'
      ]
    };
    const ddbGetResponse = await dynamoDb.get(ddbParams).promise();
    const { startTime, testTaskConfigs, testType, testScenario, testDescription } = ddbGetResponse.Item;
    let { status } = ddbGetResponse.Item;
    const endTime = moment().utc().format('YYYY-MM-DD HH:mm:ss');
    let totalDuration = 0;
    let testResult = status;

    if (!['cancelling', 'cancelled', 'failed'].includes(status)) {
      const bucket = process.env.SCENARIOS_BUCKET;
      let resultList = [];
      let nextContinuationToken = undefined;

      // Get the latest test result from S3
      do {
        const params = {
          Bucket: bucket,
          Prefix: `results/${testId}/${prefix}`
        };

        if (nextContinuationToken) {
          params.ContinuationToken = nextContinuationToken;
        }
        const result = await s3.listObjectsV2(params).promise();
        resultList = resultList.concat(result.Contents);
        nextContinuationToken = result.IsTruncated ? result.NextContinuationToken : null;
      } while (nextContinuationToken);
      if (resultList.length > 0) {
        let aggregateData = [];
        const promises = {};

        //get all results files from test sorted by region
        for (const content of resultList) {
          //extract region from file name
          const regex = /\w+-\w+-\w+(?=.xml)/g;
          const fileRegion = content.Key.match(regex).pop();
          !(fileRegion in promises) && (promises[fileRegion] = []);
          promises[fileRegion].push(
            s3.getObject({
              Bucket: process.env.SCENARIOS_BUCKET,
              Key: content.Key
            }).promise()
          );
        }

        const finalResults = {};
        const completeTasks = {};
        let allMetrics = [];

        //Get results per region
        for (const eventConfig of eventConfigs) {
          const data = [];
          const result = await Promise.all(promises[eventConfig.region]);

          //parse each results file
          for (const content of result) {
            const parsedResult = parser.results(content.Body, testId);
            let duration = parseInt(parsedResult.duration);
            totalDuration += isNaN(duration) ? 0 : duration;
            data.push(parsedResult);
          }

          //record regional data
          completeTasks[eventConfig.region] = data.length;
          aggregateData = aggregateData.concat(data);

          // Parser final results for region
          finalResults[eventConfig.region] = await parser.finalResults(testId, data);

          //create widget image for region
          const { metricS3Location, metrics: taskMetrics } = await parser.createWidget(startTime, endTime, eventConfig.region, testId, []);
          finalResults[eventConfig.region].metricS3Location = metricS3Location;
          allMetrics = allMetrics.concat(taskMetrics);

          //delete regional metric filter
          await parser.deleteRegionalMetricFilter(testId, eventConfig.region, eventConfig.taskCluster, eventConfig.ecsCloudWatchLogGroup);
        }

        //parse aggregate final results
        finalResults['total'] = await parser.finalResults(testId, aggregateData);

        //create aggregate widget image
        const { metricS3Location: aggMetricS3Loc } = await parser.createWidget(startTime, endTime, 'total', testId, allMetrics);
        finalResults['total'].metricS3Location = aggMetricS3Loc;

        // Write test run data to history table
        status = 'complete';
        const historyParams = { status, testId, finalResults, startTime, endTime, testTaskConfigs, testScenario, testDescription, testType, completeTasks };
        await parser.putTestHistory(historyParams);

        //update dynamoDB table
        const updateTableParams = { status, testId, finalResults, endTime, completeTasks };
        await parser.updateTable(updateTableParams);
        testResult = 'completed';
      } else {
        // If there's no result files in S3 bucket, there's a possibility that the test failed in the Fargate tasks.
        await dynamoDb.update({
          TableName: process.env.SCENARIOS_TABLE,
          Key: { testId },
          UpdateExpression: 'set #s = :s, #e = :e',
          ExpressionAttributeNames: {
            '#s': 'status',
            '#e': 'errorReason'
          },
          ExpressionAttributeValues: {
            ':s': 'failed',
            ':e': 'Test might be failed to run.'
          }
        }).promise();
        testResult = 'failed';
      }
    }

    // Send anonymous metrics
    if (process.env.SEND_METRIC === 'Yes') {
      await metrics.send({ testType, totalDuration, fileType, testResult });
    }

    return 'success';
  } catch (error) {
    console.error(error);

    await dynamoDb.update({
      TableName: process.env.SCENARIOS_TABLE,
      Key: { testId },
      UpdateExpression: 'set #s = :s, #e = :e',
      ExpressionAttributeNames: {
        '#s': 'status',
        '#e': 'errorReason'
      },
      ExpressionAttributeValues: {
        ':s': 'failed',
        ':e': 'Failed to parse the results.'
      }
    }).promise();

    throw error;
  }
};
