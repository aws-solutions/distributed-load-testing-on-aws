// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require("aws-sdk");
const utils = require("solution-utils");
AWS.config.logger = console;
let options = {};
options = utils.getOptions(options);
const s3 = new AWS.S3(options);
const yaml = require("js-yaml");

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
    const data = await s3.getObject(getParams).promise();
    const template = yaml.load(data.Body.toString());

    //modify template mappings
    template.Mappings.Solution.Config.APIServicesLambdaRoleName = config.APIServicesLambdaRoleName;
    template.Mappings.Solution.Config.MainStackRegion = config.MainStackRegion;
    template.Mappings.Solution.Config.ScenariosS3Bucket = config.DestBucket;
    template.Mappings.Solution.Config.ResultsParserRoleName = config.ResultsParserRoleName;
    template.Mappings.Solution.Config.ScenariosTable = config.ScenariosTable;
    template.Mappings.Solution.Config.TaskRunnerRoleName = config.TaskRunnerRoleName;
    template.Mappings.Solution.Config.TaskCancelerRoleName = config.TaskCancelerRoleName;
    template.Mappings.Solution.Config.TaskStatusCheckerRoleName = config.TaskStatusCheckerRoleName;
    template.Mappings.Solution.Config.Uuid = config.Uuid;

    //convert back to yaml put object in destination bucket
    const modifiedTemplate = yaml.dump(template, { lineWidth: -1 });
    const putParams = {
      Bucket: config.DestBucket,
      Key: "regional-template/distributed-load-testing-on-aws-regional.template",
      Body: modifiedTemplate,
    };
    await s3.putObject(putParams).promise();
  } catch (err) {
    console.error(err);
    throw err;
  }
  return "success";
};

/**
 * Copy Console assets and Container assets from source to destination buckets
 */
const copyAssets = async (srcBucket, srcPath, manifestFile, destBucket) => {
  try {
    // get file manifest from s3
    const getParams = {
      Bucket: srcBucket,
      Key: `${srcPath}/${manifestFile}`,
    };

    const data = await s3.getObject(getParams).promise();
    const manifest = JSON.parse(data.Body);
    console.log("Manifest:", JSON.stringify(manifest, null, 2));

    // Loop through manifest and copy files to the destination bucket
    const response = await Promise.all(
      manifest.map(async (file) => {
        let copyParams = {
          Bucket: destBucket,
          CopySource: `${srcBucket}/${srcPath}/${file}`,
          Key: file,
        };
        return s3.copyObject(copyParams).promise();
      })
    );
    console.log("file copied to s3: ", response);
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
    await s3.putObject(params).promise();
  } catch (err) {
    console.error(err);
    throw err;
  }
  return "success";
};

module.exports = {
  copyAssets: copyAssets,
  configFile: configFile,
  putRegionalTemplate: putRegionalTemplate,
};
