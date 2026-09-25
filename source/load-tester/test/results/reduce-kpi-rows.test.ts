// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Readable } from "node:stream";
import type { TaskMetadata } from "@amzn/dlt-common";
import { ResultAccumulator } from "@amzn/dlt-common/streaming-statistics";
import { describe, expect, it, vi } from "vitest";

import type { KpiResultContext, KpiRow } from "../../src/results/reduce-kpi-rows.js";
import { reduceKpiRows } from "../../src/results/reduce-kpi-rows.js";

const TASK: TaskMetadata = { vcpus: 2, memoryMiB: 4096, ecsDurationSeconds: 120 };

const CONTEXT: KpiResultContext = {
  testId: "abc123",
  taskId: "task-1",
  region: "us-east-1",
  startedAt: new Date("2026-07-30T00:00:00.000Z"),
  endedAt: new Date("2026-07-30T00:01:40.000Z"),
  task: TASK,
};

function row(overrides: Partial<KpiRow> = {}): KpiRow {
  return {
    timeStamp: 1_700_000_000_000,
    elapsed: 100,
    label: "GET /",
    responseCode: "200",
    success: true,
    bytes: 512,
    allThreads: 10,
    latency: 0,
    connect: 0,
    ...overrides,
  };
}

function stream(rows: readonly KpiRow[]): AsyncIterable<KpiRow> {
  return Readable.from(rows, { objectMode: true });
}

function failingStream(
  rows: readonly KpiRow[],
  error = new Error("input stream failed"),
  onReturn?: () => void
): AsyncIterable<KpiRow> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next(): Promise<IteratorResult<KpiRow>> {
          const value = rows[index];
          if (value !== undefined) {
            index += 1;
            return Promise.resolve({ done: false, value });
          }
          return Promise.reject(error);
        },
        return(): Promise<IteratorResult<KpiRow>> {
          onReturn?.();
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
}

describe("reduceKpiRows", () => {
  it("fills in the result file's top-level fields", async () => {
    const result = await reduceKpiRows(stream([row()]), CONTEXT);

    expect(result.schema).toBe("dlt.result.v1");
    expect(result.testId).toBe("abc123");
    expect(result.taskId).toBe("task-1");
    expect(result.region).toBe("us-east-1");
    expect(result.startTime).toBe("2026-07-30T00:00:00.000Z");
    expect(result.endTime).toBe("2026-07-30T00:01:40.000Z");
    expect(result.testDurationSeconds).toBe(100);
    expect(result.task).toEqual(TASK);
  });

  it("returns an all-zero summary and no labels for an empty stream", async () => {
    const result = await reduceKpiRows(stream([]), CONTEXT);

    expect(result.labels).toEqual([]);
    expect(result.summary.label).toBe("");
    expect(result.summary.totalRequestCount).toBe(0);
    expect(result.summary.successCount).toBe(0);
    expect(result.summary.failureCount).toBe(0);
    expect(result.summary.averageResponseTimeMilliseconds).toBe(0);
    expect(result.summary.averageLatencyMilliseconds).toBe(0);
    expect(result.summary.maxResponseTimeMilliseconds).toBe(0);
    expect(result.summary.responseCodes).toEqual([]);
  });

  it("reduces each row before requesting the next one", async () => {
    let firstRowWasReduced = false;
    const firstRow = row();
    Object.defineProperty(firstRow, "elapsed", {
      get() {
        firstRowWasReduced = true;
        return 100;
      },
    });

    const rows: AsyncIterable<KpiRow> = {
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          next(): Promise<IteratorResult<KpiRow>> {
            index += 1;
            if (index === 1) return Promise.resolve({ done: false, value: firstRow });
            if (index === 2) {
              expect(firstRowWasReduced).toBe(true);
              return Promise.resolve({ done: false, value: row({ elapsed: 200 }) });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };

    const result = await reduceKpiRows(rows, CONTEXT);

    expect(result.summary.totalRequestCount).toBe(2);
  });

  it("returns rows accumulated before the input stream fails", async () => {
    const onReturn = vi.fn();
    const result = await reduceKpiRows(
      failingStream(
        [
          row({ label: "GET /first", elapsed: 100, responseCode: "200" }),
          row({ label: "GET /second", elapsed: 300, responseCode: "503", success: false }),
        ],
        new Error("input stream failed"),
        onReturn
      ),
      CONTEXT
    );

    expect(onReturn).toHaveBeenCalledOnce();
    expect(result.summary.totalRequestCount).toBe(2);
    expect(result.summary.successCount).toBe(1);
    expect(result.summary.failureCount).toBe(1);
    expect(result.summary.averageResponseTimeMilliseconds).toBe(200);
    expect(result.labels.map((label) => label.label)).toEqual(["GET /first", "GET /second"]);
    expect(result.summary.responseCodes).toEqual([
      { code: "200", count: 1 },
      { code: "503", count: 1 },
    ]);
  });

  it("returns an empty result when the input stream fails before yielding a row", async () => {
    const result = await reduceKpiRows(failingStream([]), CONTEXT);

    expect(result.summary.totalRequestCount).toBe(0);
    expect(result.labels).toEqual([]);
  });

  it("propagates errors raised while reducing a yielded row", async () => {
    const onReturn = vi.fn();
    const brokenRow = row();
    Object.defineProperty(brokenRow, "elapsed", {
      get() {
        throw new Error("reducer implementation failed");
      },
    });

    await expect(reduceKpiRows(failingStream([brokenRow], new Error("unused"), onReturn), CONTEXT)).rejects.toThrow(
      /reducer implementation failed/
    );
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it("clamps testDurationSeconds at 0 when endedAt precedes startedAt", async () => {
    const result = await reduceKpiRows(stream([]), {
      ...CONTEXT,
      endedAt: new Date(CONTEXT.startedAt.getTime() - 5000),
    });

    expect(result.testDurationSeconds).toBe(0);
  });

  it("groups rows by label, with summary covering all of them", async () => {
    const result = await reduceKpiRows(
      stream([
        row({ label: "GET /", elapsed: 100 }),
        row({ label: "GET /", elapsed: 300 }),
        row({ label: "POST /login", elapsed: 200 }),
      ]),
      CONTEXT
    );

    expect(result.labels.map((l) => l.label).sort()).toEqual(["GET /", "POST /login"]);

    const get = result.labels.find((l) => l.label === "GET /");
    expect(get?.totalRequestCount).toBe(2);
    expect(get?.averageResponseTimeMilliseconds).toBe(200);

    const post = result.labels.find((l) => l.label === "POST /login");
    expect(post?.totalRequestCount).toBe(1);
    expect(post?.averageResponseTimeMilliseconds).toBe(200);

    expect(result.summary.totalRequestCount).toBe(3);
    expect(result.summary.averageResponseTimeMilliseconds).toBe(200);
  });

  it("keeps an empty label", async () => {
    const result = await reduceKpiRows(stream([row({ label: "" })]), CONTEXT);

    expect(result.labels.map((label) => label.label)).toEqual([""]);
    expect(result.summary.totalRequestCount).toBe(1);
  });

  it("counts successes and failures separately", async () => {
    const result = await reduceKpiRows(
      stream([row({ success: true }), row({ success: false }), row({ success: false })]),
      CONTEXT
    );

    expect(result.summary.successCount).toBe(1);
    expect(result.summary.failureCount).toBe(2);
    expect(result.summary.totalRequestCount).toBe(3);
  });

  it("sums bytes and takes the max observed concurrency", async () => {
    const result = await reduceKpiRows(
      stream([
        row({ bytes: 100, allThreads: 5 }),
        row({ bytes: 250, allThreads: 20 }),
        row({ bytes: 50, allThreads: 12 }),
      ]),
      CONTEXT
    );

    expect(result.summary.totalBytesReceived).toBe(400);
    expect(result.summary.concurrency).toBe(20);
  });

  it("counts response codes, including error names", async () => {
    const result = await reduceKpiRows(
      stream([
        row({ responseCode: "200" }),
        row({ responseCode: "200" }),
        row({ responseCode: "500" }),
        row({ responseCode: "ConnectionError", success: false }),
      ]),
      CONTEXT
    );

    expect([...result.summary.responseCodes].sort((a, b) => a.code.localeCompare(b.code))).toEqual([
      { code: "200", count: 2 },
      { code: "500", count: 1 },
      { code: "ConnectionError", count: 1 },
    ]);
  });

  it("computes min, max, average, stddev and percentiles for response times", async () => {
    const elapsedValues = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const result = await reduceKpiRows(stream(elapsedValues.map((elapsed) => row({ elapsed }))), CONTEXT);

    expect(result.summary.minResponseTimeMilliseconds).toBe(10);
    expect(result.summary.maxResponseTimeMilliseconds).toBe(100);
    expect(result.summary.averageResponseTimeMilliseconds).toBe(55);
    expectHistogramEstimate(result.summary.p50, 50);
    expectHistogramEstimate(result.summary.p90, 90);
    expect(result.summary.responseTimeStdDevMilliseconds).toBeCloseTo(28.7228, 3);
  });

  it("averages latency and connect over the sample count", async () => {
    const result = await reduceKpiRows(
      stream([row({ latency: 10, connect: 2 }), row({ latency: 30, connect: 4 }), row({ latency: 50, connect: 6 })]),
      CONTEXT
    );

    expect(result.summary.averageLatencyMilliseconds).toBe(30);
    expect(result.summary.averageConnectTimeMilliseconds).toBe(4);
  });

  it("reports 0 latency and connect time when the framework doesn't measure them", async () => {
    const result = await reduceKpiRows(stream([row(), row()]), CONTEXT);

    expect(result.summary.averageLatencyMilliseconds).toBe(0);
    expect(result.summary.averageConnectTimeMilliseconds).toBe(0);
  });

  it("emits states that merge with exact totals and weighted moments", async () => {
    const left = await reduceKpiRows(stream([row({ label: "/a", elapsed: 10, bytes: 100 })]), CONTEXT);
    const right = await reduceKpiRows(
      stream([row({ label: "/a", elapsed: 30, bytes: 100 }), row({ label: "/b", elapsed: 50, bytes: 100 })]),
      CONTEXT
    );
    const merged = new ResultAccumulator();
    merged.merge(left.statistics);
    merged.merge(right.statistics);

    expect(merged.snapshot().summary).toMatchObject({
      requests: { total: 3 },
      bytesReceived: 300,
      latency: { meanUs: 30_000 },
    });
  });
});

function expectHistogramEstimate(actual: number, expected: number): void {
  expect(actual).toBeGreaterThanOrEqual(expected * 0.995);
  expect(actual).toBeLessThanOrEqual(expected * 1.005);
}
