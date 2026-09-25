// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { LIVE_DATA_FILTER_MARKER, LIVE_DATA_V1_SCHEMA, type LiveDataEvent, type LiveDataPoint } from "@amzn/dlt-common";

/** Per-bucket fields the runner provides; the emitter fills in the rest. */
export type LiveDataBucket = Omit<LiveDataEvent, "schema" | "testId" | "region">;

export interface LiveDataEmitter {
  emit(bucket: LiveDataBucket): void;
}

export interface CreateEmitterInput {
  readonly enabled: boolean;
  readonly testId: string;
  readonly region: string;
}

export function createLiveDataEmitter(input: CreateEmitterInput): LiveDataEmitter {
  if (!input.enabled) {
    // Live data disabled — emit is a no-op.
    return {
      emit() {
        /* no-op */
      },
    };
  }

  return {
    emit(bucket: LiveDataBucket): void {
      // _filter matches the existing CloudWatch Logs subscription filter so
      // live-data events reach the publisher Lambda without filter changes.
      const point: LiveDataPoint = {
        schema: LIVE_DATA_V1_SCHEMA,
        _filter: LIVE_DATA_FILTER_MARKER,
        testId: input.testId,
        region: input.region,
        timestamp: bucket.timestampMilliseconds,
        vu: bucket.virtualUsers,
        succ: bucket.successCount,
        fail: bucket.failureCount,
        avgRt: bucket.averageResponseTimeMilliseconds / 1000,
      };
      process.stdout.write(JSON.stringify(point) + "\n");
    },
  };
}
