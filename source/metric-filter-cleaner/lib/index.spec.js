// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const mockCloudWatchLogs = {
  deleteMetricFilter: jest.fn(),
  describeMetricFilters: jest.fn(),
};

const mockCloudWatch = {
  putMetricData: jest.fn(),
};

jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogs: jest.fn(() => mockCloudWatchLogs),
}));

jest.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatch: jest.fn(() => mockCloudWatch),
}));

const lambda = require('../index.js');

describe('Metric Filter Cleaner', () => {
  beforeEach(() => {
    mockCloudWatchLogs.deleteMetricFilter.mockReset();
    mockCloudWatchLogs.describeMetricFilters.mockReset();
    mockCloudWatch.putMetricData.mockReset();
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
  });

  it('Should successfully delete metric filters for single region', async () => {
    const event = {
      testId: 'test-123',
      testTaskConfig: [{
        region: 'us-east-1',
        taskCluster: 'test-cluster',
        ecsCloudWatchLogGroup: '/aws/ecs/test-log-group'
      }]
    };

    mockCloudWatchLogs.deleteMetricFilter.mockResolvedValue({});
    mockCloudWatchLogs.describeMetricFilters.mockResolvedValue({ metricFilters: [] });
    mockCloudWatch.putMetricData.mockResolvedValue({});

    const result = await lambda.handler(event);

    expect(result).toBe('Success');
    expect(mockCloudWatchLogs.deleteMetricFilter).toHaveBeenCalledTimes(4);
    expect(mockCloudWatchLogs.describeMetricFilters).toHaveBeenCalledTimes(1);
    expect(mockCloudWatch.putMetricData).toHaveBeenCalledTimes(1);
  });

  it('Should handle multiple regions', async () => {
    const event = {
      testId: 'test-456',
      testTaskConfig: [
        {
          region: 'us-east-1',
          taskCluster: 'cluster-1',
          ecsCloudWatchLogGroup: '/aws/ecs/log-1'
        },
        {
          region: 'us-west-2',
          taskCluster: 'cluster-2',
          ecsCloudWatchLogGroup: '/aws/ecs/log-2'
        }
      ]
    };

    mockCloudWatchLogs.deleteMetricFilter.mockResolvedValue({});
    mockCloudWatchLogs.describeMetricFilters.mockResolvedValue({ metricFilters: [] });
    mockCloudWatch.putMetricData.mockResolvedValue({});

    const result = await lambda.handler(event);

    expect(result).toBe('Success');
    expect(mockCloudWatchLogs.deleteMetricFilter).toHaveBeenCalledTimes(8);
  });

  it('Should handle ResourceNotFoundException gracefully', async () => {
    const event = {
      testId: 'test-789',
      testTaskConfig: [{
        region: 'us-east-1',
        taskCluster: 'test-cluster',
        ecsCloudWatchLogGroup: '/aws/ecs/test-log-group'
      }]
    };

    const notFoundError = new Error('Not found');
    notFoundError.name = 'ResourceNotFoundException';
    mockCloudWatchLogs.deleteMetricFilter.mockRejectedValue(notFoundError);
    mockCloudWatchLogs.describeMetricFilters.mockResolvedValue({ metricFilters: [] });
    mockCloudWatch.putMetricData.mockResolvedValue({});

    const result = await lambda.handler(event);

    expect(result).toBe('Success');
  });

  it('Should throw error when filter deletion fails with non-ResourceNotFoundException', async () => {
    const event = {
      testId: 'test-error',
      testTaskConfig: [{
        region: 'us-east-1',
        taskCluster: 'test-cluster',
        ecsCloudWatchLogGroup: '/aws/ecs/test-log-group'
      }]
    };

    mockCloudWatchLogs.deleteMetricFilter.mockRejectedValue(new Error('Access denied'));
    mockCloudWatchLogs.describeMetricFilters.mockResolvedValue({ metricFilters: [] });
    mockCloudWatch.putMetricData.mockResolvedValue({});

    await expect(lambda.handler(event)).rejects.toThrow('Cleanup completed with failures');
  });

  it('Should return error when missing testId', async () => {
    const event = {
      testTaskConfig: [{
        region: 'us-east-1',
        taskCluster: 'test-cluster',
        ecsCloudWatchLogGroup: '/aws/ecs/test-log-group'
      }]
    };

    const result = await lambda.handler(event);

    expect(result).toEqual({ statusCode: 400, message: 'Missing required parameters' });
  });

  it('Should return error when missing testTaskConfig', async () => {
    const event = {
      testId: 'test-123'
    };

    const result = await lambda.handler(event);

    expect(result).toEqual({ statusCode: 400, message: 'Missing required parameters' });
  });

  it('Should continue cleanup even if metric publishing fails', async () => {
    const event = {
      testId: 'test-publish-fail',
      testTaskConfig: [{
        region: 'us-east-1',
        taskCluster: 'test-cluster',
        ecsCloudWatchLogGroup: '/aws/ecs/test-log-group'
      }]
    };

    mockCloudWatchLogs.deleteMetricFilter.mockResolvedValue({});
    mockCloudWatchLogs.describeMetricFilters.mockRejectedValue(new Error('Describe failed'));
    mockCloudWatch.putMetricData.mockResolvedValue({});

    const result = await lambda.handler(event);

    expect(result).toBe('Success');
  });
});
