// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");

const utils = require("solution-utils");

const { MAIN_REGION, DDB_TABLE, AWS_REGION } = process.env;
let options = utils.getOptions({
  region: MAIN_REGION,
});
options = utils.getOptions(options);
const dynamoDB = DynamoDBDocument.from(new DynamoDB(options));

/**
 * generate the testing-resources config file containing the resource information for the remote region, stored in the scenario bucket.
 */
const testingResourcesConfigFile = async (config) => {
  try {
    // Write the testing-resources configs to DDB
    const ddbParams = {
      TableName: DDB_TABLE,
      Item: {
        testId: `region-${AWS_REGION}`,
        ecsCloudWatchLogGroup: config.ecsCloudWatchLogGroup,
        region: config.region,
        subnetA: config.subnetA,
        subnetB: config.subnetB,
        taskSecurityGroup: config.taskSecurityGroup,
        taskCluster: config.taskCluster,
        taskDefinition: config.taskDefinition,
        taskImage: config.taskImage,
      },
    };
    await dynamoDB.put(ddbParams);
    console.log("Testing infrastructure configuration stored successfully");
  } catch (err) {
    console.error(`There was an error creating the configuration: ${err}`);
    throw err;
  }
  return "success";
};

const delTestingResourcesConfigFile = async (config) => {
  try {
    const ddbParams = {
      TableName: DDB_TABLE,
      Item: {
        testId: `region-${AWS_REGION}`,
        ecsCloudWatchLogGroup: "",
        region: config.region,
        subnetA: "",
        subnetB: "",
        taskSecurityGroup: "",
        taskCluster: "",
        taskDefinition: "",
        taskImage: "",
      },
    };
    await dynamoDB.put(ddbParams);
    console.log(`Deleted DynamoDB region entry region-${AWS_REGION}`);
  } catch (err) {
    console.error(`There was an error deleting the configurations: ${err}`);
    throw err;
  }
  return "success";
};
module.exports = {
  delTestingResourcesConfigFile: delTestingResourcesConfigFile,
  testingResourcesConfigFile: testingResourcesConfigFile,
};
