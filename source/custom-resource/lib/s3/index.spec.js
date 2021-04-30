// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockS3 = jest.fn();
const mockAWS = require('aws-sdk');
mockAWS.S3 = jest.fn(() => ({
  getObject: mockS3,
  putObject: mockS3,
  copyObject: mockS3
}));
mockAWS.config = jest.fn(() => ({
	logger: Function
}));
process.env.SOLUTION_ID = 'SO0062';
process.env.VERSION = '1.3.0';
const lambda = require('./index.js');

describe('#S3::', () => {

	beforeEach(() => {
    mockS3.mockReset();
	});

  it('should return "success" on copyAssets sucess', async () => {

    const data = { Body: "[\"console/file1\",\"console/file2\"]" };
    mockS3.mockImplementationOnce(() => {
			return {
				promise() {
					// getObject
					return Promise.resolve(data);
				}
			};
    }).mockImplementation(() => {
			return {
				promise() {
					// copyObject
					return Promise.resolve({});
				}
			};
    });

    const response = await lambda.copyAssets('srcBucket', 'srcPath', 'manifestFile', 'destBucket');
    expect(response).toEqual('success');
	});

  it('should return "ERROR" on copyAssets failure', async () => {
    mockS3.mockImplementation(() => {
			return {
				promise() {
					// getObject
					return Promise.reject('ERROR');
				}
			};
    });

    try {
      await lambda.copyAssets('srcBucket', 'srcPath', 'manifestFile', 'destBucket');
    } catch (error) {
      expect(error).toEqual('ERROR');
    }
  });

  it('should return "success" on ConfigFile sucess', async () => {
    mockS3.mockImplementation(() => {
			return {
				promise() {
					// putObject
					return Promise.resolve();
				}
			};
    });

    const response = await lambda.configFile('file', 'destBucket')
    expect(response).toEqual('success');
	});

  it('should return "ERROR" on ConfigFile failure', async () => {
    mockS3.mockImplementation(() => {
			return {
				promise() {
					// putObject
					return Promise.reject('ERROR');
				}
			};
    });

    try {
      await lambda.configFile('file', 'destBucket');
    } catch (error) {
      expect(error).toEqual('ERROR');
    }
  });
});