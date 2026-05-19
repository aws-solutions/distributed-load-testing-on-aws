// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { METRICS_NAMESPACE, type Logger } from "@amzn/dlt-common";
import type { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { PutDashboardCommand, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import type { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DescribeMetricFiltersCommand, PutMetricFilterCommand } from "@aws-sdk/client-cloudwatch-logs";

export interface CreateDashboardParams {
  readonly cloudwatch: CloudWatchClient;
  readonly cloudwatchLogs: CloudWatchLogsClient;
  readonly testId: string;
  readonly region: string;
  readonly ecsCloudWatchLogGroup: string;
  readonly taskCluster: string;
  readonly logger: Logger;
}

export interface PublishMetricFilterCountParams {
  readonly cloudwatch: CloudWatchClient;
  readonly cloudwatchLogs: CloudWatchLogsClient;
  readonly logGroupName: string;
  readonly logger: Logger;
}

interface MetricConfig {
  readonly key: string;
  readonly name: string;
  readonly stat: string;
  readonly x: number;
  readonly y: number;
}

const METRIC_CONFIGS: readonly MetricConfig[] = [
  { key: "numVu", name: "Virtual Users Activities", stat: "avg", x: 8, y: 0 },
  { key: "numSucc", name: "Success", stat: "sum", x: 0, y: 8 },
  { key: "numFail", name: "Failures", stat: "sum", x: 8, y: 8 },
  { key: "avgRt", name: "Average Response Time", stat: "avg", x: 0, y: 0 },
];

/**
 * Creates CloudWatch metric filters and a dashboard for live test monitoring.
 *
 * Ported from the legacy `createDashboard()` in `task-runner/index.js`.
 * Creates one metric filter per metric (numVu, numSucc, numFail, avgRt)
 * and a CloudWatch Logs Insights dashboard with 4 widgets.
 */
export async function createDashboard(params: CreateDashboardParams): Promise<void> {
  const { cloudwatch, cloudwatchLogs, testId, region, ecsCloudWatchLogGroup, taskCluster, logger } = params;

  logger.info("Creating CloudWatch metric filters and dashboard", { testId, region });

  const widgets = [];

  for (const metric of METRIC_CONFIGS) {
    const metricNameParam = `${testId}-${metric.key}`;

    // Create metric filter
    await cloudwatchLogs.send(
      new PutMetricFilterCommand({
        filterName: `${taskCluster}-Ecs${metric.key}-${testId}`,
        filterPattern: `[testId="${testId}", live, time, logType=INFO*, logTitle=Current*, numVu, vu, numSucc, succ, numFail, fail, avgRt, x]`,
        logGroupName: ecsCloudWatchLogGroup,
        metricTransformations: [
          {
            metricName: metricNameParam,
            metricNamespace: METRICS_NAMESPACE,
            metricValue: `$${metric.key}`,
          },
        ],
      })
    );

    // Build dashboard widget
    const query =
      `SOURCE '${ecsCloudWatchLogGroup}'` +
      `| limit 10000` +
      `| fields @logStream` +
      `| filter @message like /${testId}.*INFO: Current:/` +
      `| parse @message /^.*\\s(?<@numVu>\\d+)\\svu\\s(?<@numSucc>\\d+)\\ssucc\\s(?<@numFail>\\d+)\\sfail\\s(?<@avgRt>\\d*.\\d*).*$/` +
      `| stat ${metric.stat}(@${metric.key}) by bin(1s)`;

    widgets.push({
      type: "log",
      x: metric.x,
      y: metric.y,
      width: 8,
      height: 8,
      properties: {
        query,
        region,
        stacked: "false",
        title: metric.name,
        view: "timeSeries",
      },
    });
  }

  // Create dashboard
  await cloudwatch.send(
    new PutDashboardCommand({
      DashboardName: `EcsLoadTesting-${testId}-${region}`,
      DashboardBody: JSON.stringify({ widgets }),
    })
  );

  logger.info("Dashboard created", { dashboardName: `EcsLoadTesting-${testId}-${region}` });

  // Publish current metric filter count
  await publishMetricFilterCount({
    cloudwatch,
    cloudwatchLogs,
    logGroupName: ecsCloudWatchLogGroup,
    logger,
  });
}

/**
 * Publishes the current count of metric filters on a log group as a
 * CloudWatch metric. This helps track metric filter accumulation over time.
 *
 * Ported from the legacy `publishMetricFilterCount()` in `task-runner/index.js`.
 */
export async function publishMetricFilterCount(params: PublishMetricFilterCountParams): Promise<void> {
  const { cloudwatch, cloudwatchLogs, logGroupName, logger } = params;

  try {
    const metricFilters: unknown[] = [];
    let nextToken: string | undefined;

    do {
      const response = await cloudwatchLogs.send(new DescribeMetricFiltersCommand({ logGroupName, nextToken }));
      if (response.metricFilters) {
        metricFilters.push(...response.metricFilters);
      }
      nextToken = response.nextToken;
    } while (nextToken);

    await cloudwatch.send(
      new PutMetricDataCommand({
        Namespace: METRICS_NAMESPACE,
        MetricData: [
          {
            MetricName: "MetricFilterCount",
            Value: metricFilters.length,
            Dimensions: [{ Name: "LogGroupName", Value: logGroupName }],
          },
        ],
      })
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to publish metric filter count", { logGroupName, error: message });
  }
}
