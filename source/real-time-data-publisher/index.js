// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const zlib = require('zlib');
const util = require('util');
const unzip = util.promisify(zlib.gunzip);
const AWS = require("aws-sdk");
const solutionUtils = require('solution-utils');
const { MAIN_REGION, IOT_ENDPOINT } = process.env;
let options = {
  region: MAIN_REGION,
  endpoint: IOT_ENDPOINT
};
options = solutionUtils.getOptions(options);
const iot = new AWS.IotData(options);

exports.handler = async function (event) {
  const payload = Buffer.from(event.awslogs.data, 'base64');
  const aggregatedTestResultData = { [process.env.AWS_REGION]: [] };
  let testId = "";

  try {
    //decompress gzip data, convert to ascii string, and parse JSON
    const decompressedPayload = await unzip(payload);
    const jsonPayload = JSON.parse(decompressedPayload.toString('ascii'));
    console.log("Event Data:", JSON.stringify(jsonPayload, null, 2));

    //for each logItem, extract necessary information
    //i.e. testId, virtual users, avgRt, succ count, fail count, and timestamp
    for (const logItem of jsonPayload.logEvents) {
      const logString = logItem.message;
      const regex = /^\w+|\d+(\.\d+)?(?=\svu)|\d+(\.\d+)?(?=\ssucc)|\d+(\.\d+)?(?=\sfail)|\d+(\.\d+)?(?=\savg rt\s)/g;
      const keys = ["testId", "vu", "succ", "fail", "avgRt"];
      const extractedData = {};

      //Extract data and parse into JSON object using keys
      for (const [index, value] of (logString.match(regex)).entries()) {
        if (index > 0) {
          extractedData[keys[index]] = parseFloat(value, 10);
        } else {
          extractedData[keys[index]] = value;
        }
      }

      //get testId if not already received
      testId = testId || extractedData.testId;

      //add timestamp and push individual line data to aggregated data array
      extractedData.timestamp = Math.round(logItem.timestamp / 1000) * 1000;
      aggregatedTestResultData[process.env.AWS_REGION].push(extractedData);
    }
  } catch (error) {
    console.error("Error decompressing payload: ", error);
    throw error;
  }

  //publish to testId topic using endpoint in main region
  const params = {
    topic: `dlt/${testId}`,
    payload: JSON.stringify(aggregatedTestResultData),
  };
  try {
    await iot.publish(params).promise();
    console.log(`Successfully sent data to topic dlt/${testId}`);
  } catch (error) {
    console.error("Error publishing to IoT Topic: ", error);
    throw error;
  }
};