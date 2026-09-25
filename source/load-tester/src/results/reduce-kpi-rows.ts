// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Turns a stream of per-request rows into the result file this task uploads to
// S3, which the results-parser Lambda then reads.
//
// This works for any framework: each one converts its own output format into
// KpiRow objects and passes the stream here.
//
// Every row updates fixed-size histograms and running moments for Overall and
// its label. Memory depends on retained labels, not request count.

import type { DltResultV1, TaskMetadata } from "@amzn/dlt-common";
import { DLT_RESULT_V1_SCHEMA } from "@amzn/dlt-common";
import { finalizeResultState, ResultAccumulator } from "@amzn/dlt-common/streaming-statistics";

/** One request, in the shape this reducer needs. */
export interface KpiRow {
  /** When the request started, in unix milliseconds. */
  readonly timeStamp: number;
  /** How long the request took, in milliseconds. */
  readonly elapsed: number;
  /** The endpoint or transaction name. Rows are grouped by this. */
  readonly label: string;
  /** HTTP status code, or an error description if the request never got a response. */
  readonly responseCode: string;
  /** True if the request succeeded. */
  readonly success: boolean;
  /** Response body size in bytes. */
  readonly bytes: number;
  /** How many virtual users were active when this request ran. */
  readonly allThreads: number;
  /** Time to first byte, in milliseconds. 0 if the framework doesn't report it. */
  readonly latency: number;
  /** Time to open the connection, in milliseconds. 0 if the framework doesn't report it. */
  readonly connect: number;
}

export interface KpiResultContext {
  readonly testId: string;
  readonly taskId: string;
  readonly region: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly task: TaskMetadata;
}

export async function reduceKpiRows(rows: AsyncIterable<KpiRow>, context: KpiResultContext): Promise<DltResultV1> {
  const accumulator = new ResultAccumulator();
  const labelConcurrency = new Map<string, number>();
  let summaryConcurrency = 0;
  const iterator = rows[Symbol.asyncIterator]();

  for (;;) {
    let next: IteratorResult<KpiRow>;
    try {
      next = await iterator.next();
    } catch {
      // Preserve rows already reduced when an artifact stream fails. Keep row
      // processing outside this catch so reducer implementation errors reject.
      await closeInputIterator(iterator);
      break;
    }
    if (next.done) break;

    try {
      const row = next.value;
      const request = {
        label: row.label,
        success: row.success,
        responseCode: row.responseCode,
        bytes: row.bytes,
        latencyUs: millisecondsToMicroseconds(row.elapsed),
        waitingTimeUs: millisecondsToMicroseconds(row.latency),
        connectTimeUs: millisecondsToMicroseconds(row.connect),
      };
      accumulator.recordCompletedRequest(request);
      labelConcurrency.set(row.label, Math.max(labelConcurrency.get(row.label) ?? 0, row.allThreads));
      summaryConcurrency = Math.max(summaryConcurrency, row.allThreads);
    } catch (error) {
      await closeInputIterator(iterator);
      throw error;
    }
  }

  const statistics = accumulator.snapshot();
  const testDurationSeconds = Math.max(0, Math.round((context.endedAt.getTime() - context.startedAt.getTime()) / 1000));

  return {
    schema: DLT_RESULT_V1_SCHEMA,
    testId: context.testId,
    taskId: context.taskId,
    region: context.region,
    startTime: context.startedAt.toISOString(),
    endTime: context.endedAt.toISOString(),
    testDurationSeconds,
    task: context.task,
    ...finalizeResultState(statistics, { summaryConcurrency, labelConcurrency }),
    statistics,
  };
}

async function closeInputIterator(iterator: AsyncIterator<KpiRow>): Promise<void> {
  try {
    await iterator.return?.();
  } catch {
    // Cleanup failures are input-iterator failures too. Preserve partial
    // results, or the reducer error that caused cleanup.
  }
}

function millisecondsToMicroseconds(milliseconds: number): number {
  return Math.round(milliseconds * 1_000);
}
