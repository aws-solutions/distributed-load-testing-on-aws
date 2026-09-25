// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { LIVE_DATA_FILTER_MARKER, LIVE_DATA_V1_SCHEMA, parseLiveDataPoint } from "@amzn/dlt-common";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLiveDataEmitter } from "../../src/live-data/emitter.js";

type StdoutWriteSpy = MockInstance<typeof process.stdout.write>;

function writtenText(spy: StdoutWriteSpy): string {
  return spy.mock.calls
    .map((call) => {
      const chunk = call[0];
      return typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    })
    .join("");
}

const bucket = {
  timestampMilliseconds: 1735689600000,
  virtualUsers: 10,
  successCount: 137,
  failureCount: 3,
  averageResponseTimeMilliseconds: 45.666666666666664,
};

describe("createLiveDataEmitter", () => {
  let stdoutSpy: StdoutWriteSpy;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it("writes one newline-terminated JSON line the publisher can parse", () => {
    const emitter = createLiveDataEmitter({ enabled: true, testId: "abc123", region: "us-east-1" });
    emitter.emit(bucket);

    const text = writtenText(stdoutSpy);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.slice(0, -1)).not.toContain("\n");

    expect(parseLiveDataPoint(text)).toEqual({
      schema: LIVE_DATA_V1_SCHEMA,
      _filter: LIVE_DATA_FILTER_MARKER,
      testId: "abc123",
      region: "us-east-1",
      timestamp: 1735689600000,
      vu: 10,
      succ: 137,
      fail: 3,
      // Emitted in seconds; the publisher passes the value through unconverted.
      avgRt: bucket.averageResponseTimeMilliseconds / 1000,
    });
  });

  it("writes nothing when live data is disabled", () => {
    const emitter = createLiveDataEmitter({ enabled: false, testId: "abc123", region: "us-east-1" });
    emitter.emit(bucket);

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});

describe("sidecar.py", () => {
  it("emits the same filter marker as the TypeScript emitter", async () => {
    // The Python sidecar cannot import the shared constant, so assert its
    // literal matches. If this fails, the sidecar's lines will not reach the
    // publisher Lambda.
    const source = await readFile(join(import.meta.dirname, "../../src/locust/sidecar.py"), "utf8");

    expect(source).toContain(`"_filter": ${JSON.stringify(LIVE_DATA_FILTER_MARKER)}`);
    expect(source).toContain(`"schema": ${JSON.stringify(LIVE_DATA_V1_SCHEMA)}`);
  });
});
