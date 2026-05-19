// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperationalMetricEnvelope } from "../src/metrics.js";
import { OperationalMetricEvent, sendOperationalMetric } from "../src/metrics.js";

describe("sendOperationalMetric", () => {
  const envelope: OperationalMetricEnvelope = {
    solutionId: "SO0062",
    uuid: "test-uuid-123",
    version: "4.0.10",
    metricUrl: "https://metrics.example.com/endpoint",
    accountId: "123456789012",
    metricSchemaVersion: 1,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns status code on a successful POST", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendOperationalMetric(envelope, {
      Type: OperationalMetricEvent.RegionsReady,
      TestId: "test-1",
      TestRunId: "run-1",
      AllReady: true,
      SyncDelay: 0,
      RegionCount: 1,
    });

    expect(result).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("sends the correct payload from envelope params", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    const metricData = {
      Type: OperationalMetricEvent.RegionsReady as const,
      TestId: "test-1",
      TestRunId: "run-1",
      AllReady: true,
      SyncDelay: 1500,
      RegionCount: 3,
    };

    await sendOperationalMetric(envelope, metricData);

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://metrics.example.com/endpoint");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      Solution: "SO0062",
      UUID: "test-uuid-123",
      Version: "4.0.10",
      MetricSchemaVersion: 1,
      AccountId: "123456789012",
      Data: metricData,
    });
    expect(typeof Date.parse(body["TimeStamp"] as string)).toBe("number");
  });

  it("does not throw on network error", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendOperationalMetric(envelope, {
      Type: OperationalMetricEvent.TestCancel,
      TestId: "test-1",
    });

    expect(result).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("does not throw on non-Error rejection", async () => {
    const mockFetch = vi.fn().mockRejectedValue("string error");
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendOperationalMetric(envelope, {
      Type: OperationalMetricEvent.TestCancel,
      TestId: "test-1",
    });

    expect(result).toBeUndefined();
  });
});
