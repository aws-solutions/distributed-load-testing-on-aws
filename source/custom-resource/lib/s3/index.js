// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { S3 } = require("@aws-sdk/client-s3");

const utils = require("solution-utils");

let options = utils.getOptions({});
const s3 = new S3(options);

/**
 * Copy regional template from source to destination bucket and modify mappings
 */
const putRegionalTemplate = async (config) => {
  try {
    //get file from S3 and convert from yaml
    const getParams = {
      Bucket: config.SrcBucket,
      Key: `${config.SrcPath}/distributed-load-testing-on-aws-regional.template`,
    };

    const templateJson = await s3.getObject(getParams);
    const template = JSON.parse(await templateJson.Body.transformToString());

    template.Mappings.Solution.Config.MainRegionLambdaTaskRoleArn = config.MainRegionLambdaTaskRoleArn;
    template.Mappings.Solution.Config.ScenariosTable = config.ScenariosTable;
    template.Mappings.Solution.Config.MainRegionStack = config.MainRegionStack;
    template.Mappings.Solution.Config.ScenariosBucket = config.DestBucket;

    const putParams = {
      Bucket: config.DestBucket,
      Key: "regional-template/distributed-load-testing-on-aws-regional.template",
      Body: JSON.stringify(template),
    };
    await s3.putObject(putParams);
  } catch (err) {
    console.error(err);
    throw err;
  }
  return "success";
};

/**
 * generate the aws exports file containing cognito and API config details.
 */
const configFile = async (file, destBucket) => {
  try {
    //write exports file to the console
    const params = {
      Bucket: destBucket,
      Key: "assets/aws_config.js",
      Body: file,
    };
    console.log(`creating config file: ${JSON.stringify(params)}`);
    await s3.putObject(params);
  } catch (err) {
    console.error(err);
    throw err;
  }
  return "success";
};

module.exports = {
  configFile: configFile,
  putRegionalTemplate: putRegionalTemplate,
};
