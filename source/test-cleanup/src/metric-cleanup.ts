// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { type Logger, METRICS_NAMESPACE } from "@amzn/dlt-common";
import { type CloudWatchClient, PutMetricDataCommand, StandardUnit } from "@aws-sdk/client-cloudwatch";
import {
  type CloudWatchLogsClient,
  DeleteMetricFilterCommand,
  DescribeMetricFiltersCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-cloudwatch-logs";

/**
 * The four metric filter suffixes created by the Task Runner dashboard logic.
 * Filter name format: `${taskCluster}-Ecs${suffix}-${testId}`
 */
const METRIC_FILTER_SUFFIXES = ["numVu", "numSucc", "numFail", "avgRt"] as const;

/** Parameters for {@link deleteMetricFilters}. */
export interface DeleteMetricFiltersParams {
  readonly cloudwatchLogs: CloudWatchLogsClient;
  readonly testId: string;
  readonly taskCluster: string;
  readonly ecsCloudWatchLogGroup: string;
  readonly logger: Logger;
}

/**
 * Deletes the four CloudWatch metric filters created for a load test.
 *
 * Filter names follow the pattern `${taskCluster}-Ecs${metric}-${testId}`
 * for metrics: numVu, numSucc, numFail, avgRt.
 *
 * {@link ResourceNotFoundException} is caught gracefully — the filter may
 * have already been deleted by another process or may not have been created
 * if the test failed early.
 */
export async function deleteMetricFilters(params: DeleteMetricFiltersParams): Promise<void> {
  const { cloudwatchLogs, testId, taskCluster, ecsCloudWatchLogGroup, logger } = params;

  for (const suffix of METRIC_FILTER_SUFFIXES) {
    const filterName = `${taskCluster}-Ecs${suffix}-${testId}`;
    logger.info("Deleting metric filter", { filterName });

    try {
      await cloudwatchLogs.send(
        new DeleteMetricFilterCommand({
          filterName,
          logGroupName: ecsCloudWatchLogGroup,
        })
      );
    } catch (error: unknown) {
      if (error instanceof ResourceNotFoundException) {
        logger.info("Metric filter not found — already deleted", { filterName });
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Failed to delete metric filter", { filterName, error: message });
    }
  }
}

/** Parameters for {@link publishMetricFilterCount}. */
export interface PublishMetricFilterCountParams {
  readonly cloudwatch: CloudWatchClient;
  readonly cloudwatchLogs: CloudWatchLogsClient;
  readonly ecsCloudWatchLogGroup: string;
  readonly logger: Logger;
}

/**
 * Counts remaining metric filters on the log group and publishes the count
 * as a CloudWatch custom metric. This enables monitoring of metric filter
 * accumulation across test runs.
 */
export async function publishMetricFilterCount(params: PublishMetricFilterCountParams): Promise<void> {
  const { cloudwatch, cloudwatchLogs, ecsCloudWatchLogGroup, logger } = params;

  try {
    let filterCount = 0;
    let nextToken: string | undefined;

    do {
      const response = await cloudwatchLogs.send(
        new DescribeMetricFiltersCommand({
          logGroupName: ecsCloudWatchLogGroup,
          nextToken,
        })
      );

      filterCount += response.metricFilters?.length ?? 0;
      nextToken = response.nextToken;
    } while (nextToken);

    await cloudwatch.send(
      new PutMetricDataCommand({
        Namespace: METRICS_NAMESPACE,
        MetricData: [
          {
            MetricName: "MetricFilterCount",
            Value: filterCount,
            Unit: StandardUnit.Count,
            Dimensions: [{ Name: "LogGroupName", Value: ecsCloudWatchLogGroup }],
          },
        ],
      })
    );

    logger.info("Published metric filter count", { filterCount, logGroupName: ecsCloudWatchLogGroup });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to publish metric filter count", { error: message });
  }
}
