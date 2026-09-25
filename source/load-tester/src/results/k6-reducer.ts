// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// k6 does not write one complete row for each request. Its JSON output is
// newline-delimited: Metric lines describe a metric, and Point lines contain
// one sample for one metric. There is no request ID we can use to join separate
// request, failure, timing, and byte samples back together.
//
// These are the upstream sources for the k6 1.5.0 version pinned in /k6.json:
// - JSON format: https://grafana.com/docs/k6/v1.5.x/results-output/real-time/json/
// - Metric meaning: https://grafana.com/docs/k6/v1.5.x/using-k6/metrics/reference/
// - Metric names and types: https://github.com/grafana/k6/blob/v1.5.0/metrics/builtin.go
//
// DltResultV1 is currently shaped around HTTP requests. This reducer supports
// HTTP request counts, failures, status/error codes, response time, time to
// first byte, and TCP connect time. It also reports run-wide received bytes and
// maximum active VUs. Other HTTP timings, checks, iterations, browser metrics,
// gRPC, WebSockets, and custom metrics are not included in DLT results today.
// Their samples remain untouched in the raw kpi.json artifact.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import type { DltResultV1, ResultAccumulatorState } from "@amzn/dlt-common";
import { DLT_RESULT_V1_SCHEMA } from "@amzn/dlt-common";
import { finalizeResultState, MAX_LATENCY_US, ResultAccumulator } from "@amzn/dlt-common/streaming-statistics";

import type { KpiResultContext } from "./reduce-kpi-rows.js";

export async function reduceK6KpiJson(kpiJsonPath: string, context: KpiResultContext): Promise<DltResultV1> {
  const state: ReductionState = {
    summary: new ResultAccumulator(),
    labels: new ResultAccumulator(),
    summaryFailureCount: 0,
    labelFailureCounts: new Map(),
    concurrency: 0,
  };

  for await (const line of readK6Lines(kpiJsonPath)) {
    const point = parsePoint(line);
    if (point === undefined) continue;
    accumulatePoint(state, point);
  }

  const statistics = snapshotState(state);
  const labelConcurrency = new Map(statistics.labels.map(({ label }) => [label, state.concurrency]));

  return {
    schema: DLT_RESULT_V1_SCHEMA,
    testId: context.testId,
    taskId: context.taskId,
    region: context.region,
    startTime: context.startedAt.toISOString(),
    endTime: context.endedAt.toISOString(),
    testDurationSeconds: Math.max(0, Math.round((context.endedAt.getTime() - context.startedAt.getTime()) / 1000)),
    task: context.task,
    ...finalizeResultState(statistics, { summaryConcurrency: state.concurrency, labelConcurrency }),
    statistics,
  };
}

interface ReductionState {
  // k6 can omit request names, so Overall and named labels cannot share one routing accumulator.
  readonly summary: ResultAccumulator;
  readonly labels: ResultAccumulator;
  summaryFailureCount: number;
  readonly labelFailureCounts: Map<string, number>;
  concurrency: number;
}

function accumulatePoint(state: ReductionState, point: K6Point): void {
  // Keep this as an explicit allowlist. A k6 Counter, Rate, Trend, or Gauge
  // describes how to aggregate a number, but not what that number means in a
  // DLT result. Supporting another protocol should start with its result
  // contract, then add the protocol's metrics here. For example, gRPC has a
  // duration metric without HTTP's count/failure pair, while WebSocket metrics
  // describe sessions and messages rather than requests. Ignoring a metric
  // here affects only DLT's result; it does not remove it from NDJSON.
  switch (point.metric) {
    case "http_reqs":
      accumulateRequest(state, point);
      break;
    case "http_req_failed":
      accumulateFailure(state, point);
      break;
    case "http_req_duration":
      accumulateDuration(state, point);
      break;
    case "http_req_waiting":
      accumulateWaitingTime(state, point);
      break;
    case "http_req_connecting":
      accumulateConnectTime(state, point);
      break;
    case "data_received":
      // k6 reports received bytes without a reliable request name. We keep the
      // exact run-wide total rather than presenting an approximation per label.
      if (Number.isSafeInteger(point.value)) state.summary.recordSummaryBytes(point.value);
      break;
    case "vus":
      // DLT's result contract asks for peak concurrency, not the last sample.
      state.concurrency = Math.max(state.concurrency, point.value);
      break;
  }
}

function accumulateDuration(state: ReductionState, point: K6Point): void {
  const valueUs = millisecondsToMicroseconds(point.value);
  if (valueUs === undefined) return;
  state.summary.recordLatency({ label: "", valueUs });
  if (point.name !== undefined && point.name !== "") state.labels.recordLatency({ label: point.name, valueUs });
}

function accumulateWaitingTime(state: ReductionState, point: K6Point): void {
  const valueUs = millisecondsToMicroseconds(point.value);
  if (valueUs === undefined) return;
  state.summary.recordWaitingTime({ label: "", valueUs });
  if (point.name !== undefined && point.name !== "") state.labels.recordWaitingTime({ label: point.name, valueUs });
}

function accumulateConnectTime(state: ReductionState, point: K6Point): void {
  const valueUs = millisecondsToMicroseconds(point.value);
  if (valueUs === undefined) return;
  state.summary.recordConnectTime({ label: "", valueUs });
  if (point.name !== undefined && point.name !== "") state.labels.recordConnectTime({ label: point.name, valueUs });
}

function accumulateRequest(state: ReductionState, point: K6Point): void {
  if (!Number.isSafeInteger(point.value) || point.value === 0) return;

  // The request Counter carries HTTP status, or an error_code when no response
  // reached the client. https://grafana.com/docs/k6/v1.5.x/javascript-api/error-codes/
  const status = point.status?.trim();
  const errorCode = point.errorCode?.trim();
  let code = errorCode === undefined || errorCode === "" ? "0" : errorCode;
  if (status !== undefined && status !== "" && status !== "0") code = status;

  state.summary.recordRequestCount({ label: "", count: point.value, responseCode: code });
  if (point.name !== undefined && point.name !== "") {
    state.labels.recordRequestCount({ label: point.name, count: point.value, responseCode: code });
  }
}

function accumulateFailure(state: ReductionState, point: K6Point): void {
  if (!Number.isSafeInteger(point.value)) return;

  // This Rate emits 0 for success and 1 for failure, so sum its samples.
  state.summaryFailureCount += point.value;
  if (point.name !== undefined && point.name !== "") {
    state.labelFailureCounts.set(point.name, (state.labelFailureCounts.get(point.name) ?? 0) + point.value);
  }
}

function snapshotState(state: ReductionState): ResultAccumulatorState {
  const summaryBeforeFailures = state.summary.snapshot();
  state.summary.recordFailureCount({
    label: "",
    count: Math.min(state.summaryFailureCount, summaryBeforeFailures.summary.requests.total),
  });

  const labelsBeforeFailures = state.labels.snapshot();
  const requestCounts = new Map(labelsBeforeFailures.labels.map(({ label, requests }) => [label, requests.total]));
  for (const [label, failureCount] of state.labelFailureCounts) {
    const requestCount = requestCounts.get(label) ?? 0;
    if (requestCount === 0) continue;
    state.labels.recordFailureCount({
      label,
      count: Math.min(failureCount, requestCount),
    });
  }

  const summary = state.summary.snapshot();
  const labels = state.labels.snapshot();
  return {
    histogramLayout: summary.histogramLayout,
    summary: summary.summary,
    labels: labels.labels,
  };
}

// The * lets this function yield one line at a time instead of loading the whole file.
async function* readK6Lines(filePath: string): AsyncGenerator<string> {
  try {
    const lines = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
    for await (const line of lines) yield line;
  } catch {
    // File errors end the input; reducer errors still propagate to the caller.
  }
}

interface K6Point {
  readonly metric: string;
  readonly value: number;
  readonly name?: string;
  readonly status?: string;
  readonly errorCode?: string;
}

function parsePoint(line: string): K6Point | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }

  const point = parsed as {
    readonly type?: unknown;
    readonly metric?: unknown;
    readonly data?: {
      readonly value?: unknown;
      readonly tags?: {
        readonly name?: unknown;
        readonly status?: unknown;
        readonly error_code?: unknown;
      };
    };
  } | null;
  const value = point?.data?.value;
  if (
    point?.type !== "Point" ||
    typeof point.metric !== "string" ||
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return undefined;
  }

  const tags = point.data?.tags;
  const name = wellFormedString(tags?.name);
  const status = wellFormedString(tags?.status);
  const errorCode = wellFormedString(tags?.error_code);
  return {
    metric: point.metric,
    value,
    ...(name === undefined ? {} : { name }),
    ...(status === undefined ? {} : { status }),
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

function wellFormedString(value: unknown): string | undefined {
  return typeof value === "string" && value.isWellFormed() ? value : undefined;
}

function millisecondsToMicroseconds(milliseconds: number): number | undefined {
  const microseconds = Math.round(milliseconds * 1_000);
  return Number.isSafeInteger(microseconds) && microseconds <= MAX_LATENCY_US ? microseconds : undefined;
}
