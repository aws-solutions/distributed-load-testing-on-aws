// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { mockClient } from "aws-sdk-client-mock";
import { IoTDataPlaneClient, PublishCommand, type PublishCommandInput } from "@aws-sdk/client-iot-data-plane";

vi.mock("@amzn/dlt-common", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    appendKeys: vi.fn(),
  })),
  getAwsClientConfig: vi.fn(() => ({ region: "test-region-1" })),
  getRequiredEnv: vi.fn((name: string) => {
    const envMap: Record<string, string> = {
      AWS_REGION: "us-west-2",
      MAIN_REGION: "test-region-1",
      IOT_ENDPOINT: "https://test.endpoint",
      SOLUTION_ID: "SO0062",
      VERSION: "3.x.x",
    };
    return envMap[name] ?? `mock-${name}`;
  }),
}));

const iotMock = mockClient(IoTDataPlaneClient);
const gzipAsync = promisify(gzip);

async function makeEvent(payload: unknown) {
  const zipped = await gzipAsync(JSON.stringify(payload));
  return { awslogs: { data: Buffer.from(zipped).toString("base64") } };
}

function cwLogsPayload(logEvents: { message: string; timestamp?: number }[]) {
  return {
    messageType: "DATA_MESSAGE",
    owner: "123456789012",
    logGroup: "/ecs/load-tester",
    logStream: "ecs/load-tester/abc123",
    subscriptionFilters: ["filter"],
    logEvents: logEvents.map((e, i) => ({
      id: String(i),
      timestamp: e.timestamp ?? 1700000000000 + i * 1000,
      message: e.message,
    })),
  };
}

interface PublishedResult {
  topic: string | undefined;
  payload: Record<string, unknown[]>;
}

function parsePublished(): PublishedResult {
  const calls = iotMock.commandCalls(PublishCommand);
  expect(calls).toHaveLength(1);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length asserted above
  const input: PublishCommandInput = calls[0]!.args[0].input;
  return {
    topic: input.topic,
    payload: JSON.parse(Buffer.from(input.payload as Uint8Array).toString()) as Record<string, unknown[]>,
  };
}

// Minimal metric line: "{testId} ... {N} vu\t{N} succ\t{N} fail\t{N} avg rt ..."
function metricLine(testId: string, opts: { vu?: number; succ?: number; fail?: number; avgRt?: number } = {}) {
  const { vu = 10, succ = 5, fail = 0, avgRt = 1.0 } = opts;
  return `${testId} ${vu} vu\t${succ} succ\t${fail} fail\t${avgRt} avg rt`;
}

describe("real-time-data-publisher", () => {
  beforeEach(() => {
    iotMock.reset();
    iotMock.on(PublishCommand).resolves({});
  });

  // --- Happy path ---

  it("extracts metrics from a batch and publishes to the correct IoT topic", async () => {
    const event = await makeEvent(
      cwLogsPayload([
        { message: metricLine("testABC123", { vu: 100, succ: 58, fail: 0, avgRt: 3.631 }), timestamp: 1643834990117 },
        { message: metricLine("testABC123", { vu: 100, succ: 27, fail: 0, avgRt: 3.916 }), timestamp: 1643834991098 },
      ])
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { topic, payload } = parsePublished();
    expect(topic).toBe("dlt/testABC123");
    expect(payload["us-west-2"]).toEqual([
      { testId: "testABC123", vu: 100, succ: 58, fail: 0, avgRt: 3.631, timestamp: 1643834990000 },
      { testId: "testABC123", vu: 100, succ: 27, fail: 0, avgRt: 3.916, timestamp: 1643834991000 },
    ]);
  });

  it("handles a single log event", async () => {
    const event = await makeEvent(
      cwLogsPayload([
        { message: metricLine("singleEvt0", { vu: 1, succ: 1, fail: 0, avgRt: 0.5 }), timestamp: 1700000000499 },
      ])
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { topic, payload } = parsePublished();
    expect(topic).toBe("dlt/singleEvt0");
    expect(payload["us-west-2"]).toEqual([
      { testId: "singleEvt0", vu: 1, succ: 1, fail: 0, avgRt: 0.5, timestamp: 1700000000000 },
    ]);
  });

  // --- Edge cases: metric values ---

  it("handles zero values for all numeric fields", async () => {
    const event = await makeEvent(
      cwLogsPayload([{ message: metricLine("zeroVals00", { vu: 0, succ: 0, fail: 0, avgRt: 0.0 }) }])
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { payload } = parsePublished();
    const metrics = payload["us-west-2"] as Record<string, unknown>[];
    expect(metrics[0]).toMatchObject({ vu: 0, succ: 0, fail: 0, avgRt: 0 });
  });

  it("handles large numeric values at regex quantifier boundaries", async () => {
    const event = await makeEvent(
      cwLogsPayload([{ message: metricLine("bigNums001", { vu: 999999, succ: 999999, fail: 999999, avgRt: 999.999 }) }])
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { payload } = parsePublished();
    const metrics = payload["us-west-2"] as Record<string, unknown>[];
    expect(metrics[0]).toMatchObject({ vu: 999999, succ: 999999, fail: 999999, avgRt: 999.999 });
  });

  it("rounds timestamps to the nearest second", async () => {
    const event = await makeEvent(
      cwLogsPayload([{ message: metricLine("roundTs000"), timestamp: 1700000000999 }])
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { payload } = parsePublished();
    const metrics = payload["us-west-2"] as Record<string, unknown>[];
    expect(metrics[0]).toMatchObject({ timestamp: 1700000001000 });
  });

  // --- Mixed content: some lines parseable, some not ---

  it("skips unparseable lines and publishes only valid metrics", async () => {
    const event = await makeEvent(
      cwLogsPayload([
        { message: metricLine("mixedBatch") },
        { message: "some unrelated log output" },
        { message: metricLine("mixedBatch") },
        { message: "" },
      ])
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { payload } = parsePublished();
    expect(payload["us-west-2"]).toHaveLength(2);
  });

  it("does not publish when no log events contain valid metrics", async () => {
    const event = await makeEvent(
      cwLogsPayload([
        { message: "starting load test engine" },
        { message: "all threads started" },
        { message: "error: connection reset" },
      ])
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    expect(iotMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it("does not publish when logEvents array is empty", async () => {
    const event = await makeEvent(cwLogsPayload([]));

    const { handler } = await import("../src/index.js");
    await handler(event);

    expect(iotMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  // --- IoT topic routing ---

  it("uses the test ID from the first parseable line for the IoT topic", async () => {
    const event = await makeEvent(
      cwLogsPayload([
        { message: "not a metric line" },
        { message: metricLine("firstMatch") },
        { message: metricLine("firstMatch") },
      ])
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { topic } = parsePublished();
    expect(topic).toBe("dlt/firstMatch");
  });

  it("keys the payload by the Lambda's configured region", async () => {
    const event = await makeEvent(cwLogsPayload([{ message: metricLine("regionKey0") }]));

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { payload } = parsePublished();
    expect(payload["us-west-2"]).toBeDefined();
    expect(Object.keys(payload)).toHaveLength(1);
  });

  // --- Failure propagation ---

  it("propagates decompression errors", async () => {
    const badEvent = { awslogs: { data: Buffer.from("not-gzip-data").toString("base64") } };

    const { handler } = await import("../src/index.js");
    await expect(handler(badEvent)).rejects.toThrow();
  });

  it("propagates IoT publish failures to the caller", async () => {
    iotMock.reset();
    iotMock.on(PublishCommand).rejects(new Error("ServiceUnavailable"));

    const event = await makeEvent(cwLogsPayload([{ message: metricLine("failPub000") }]));

    const { handler } = await import("../src/index.js");
    await expect(handler(event)).rejects.toThrow("ServiceUnavailable");
  });

  // --- Partial match edge cases ---

  it("skips a line missing avg rt", async () => {
    const event = await makeEvent(
      cwLogsPayload([
        { message: "partial000 10 vu\t5 succ\t0 fail" },
        { message: metricLine("partial000") },
      ])
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { payload } = parsePublished();
    expect(payload["us-west-2"]).toHaveLength(1);
  });

  it("extracts the first match for each field, not values from later in the line", async () => {
    // Line has "2.5 avg rt" in the current section and "99.999 avg rt" later
    const event = await makeEvent(
      cwLogsPayload([
        { message: "firstVals0 50 vu\t20 succ\t3 fail\t2.5 avg rt\t99.999 avg rt", timestamp: 1700000000000 },
      ])
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { payload } = parsePublished();
    const metrics = payload["us-west-2"] as Record<string, unknown>[];
    expect(metrics[0]).toMatchObject({ vu: 50, succ: 20, fail: 3, avgRt: 2.5 });
  });
});
