// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockAWS = require('aws-sdk');
const mockCodeBuild = {
  listBuildsForProject: jest.fn(),
  batchGetBuilds: jest.fn()
};
const mockEcr = {
  describeImages: jest.fn()
};
const mockDynamoDb = {
  update: jest.fn()
};
mockAWS.CodeBuild = jest.fn(() => ({
  listBuildsForProject: mockCodeBuild.listBuildsForProject,
  batchGetBuilds: mockCodeBuild.batchGetBuilds
}));
mockAWS.ECR = jest.fn(() => ({
  describeImages: mockEcr.describeImages
}));
mockAWS.DynamoDB.DocumentClient = jest.fn(() => ({
  update: mockDynamoDb.update
}));

process.env = {
  CODE_BUILD_PROJECT: 'mock-codebuild-project',
  ECR_REPOSITORY_NAME: 'mock-ecr-repository',
  SCENARIOS_TABLE: 'mock-scenario-table',
  SOLUTION_ID: 'SO0062',
  VERSION: '1.3.0'
};

const lambda = require('../index');
const event = {
  scenario: { testId: 'test' }
};

describe('ecr-checker', () => {
  beforeEach(() => {
    mockCodeBuild.listBuildsForProject.mockReset();
    mockCodeBuild.batchGetBuilds.mockReset();
    mockEcr.describeImages.mockReset();
  });

  it('should return true for ecrReady when the latest CodeBuild buildStatus is SUCCEEDED', async () => {
    mockCodeBuild.listBuildsForProject.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ ids: ['mock-project-id'] });
        }
      };
    });
    mockCodeBuild.batchGetBuilds.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({
            builds: [
              { buildStatus: 'SUCCEEDED' }
            ]
          });
        }
      };
    });
    mockEcr.describeImages.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({
            imageDetails: [
              { imageTags: ['latest'] }
            ]
          });
        }
      };
    });

    const response = await lambda.handler(event);
    expect(mockCodeBuild.listBuildsForProject).toHaveBeenCalledWith({ projectName: process.env.CODE_BUILD_PROJECT });
    expect(mockCodeBuild.batchGetBuilds).toHaveBeenCalledWith({ ids: ['mock-project-id'] });
    expect(mockEcr.describeImages).toHaveBeenCalledWith({ repositoryName: process.env.ECR_REPOSITORY_NAME, filter: { tagStatus: 'TAGGED' } });
    expect(response).toEqual({
      ...event,
      ecrReady: true
    });
  });
  it('should return false for ecrReady when the latest CodeBuild buildStatus is IN_PROGRESS', async () => {
    mockCodeBuild.listBuildsForProject.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ ids: ['mock-project-id'] });
        }
      };
    });
    mockCodeBuild.batchGetBuilds.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({
            builds: [
              { buildStatus: 'IN_PROGRESS' }
            ]
          });
        }
      };
    });
    mockEcr.describeImages.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({
            imageDetails: []
          });
        }
      };
    });

    const response = await lambda.handler(event);
    expect(mockCodeBuild.listBuildsForProject).toHaveBeenCalledWith({ projectName: process.env.CODE_BUILD_PROJECT });
    expect(mockCodeBuild.batchGetBuilds).toHaveBeenCalledWith({ ids: ['mock-project-id'] });
    expect(mockEcr.describeImages).toHaveBeenCalledWith({ repositoryName: process.env.ECR_REPOSITORY_NAME, filter: { tagStatus: 'TAGGED' } });
    expect(response).toEqual({
      ...event,
      ecrReady: false
    });
  });
  it('should return true for ecrReady when the latest CodeBuild buildStatus is STOPPED but the latest ECR exists', async () => {
    mockCodeBuild.listBuildsForProject.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ ids: ['mock-project-id'] });
        }
      };
    });
    mockCodeBuild.batchGetBuilds.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({
            builds: [
              { buildStatus: 'STOPPED' }
            ]
          });
        }
      };
    });
    mockEcr.describeImages.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({
            imageDetails: [
              { imageTags: ['latest'] }
            ]
          });
        }
      };
    });

    const response = await lambda.handler(event);
    expect(mockCodeBuild.listBuildsForProject).toHaveBeenCalledWith({ projectName: process.env.CODE_BUILD_PROJECT });
    expect(mockCodeBuild.batchGetBuilds).toHaveBeenCalledWith({ ids: ['mock-project-id'] });
    expect(mockEcr.describeImages).toHaveBeenCalledWith({ repositoryName: process.env.ECR_REPOSITORY_NAME, filter: { tagStatus: 'TAGGED' } });
    expect(response).toEqual({
      ...event,
      ecrReady: true
    });
  });
  it('should throw TestIdNotFound error when the event object does not have testId', async () => {
    try {
      await lambda.handler({});
    } catch (error) {
      expect(error).toEqual({
        code: 'TestIdNotFound',
        message: 'The event object does not have scenario.testId.',
        statusCode: 400
      });
    }
  });
  it('should throw ECRNotFound error when the latest CodeBuild buildStatus is not IN_PROGRESS and the latest ECR does not exist', async () => {
    mockCodeBuild.listBuildsForProject.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ ids: ['mock-project-id'] });
        }
      };
    });
    mockCodeBuild.batchGetBuilds.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({
            builds: [
              { buildStatus: 'FAILED' }
            ]
          });
        }
      };
    });
    mockEcr.describeImages.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({
            imageDetails: []
          });
        }
      };
    });
    mockDynamoDb.update.mockImplementation(() => {
      return {
        promise() {
          return Promise.resolve();
        }
      }
    });

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockCodeBuild.listBuildsForProject).toHaveBeenCalledWith({ projectName: process.env.CODE_BUILD_PROJECT });
      expect(mockCodeBuild.batchGetBuilds).toHaveBeenCalledWith({ ids: ['mock-project-id'] });
      expect(mockEcr.describeImages).toHaveBeenCalledWith({ repositoryName: process.env.ECR_REPOSITORY_NAME, filter: { tagStatus: 'TAGGED' } });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
            testId: event.scenario.testId
        },
        UpdateExpression: 'set #s = :s, #e = :e',
        ExpressionAttributeNames: {
            '#s': 'status',
            '#e': 'errorReason'
        },
        ExpressionAttributeValues: {
            ':s': 'failed',
            ':e': 'Failed to check ECR.'
        }
      });
      expect(error).toEqual({
        code: 'ECRNotFound',
        message: 'The latest Amazon ECR is not found.',
        statusCode: 404
      });
    }
  });
  it('should throw an error when CodeBuild.listBuildsForProject fails', async () => {
    mockCodeBuild.listBuildsForProject.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.reject('CodeBuild.listBuildsForProject failed');
        }
      };
    });
    mockDynamoDb.update.mockImplementation(() => {
      return {
        promise() {
          return Promise.resolve();
        }
      }
    });

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockCodeBuild.listBuildsForProject).toHaveBeenCalledWith({ projectName: process.env.CODE_BUILD_PROJECT });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.scenario.testId
        },
        UpdateExpression: 'set #s = :s, #e = :e',
        ExpressionAttributeNames: {
          '#s': 'status',
          '#e': 'errorReason'
        },
        ExpressionAttributeValues: {
          ':s': 'failed',
          ':e': 'Failed to check ECR.'
        }
      });
      expect(error).toEqual('CodeBuild.listBuildsForProject failed');
    }
  });
  it('should throw an error when CodeBuild.batchGetBuilds fails', async () => {
    mockCodeBuild.listBuildsForProject.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ ids: [] });
        }
      };
    });
    mockCodeBuild.batchGetBuilds.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.reject('CodeBuild.batchGetBuilds failed');
        }
      };
    });
    mockEcr.describeImages.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({
            imageDetails: []
          });
        }
      };
    });
    mockDynamoDb.update.mockImplementation(() => {
      return {
        promise() {
          return Promise.resolve();
        }
      }
    });

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockCodeBuild.listBuildsForProject).toHaveBeenCalledWith({ projectName: process.env.CODE_BUILD_PROJECT });
      expect(mockCodeBuild.batchGetBuilds).toHaveBeenCalledWith({ ids: [ undefined ] });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.scenario.testId
        },
        UpdateExpression: 'set #s = :s, #e = :e',
        ExpressionAttributeNames: {
          '#s': 'status',
          '#e': 'errorReason'
        },
        ExpressionAttributeValues: {
          ':s': 'failed',
          ':e': 'Failed to check ECR.'
        }
      });
      expect(error).toEqual('CodeBuild.batchGetBuilds failed');
    }
  });
  it('should throw an error when ECR.describeImages fails', async () => {
    mockCodeBuild.listBuildsForProject.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({ ids: ['mock-project-id'] });
        }
      };
    });
    mockCodeBuild.batchGetBuilds.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.resolve({
            builds: [
              { buildStatus: 'SUCCEEDED' }
            ]
          });
        }
      };
    });
    mockEcr.describeImages.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.reject('ECR.describeImages failed');
        }
      };
    });
    mockDynamoDb.update.mockImplementation(() => {
      return {
        promise() {
          return Promise.resolve();
        }
      }
    });

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockCodeBuild.listBuildsForProject).toHaveBeenCalledWith({ projectName: process.env.CODE_BUILD_PROJECT });
      expect(mockCodeBuild.batchGetBuilds).toHaveBeenCalledWith({ ids: ['mock-project-id'] });
      expect(mockEcr.describeImages).toHaveBeenCalledWith({ repositoryName: process.env.ECR_REPOSITORY_NAME, filter: { tagStatus: 'TAGGED' } });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.scenario.testId
        },
        UpdateExpression: 'set #s = :s, #e = :e',
        ExpressionAttributeNames: {
          '#s': 'status',
          '#e': 'errorReason'
        },
        ExpressionAttributeValues: {
          ':s': 'failed',
          ':e': 'Failed to check ECR.'
        }
      });
      expect(error).toEqual('ECR.describeImages failed');
    }
  });
  it('should throw an error when DynamoDB.DocumentClient.update fails and not update the DynamoDB', async () => {
    mockCodeBuild.listBuildsForProject.mockImplementationOnce(() => {
      return {
        promise() {
          return Promise.reject('CodeBuild.listBuildsForProject failed');
        }
      };
    });
    mockDynamoDb.update.mockImplementation(() => {
      return {
        promise() {
          return Promise.reject('DynamoDB.DocumentClient.update failed');
        }
      }
    });

    try {
      await lambda.handler(event);
    } catch (error) {
      expect(mockCodeBuild.listBuildsForProject).toHaveBeenCalledWith({ projectName: process.env.CODE_BUILD_PROJECT });
      expect(mockDynamoDb.update).toHaveBeenCalledWith({
        TableName: process.env.SCENARIOS_TABLE,
        Key: {
          testId: event.scenario.testId
        },
        UpdateExpression: 'set #s = :s, #e = :e',
        ExpressionAttributeNames: {
          '#s': 'status',
          '#e': 'errorReason'
        },
        ExpressionAttributeValues: {
          ':s': 'failed',
          ':e': 'Failed to check ECR.'
        }
      });
      expect(error).toEqual('DynamoDB.DocumentClient.update failed');
    }
  });
});