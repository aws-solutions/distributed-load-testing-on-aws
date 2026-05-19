// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { OperationalMetricData } from "@amzn/dlt-common";
import { sendOperationalMetric } from "@amzn/dlt-common";

/**
 * Event shape passed from the Step Function LambdaInvoke states.
 * All envelope fields are baked into the SFN payload at deploy time;
 * the `data` object carries the metric-specific fields.
 */
interface MetricsEmitterEvent {
  readonly solutionId: string;
  readonly uuid: string;
  readonly version: string;
  readonly metricUrl: string;
  readonly accountId: string;
  readonly metricSchemaVersion: number;
  readonly data: OperationalMetricData;
}

/**
 * Thin Lambda that forwards an operational metric to the solutions
 * metrics endpoint.
 */
export async function handler(event: MetricsEmitterEvent): Promise<void> {
  await sendOperationalMetric(
    {
      solutionId: event.solutionId,
      uuid: event.uuid,
      version: event.version,
      metricUrl: event.metricUrl,
      accountId: event.accountId,
      metricSchemaVersion: event.metricSchemaVersion,
    },
    event.data
  );
}
