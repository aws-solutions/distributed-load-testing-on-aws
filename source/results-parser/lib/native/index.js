// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/** Adapts native dlt.result.v1 artifacts to the legacy results shape. */

const { ResultAccumulator, finalizeResultState } = require("@amzn/dlt-common/streaming-statistics");
const { acceptedCodes } = require("../parser/");

const DLT_RESULT_V1_SCHEMA = "dlt.result.v1";

/** Tasks report times in milliseconds, the stats we store are in seconds: 18.86 -> 0.01886. */
const toSeconds = (milliseconds) => milliseconds / 1000;

/** Removes successful and empty responses to match legacy output. */
function toResponseCodes(responseCodes) {
  return responseCodes.filter((entry) => entry.code !== "" && !acceptedCodes.includes(entry.code));
}

/** Converts a native aggregate to parser.finalResults() input. */
function toStats(aggregate, testDurationSeconds) {
  const stats = {
    avg_ct: toSeconds(aggregate.averageConnectTimeMilliseconds),
    avg_lt: toSeconds(aggregate.averageLatencyMilliseconds),
    avg_rt: toSeconds(aggregate.averageResponseTimeMilliseconds),
    bytes: aggregate.totalBytesReceived,
    concurrency: aggregate.concurrency,
    fail: aggregate.failureCount,
    p0_0: toSeconds(aggregate.minResponseTimeMilliseconds),
    p100_0: toSeconds(aggregate.maxResponseTimeMilliseconds),
    p50_0: toSeconds(aggregate.p50),
    p90_0: toSeconds(aggregate.p90),
    p95_0: toSeconds(aggregate.p95),
    p99_0: toSeconds(aggregate.p99),
    p99_9: toSeconds(aggregate.p99_9),
    stdev_rt: toSeconds(aggregate.responseTimeStdDevMilliseconds),
    succ: aggregate.successCount,
    throughput: aggregate.totalRequestCount,
    rc: toResponseCodes(aggregate.responseCodes),
  };

  if (testDurationSeconds !== undefined) stats.testDuration = testDurationSeconds;

  return stats;
}

function createAggregate() {
  return {
    accumulator: new ResultAccumulator(),
    taskCount: 0,
    durationSeconds: 0,
    summaryConcurrency: 0,
    labelConcurrency: new Map(),
  };
}

/** Checks envelope fields; ResultAccumulator validates statistics in addTask. */
function validateArtifact(artifact, expected) {
  if (!isObject(artifact)) throw new TypeError("Result artifact must be an object.");
  if (artifact.schema !== DLT_RESULT_V1_SCHEMA)
    throw new Error(`Unrecognized result artifact schema: ${artifact.schema}`);
  for (const [field, value] of Object.entries(expected)) {
    if (artifact[field] !== value) throw new TypeError(`${field} must match ${value}.`);
  }
  requireNonnegativeNumber(artifact.testDurationSeconds, "testDurationSeconds");

  if (!isObject(artifact.task)) throw new TypeError("task must be an object.");
  requirePositiveNumber(artifact.task.vcpus, "task.vcpus");
  requirePositiveNumber(artifact.task.memoryMiB, "task.memoryMiB");
  requireNonnegativeNumber(artifact.task.ecsDurationSeconds, "task.ecsDurationSeconds");

  const { statistics } = artifact;
  if (!Array.isArray(statistics?.labels)) throw new TypeError("statistics.labels must be an array.");

  if (!isObject(artifact.summary)) throw new TypeError("summary must be an object.");
  requireNonnegativeNumber(artifact.summary.concurrency, "summary.concurrency");
  if (!Array.isArray(artifact.labels)) throw new TypeError("labels must be an array.");

  const labelConcurrency = new Map();
  for (const label of artifact.labels) {
    if (!isObject(label) || typeof label.label !== "string" || labelConcurrency.has(label.label)) {
      throw new TypeError("Display labels must have unique string names.");
    }
    requireNonnegativeNumber(label.concurrency, `concurrency for label ${label.label}`);
    labelConcurrency.set(label.label, label.concurrency);
  }
  if (
    labelConcurrency.size !== statistics.labels.length ||
    statistics.labels.some(
      (label) => !isObject(label) || typeof label.label !== "string" || !labelConcurrency.has(label.label)
    )
  ) {
    throw new TypeError("Display labels must match statistics labels.");
  }

  return {
    statistics,
    testDurationSeconds: artifact.testDurationSeconds,
    summaryConcurrency: artifact.summary.concurrency,
    labelConcurrency,
    taskId: artifact.taskId,
    taskCPU: artifact.task.vcpus,
    taskMemory: artifact.task.memoryMiB,
    ecsDuration: artifact.task.ecsDurationSeconds,
  };
}

/** Validates and adds one task, returning its validated request count. */
function addTask(aggregate, task) {
  const requestCount = task.statistics?.summary?.requests?.total;
  if (requestCount === 0) {
    // Empty tasks must be validated, but must not create labels or dilute averages.
    new ResultAccumulator().merge(task.statistics);
    return 0;
  }

  aggregate.accumulator.merge(task.statistics);
  aggregate.taskCount += 1;
  aggregate.durationSeconds = addFinite(aggregate.durationSeconds, task.testDurationSeconds, "test duration");
  aggregate.summaryConcurrency = addFinite(
    aggregate.summaryConcurrency,
    task.summaryConcurrency,
    "summary concurrency"
  );
  for (const [label, concurrency] of task.labelConcurrency) {
    const current = aggregate.labelConcurrency.get(label) ?? { sum: 0, count: 0 };
    aggregate.labelConcurrency.set(label, {
      sum: addFinite(current.sum, concurrency, `concurrency for label ${label}`),
      count: current.count + 1,
    });
  }
  return requestCount;
}

/** Adds one completed region to total while preserving task-weighted averages. */
function addAggregate(aggregate, source) {
  aggregate.accumulator.merge(source.accumulator.snapshot());
  aggregate.taskCount += source.taskCount;
  aggregate.durationSeconds = addFinite(aggregate.durationSeconds, source.durationSeconds, "test duration");
  aggregate.summaryConcurrency = addFinite(
    aggregate.summaryConcurrency,
    source.summaryConcurrency,
    "summary concurrency"
  );
  for (const [label, value] of source.labelConcurrency) {
    const current = aggregate.labelConcurrency.get(label) ?? { sum: 0, count: 0 };
    aggregate.labelConcurrency.set(label, {
      sum: addFinite(current.sum, value.sum, `concurrency for label ${label}`),
      count: current.count + value.count,
    });
  }
}

function toMergedTaskResult(aggregate) {
  const labelConcurrency = new Map(
    Array.from(aggregate.labelConcurrency, ([label, value]) => [label, value.sum / value.count])
  );
  const display = finalizeResultState(aggregate.accumulator.snapshot(), {
    summaryConcurrency: aggregate.summaryConcurrency / aggregate.taskCount,
    labelConcurrency,
  });
  const duration = aggregate.durationSeconds / aggregate.taskCount;

  return {
    stats: toStats(display.summary, duration),
    labels: display.labels.map((label) => ({ ...toStats(label), label: label.label })),
    duration,
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonnegativeNumber(value, field) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite nonnegative number.`);
  }
}

function requirePositiveNumber(value, field) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${field} must be a finite positive number.`);
  }
}

function addFinite(left, right, field) {
  const sum = left + right;
  if (!Number.isFinite(sum)) throw new RangeError(`${field} exceeds the finite number range.`);
  return sum;
}

module.exports = {
  addAggregate,
  addTask,
  createAggregate,
  toMergedTaskResult,
  validateArtifact,
};
