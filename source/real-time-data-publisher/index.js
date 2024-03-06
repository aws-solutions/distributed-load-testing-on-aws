// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const zlib = require("zlib");
const util = require("util");
const unzip = util.promisify(zlib.gunzip);
const AWS = require("aws-sdk");
const solutionUtils = require("solution-utils");
const { MAIN_REGION, IOT_ENDPOINT } = process.env;
let options = {
  region: MAIN_REGION,
  endpoint: IOT_ENDPOINT,
};
options = solutionUtils.getOptions(options);
const iot = new AWS.IotData(options);

// Define a function to create the timeout promise
function createTimeoutPromise(timeout) {
  return new Promise((resolve) =>
    setTimeout(() => {
      resolve(true); // Resolve with a true value to indicate a timeout
    }, timeout)
  );
}

function regexMatchPromise(string, regex) {
  // Wrap the regular expression match in a promise
  return new Promise((resolve) => {
    const matched = string.match(regex);
    resolve(matched);
  });
}

exports.handler = async function (event) {
  const payload = Buffer.from(event.awslogs.data, "base64");
  const aggregatedTestResultData = { [process.env.AWS_REGION]: [] };
  let testId = "";

  try {
    //decompress gzip data, convert to ascii string, and parse JSON
    const decompressedPayload = await unzip(payload);
    const jsonPayload = JSON.parse(decompressedPayload.toString("ascii"));
    console.log("Event Data:", JSON.stringify(jsonPayload, null, 2));

    //for each logItem, extract necessary information
    //i.e. testId, virtual users, avgRt, succ count, fail count, and timestamp
    for (const logItem of jsonPayload.logEvents) {
      const logString = logItem.message;
      // Define individual regex patterns for each condition
      const wordPattern = /^\w+/;
      const vuPattern = /\d{1,6}(?=\svu)/;
      const succPattern = /\d{1,6}(?=\ssucc)/;
      const failPattern = /\d{1,6}(?=\sfail)/;
      const avgRTPattern = /\d{1,3}(\.\d{1,3})?(?=\savg rt\s)/;

      // Combine the patterns using the | (or) operator
      const regex = new RegExp(
        `${wordPattern.source}|${vuPattern.source}|${succPattern.source}|${failPattern.source}|${avgRTPattern.source}`,
        "g"
      );
      const keys = ["testId", "vu", "succ", "fail", "avgRt"];
      const extractedData = {};

      // Check if logString exceeds character limit
      if (logString.length > 250) {
        throw new Error("Log message exceeds character limit.");
      }

      // Apply a timeout for the regex match using Promise.race
      const raceResult = await Promise.race([createTimeoutPromise(5000), regexMatchPromise(logString, regex)]);

      if (raceResult === true) {
        console.info("Regex match timed out.");
        continue;
      }
      const matches = raceResult;

      //Extract data and parse into JSON object using keys
      for (const [index, value] of matches.entries()) {
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
