// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reduceK6KpiJson } from "../../src/results/k6-reducer.js";
import type { KpiResultContext } from "../../src/results/reduce-kpi-rows.js";

const CONTEXT: KpiResultContext = {
  testId: "test-123",
  taskId: "task-abc",
  region: "us-east-1",
  startedAt: new Date("2026-08-14T12:00:00.000Z"),
  endedAt: new Date("2026-08-14T12:01:40.000Z"),
  task: { vcpus: 2, memoryMiB: 4096, ecsDurationSeconds: 110 },
};

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "k6-reducer-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("reduceK6KpiJson", () => {
  it("reduces every result field from independent k6 metrics", async () => {
    const result = await reduce([
      point("vus", 4),
      point("http_reqs", 2, { name: "GET /items", status: "200" }),
      point("http_reqs", 1, { name: "GET /items", status: "0", error_code: "1100" }),
      point("http_req_failed", 1, { name: "GET /items" }),
      point("http_req_duration", 10, { name: "GET /items" }),
      point("http_req_duration", 20, { name: "GET /items" }),
      point("http_req_waiting", 4, { name: "GET /items" }),
      point("http_req_waiting", 8, { name: "GET /items" }),
      point("http_req_connecting", 1, { name: "GET /items" }),
      point("http_req_connecting", 3, { name: "GET /items" }),
      point("http_reqs", 1, { name: "POST /login", status: "500", error_code: "1300" }),
      point("http_req_failed", 1, { name: "POST /login" }),
      point("http_req_duration", 30, { name: "POST /login" }),
      point("http_req_waiting", 18, { name: "POST /login" }),
      point("http_req_connecting", 5, { name: "POST /login" }),
      point("data_received", 100),
      point("data_received", 50),
      point("vus", 9),
    ]);

    expect(result).toMatchObject({
      schema: "dlt.result.v1",
      testId: "test-123",
      taskId: "task-abc",
      region: "us-east-1",
      startTime: "2026-08-14T12:00:00.000Z",
      endTime: "2026-08-14T12:01:40.000Z",
      testDurationSeconds: 100,
      task: { vcpus: 2, memoryMiB: 4096, ecsDurationSeconds: 110 },
      summary: {
        label: "",
        successCount: 2,
        failureCount: 2,
        totalRequestCount: 4,
        concurrency: 9,
        totalBytesReceived: 150,
        averageResponseTimeMilliseconds: 20,
        averageLatencyMilliseconds: 10,
        averageConnectTimeMilliseconds: 3,
        minResponseTimeMilliseconds: 10,
        maxResponseTimeMilliseconds: 30,
        responseCodes: [
          { code: "1100", count: 1 },
          { code: "200", count: 2 },
          { code: "500", count: 1 },
        ],
      },
      labels: [
        {
          label: "GET /items",
          successCount: 2,
          failureCount: 1,
          totalRequestCount: 3,
          concurrency: 9,
          totalBytesReceived: 0,
          averageResponseTimeMilliseconds: 15,
          averageLatencyMilliseconds: 6,
          averageConnectTimeMilliseconds: 2,
          responseTimeStdDevMilliseconds: 5,
          minResponseTimeMilliseconds: 10,
          maxResponseTimeMilliseconds: 20,
          responseCodes: [
            { code: "1100", count: 1 },
            { code: "200", count: 2 },
          ],
        },
        {
          label: "POST /login",
          successCount: 0,
          failureCount: 1,
          totalRequestCount: 1,
          concurrency: 9,
          totalBytesReceived: 0,
          averageResponseTimeMilliseconds: 30,
          averageLatencyMilliseconds: 18,
          averageConnectTimeMilliseconds: 5,
          responseTimeStdDevMilliseconds: 0,
          minResponseTimeMilliseconds: 30,
          maxResponseTimeMilliseconds: 30,
          responseCodes: [{ code: "500", count: 1 }],
        },
      ],
      statistics: {
        summary: {
          requests: { total: 4, success: 2, failure: 2 },
          bytesReceived: 150,
          latency: { count: 3, meanUs: 20_000 },
          waitingTime: { count: 3, meanUs: 10_000 },
          connectTime: { count: 3, meanUs: 3_000 },
        },
      },
    });
    expect(result.summary.responseTimeStdDevMilliseconds).toBeCloseTo(Math.sqrt(200 / 3), 12);
    expectHistogramEstimate(result.summary.p50, 20);
    expectHistogramEstimate(result.labels[0]?.p50 ?? 0, 10);
  });

  it("keeps summary counts when optional system tags are disabled", async () => {
    const result = await reduce([
      point("http_reqs", 3, { name: "", group: "::checkout", scenario: "default" }),
      point("http_req_failed", 1, { name: "", group: "::checkout", scenario: "default" }),
      point("http_req_duration", 100),
      point("vus", 2),
    ]);

    expect(result.labels).toEqual([]);
    expect(result.statistics.labels).toEqual([]);
    expect(result.summary).toMatchObject({
      successCount: 2,
      failureCount: 1,
      totalRequestCount: 3,
      concurrency: 2,
      averageResponseTimeMilliseconds: 100,
      responseCodes: [{ code: "0", count: 3 }],
    });
  });

  it("uses failure metric values and clamps contradictory partial data", async () => {
    const result = await reduce([
      point("http_req_failed", 0, { name: "success" }),
      point("http_reqs", 2, { name: "success" }),
      point("http_req_failed", 2, { name: "partial" }),
      point("http_reqs", 1, { name: "partial" }),
    ]);

    expect(result.summary).toMatchObject({
      successCount: 1,
      failureCount: 2,
      totalRequestCount: 3,
    });
    expect(
      result.labels.map(({ label, successCount, failureCount, totalRequestCount }) => ({
        label,
        successCount,
        failureCount,
        totalRequestCount,
      }))
    ).toEqual([
      { label: "partial", successCount: 0, failureCount: 1, totalRequestCount: 1 },
      { label: "success", successCount: 2, failureCount: 0, totalRequestCount: 2 },
    ]);
  });

  it("does not create labels from failure metrics without requests", async () => {
    const result = await reduce([point("http_req_failed", 1, { name: "failure-only" })]);

    expect(result.labels).toEqual([]);
    expect(result.statistics.labels).toEqual([]);
  });

  it("prefers HTTP status, then network error code, then zero", async () => {
    const result = await reduce([
      point("http_reqs", 1, { status: "503", error_code: "1100" }),
      point("http_reqs", 1, { status: "0", error_code: "1100" }),
      point("http_reqs", 1, { status: " ", error_code: "1300" }),
      point("http_reqs", 1),
    ]);

    expect(result.summary.responseCodes).toEqual([
      { code: "0", count: 1 },
      { code: "1100", count: 1 },
      { code: "1300", count: 1 },
      { code: "503", count: 1 },
    ]);
  });

  it("ignores declarations, unknown metrics, and malformed or truncated lines", async () => {
    const result = await reduce([
      JSON.stringify({ type: "Metric", metric: "http_reqs", data: { type: "counter" } }),
      JSON.stringify({ type: "Point", metric: "custom_metric", data: { value: 99, tags: { name: "ignored" } } }),
      JSON.stringify({ type: "Point", metric: "http_reqs", data: { value: -1 } }),
      JSON.stringify({ type: "Point", metric: "http_reqs", data: { value: "1" } }),
      point("http_reqs", 0, { name: "zero-count", status: "200" }),
      point("http_reqs", 0.5, { name: "invalid-count" }),
      point("http_req_duration", 86_400_001, { name: "invalid-duration" }),
      point("data_received", 0.5),
      point("http_reqs", 1, { name: "kept", status: "200" }),
      '{"type":"Point"',
    ]);

    expect(result.summary.totalRequestCount).toBe(1);
    expect(result.statistics.summary).toMatchObject({
      bytesReceived: 0,
      latency: { count: 0 },
    });
    expect(result.labels.map((label) => label.label)).toEqual(["kept"]);
  });

  it("ignores malformed Unicode tags", async () => {
    const malformed = "\ud800";
    const result = await reduce([point("http_reqs", 1, { name: malformed, status: malformed, error_code: malformed })]);

    expect(result.summary).toMatchObject({
      totalRequestCount: 1,
      responseCodes: [{ code: "0", count: 1 }],
    });
    expect(result.labels).toEqual([]);
  });

  it("returns a zero result when the artifact is empty, missing, or unreadable", async () => {
    const results = await Promise.all([
      reduce([]),
      reduceK6KpiJson(join(testDir, "missing.json"), CONTEXT),
      reduceK6KpiJson(testDir, CONTEXT),
    ]);

    for (const result of results) {
      expect(result.summary).toEqual({
        label: "",
        successCount: 0,
        failureCount: 0,
        totalRequestCount: 0,
        concurrency: 0,
        totalBytesReceived: 0,
        averageResponseTimeMilliseconds: 0,
        averageLatencyMilliseconds: 0,
        averageConnectTimeMilliseconds: 0,
        responseTimeStdDevMilliseconds: 0,
        minResponseTimeMilliseconds: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        p99_9: 0,
        maxResponseTimeMilliseconds: 0,
        responseCodes: [],
      });
      expect(result.labels).toEqual([]);
    }
  });

  it("does not hide reducer errors", async () => {
    await expect(
      reduceK6KpiJson(join(testDir, "missing.json"), {
        ...CONTEXT,
        endedAt: new Date("invalid"),
      })
    ).rejects.toThrow(RangeError);
  });
});

function point(metric: string, value: number, tags?: Readonly<Record<string, string>>): string {
  return JSON.stringify({
    type: "Point",
    metric,
    data: {
      time: "2026-08-14T12:00:30.000Z",
      value,
      ...(tags === undefined ? {} : { tags }),
    },
  });
}

async function reduce(lines: readonly string[]) {
  const filePath = join(testDir, "kpi.json");
  await writeFile(filePath, lines.join("\n"));
  return reduceK6KpiJson(filePath, CONTEXT);
}

function expectHistogramEstimate(actual: number, expected: number): void {
  expect(actual).toBeGreaterThanOrEqual(expected * 0.995);
  expect(actual).toBeLessThanOrEqual(expected * 1.005);
}
