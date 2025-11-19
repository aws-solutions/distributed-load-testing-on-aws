// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { CloudWatchLogs } = require('@aws-sdk/client-cloudwatch-logs');
const { CloudWatch } = require('@aws-sdk/client-cloudwatch');

/**
 * Metric Filter Cleaner Lambda
 * Cleans up CloudWatch metric filters for completed/failed tests
 */
exports.handler = async (event) => {
    console.log('Metric Filter Cleaner started:', JSON.stringify(event, null, 2));
    
    const { testId, testTaskConfig } = event;
    
    if (!testId || !testTaskConfig) {
        console.error('Missing required parameters: testId or testTaskConfig');
        return { statusCode: 400, message: 'Missing required parameters' };
    }

    const allFailures = await cleanupAllRegions(testId, testTaskConfig);
    
    await publishMetricFilterCount(testTaskConfig);
    
    if (allFailures.length > 0) {
        const errorMessage = `Cleanup completed with failures: ${allFailures.join('; ')}`;
        console.error(errorMessage);
        throw new Error(errorMessage);
    }
    
    console.log('Cleanup completed successfully for test:', testId);
    
    return 'Success';
};

/**
 * Cleans up metric filters in all regions
 */
async function cleanupAllRegions(testId, testTaskConfig) {
    const allFailures = [];
    
    for (const config of testTaskConfig) {
        try {
            const regionFailures = await cleanupRegion(testId, config);
            if (regionFailures.length > 0) {
                allFailures.push(`Region ${config.region}: ${regionFailures.join(', ')}`);
            }
        } catch (regionError) {
            console.error(`Failed to initialize cleanup for region ${config.region}:`, regionError.message);
            allFailures.push(`Region ${config.region}: ${regionError.message}`);
        }
    }
    
    return allFailures;
}

/**
 * Cleans up metric filters in a single region
 */
async function cleanupRegion(testId, config) {
    const { region, taskCluster, ecsCloudWatchLogGroup } = config;
    const metrics = ["numVu", "numSucc", "numFail", "avgRt"];
    
    console.log(`Starting cleanup for test ${testId} in region ${region}`);
    console.log(`Log group: ${ecsCloudWatchLogGroup}, Cluster: ${taskCluster}`);
    
    const cloudwatchLogs = new CloudWatchLogs({ region });
    const regionFailures = [];
    
    for (const metric of metrics) {
        const failure = await deleteMetricFilter(cloudwatchLogs, metric, testId, config);
        if (failure) {
            regionFailures.push(failure);
        }
    }
    
    return regionFailures;
}

/**
 * Deletes a single metric filter
 */
async function deleteMetricFilter(cloudwatchLogs, metric, testId, config) {
    const { taskCluster, ecsCloudWatchLogGroup, region } = config;
    const filterName = `${taskCluster}-Ecs${metric}-${testId}`;
    
    try {
        await cloudwatchLogs.deleteMetricFilter({
            filterName,
            logGroupName: ecsCloudWatchLogGroup
        });
        
        console.log(`Deleted filter: ${filterName} from log group: ${ecsCloudWatchLogGroup} in region: ${region}`);
        return null;
    } catch (error) {
        return handleDeleteError(error, metric, ecsCloudWatchLogGroup, region);
    }
}

/**
 * Handles errors from metric filter deletion
 */
function handleDeleteError(error, metric, logGroup, region) {
    if (error.name === 'ResourceNotFoundException') {
        console.log(`Filter ${metric} not found in log group: ${logGroup} in region ${region} - already deleted`);
        return null;
    }
    
    console.error(`Failed to delete ${metric} filter from log group: ${logGroup} in region ${region}:`, error.message);
    return `${metric}: ${error.message}`;
}

/**
 * Publishes current metric filter count to CloudWatch
 */
async function publishMetricFilterCount(testTaskConfig) {
    for (const config of testTaskConfig) {
        try {
            await publishRegionMetricCount(config);
        } catch (error) {
            console.warn(`Failed to publish metric filter count for region ${config.region}:`, error.message);
        }
    }
}

/**
 * Publishes metric filter count for a single region
 */
async function publishRegionMetricCount(config) {
    const cloudwatchLogs = new CloudWatchLogs({ region: config.region });
    const cloudwatch = new CloudWatch({ region: config.region });
    
    const metricFilters = await getAllMetricFilters(cloudwatchLogs, config.ecsCloudWatchLogGroup);
    
    await cloudwatch.putMetricData({
        Namespace: 'distributed-load-testing',
        MetricData: [{
            MetricName: 'MetricFilterCount',
            Value: metricFilters.length,
            Dimensions: [{
                Name: 'LogGroupName',
                Value: config.ecsCloudWatchLogGroup
            }]
        }]
    });
    
    console.log(`Published metric filter count: ${metricFilters.length} for log group: ${config.ecsCloudWatchLogGroup}`);
}

/**
 * Gets all metric filters for a log group with pagination
 */
async function getAllMetricFilters(cloudwatchLogs, logGroupName) {
    let metricFilters = [];
    let params = { logGroupName };
    let response;
    
    do {
        response = await cloudwatchLogs.describeMetricFilters(params);
        metricFilters = metricFilters.concat(response.metricFilters);
        params.nextToken = response.nextToken;
    } while (response.nextToken);
    
    return metricFilters;
}