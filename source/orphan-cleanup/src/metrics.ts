// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * CloudWatch metrics for orphan cleanup — last line of defense against
 * leaked ECS services.
 *
 * Publishes a single metric: `OrphanCleanupFailures` — the number of
 * orphaned services that could not be deleted. This covers both individual
 * service deletion failures and handler-level errors (which emit the total
 * orphan count as the failure value, since none were cleaned up).
 *
 * A CloudWatch Alarm on `OrphanCleanupFailures > 0` with
 * `treatMissingData: BREACHING` ensures alerting when cleanup fails
 * or when the Lambda stops running entirely.
 */

import { METRICS_NAMESPACE, type Logger } from "@amzn/dlt-common";
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from "@aws-sdk/client-cloudwatch";

/** Metric name used by the CloudWatch Alarm for orphan cleanup failures. */
export const METRIC_ORPHAN_CLEANUP_FAILURES = "OrphanCleanupFailures";

/**
 * Publishes the count of orphaned services that failed to be deleted.
 *
 * A value of 0 means all orphans were successfully cleaned up (or none
 * were found). Any value > 0 should trigger an alarm.
 *
 * Failures to publish are logged but never thrown — metric publishing
 * must not cause the Lambda itself to fail.
 */
export async function publishFailureCount(cw: CloudWatchClient, failureCount: number, logger: Logger): Promise<void> {
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: METRICS_NAMESPACE,
        MetricData: [
          {
            MetricName: METRIC_ORPHAN_CLEANUP_FAILURES,
            Value: failureCount,
            Unit: StandardUnit.Count,
            Timestamp: new Date(),
          },
        ],
      })
    );

    logger.info("Published orphan cleanup failure metric", { failureCount });
  } catch (error: unknown) {
    // Last resort — if we can't publish, at least the log exists
    logger.error("Failed to publish orphan cleanup failure metric", { error, failureCount });
  }
}
