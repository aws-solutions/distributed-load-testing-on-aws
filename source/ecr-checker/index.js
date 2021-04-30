// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');
const { SOLUTION_ID, VERSION } = process.env; 
let options = {};
if (SOLUTION_ID && VERSION && SOLUTION_ID.trim() && VERSION.trim()) {
  options.customUserAgent = `AwsSolution/${SOLUTION_ID}/${VERSION}`;
}
const codeBuild = new AWS.CodeBuild(options);
const ecr = new AWS.ECR(options);
const dynamoDb = new AWS.DynamoDB.DocumentClient(options);
const { CODE_BUILD_PROJECT, ECR_REPOSITORY_NAME, SCENARIOS_TABLE } = process.env;

/**
 * AWS Lambda handler
 * @param {object} event AWS Lambda event object
 */
exports.handler = async (event) => {
  console.log(JSON.stringify(event, null, 2));
  const testId = event.scenario && event.scenario.testId;

  try {
    if (!testId) {
      throw {
        code: 'TestIdNotFound',
        message: 'The event object does not have scenario.testId.',
        statusCode: 400
      };
    }

    let isEcrReady = true;

    const params = {
      projectName: CODE_BUILD_PROJECT
    };

    // Check CodeBuild
    const projectsResponse = await codeBuild.listBuildsForProject(params).promise();
    const { ids } = projectsResponse;

    const buildsResponse = await codeBuild.batchGetBuilds({ ids: [ ids[0] ] }).promise();
    const { builds } = buildsResponse;
    const { buildStatus } = builds[0];

    // Check ECR
    const ecrImagesResponse = await ecr.describeImages({
      repositoryName: ECR_REPOSITORY_NAME,
      filter: { tagStatus: 'TAGGED' }
    }).promise();
    const { imageDetails } = ecrImagesResponse;

    /**
     * When the latest CodePipeline is succeeded, Amazon ECR is ready.
     * When the latest CodePipeline is not in progress (failed, stopped, and so on) and the latest ECR exists, Amazon ECR is ready.
     */
    isEcrReady = buildStatus === 'SUCCEEDED' || (buildStatus !== 'IN_PROGRESS' && imageDetails.length > 0);

    // When ECR is not ready and CodePipeline status is not IN_PROGRESS, throw an error.
    if (!isEcrReady && buildStatus !== 'IN_PROGRESS') {
      throw {
        code: 'ECRNotFound',
        message: 'The latest Amazon ECR is not found.',
        statusCode: 404
      };
    }

    return {
      ...event,
      ecrReady: isEcrReady
    };
  } catch (error) {
    console.error(error);

    // Update DynamoDB with Status FAILED and Error Message
    if (testId) {
      await dynamoDb.update({
        TableName: SCENARIOS_TABLE,
        Key: { testId },
        UpdateExpression: 'set #s = :s, #e = :e',
        ExpressionAttributeNames: {
          '#s': 'status',
          '#e': 'errorReason'
        },
        ExpressionAttributeValues: {
          ':s': 'failed',
          ':e': 'Failed to check ECR.'
        }
      }).promise();
    }

    throw error;
  }
}