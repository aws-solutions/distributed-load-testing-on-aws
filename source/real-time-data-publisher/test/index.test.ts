// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { mockClient } from "aws-sdk-client-mock";
import { IoTDataPlaneClient, PublishCommand, type PublishCommandInput } from "@aws-sdk/client-iot-data-plane";

vi.mock("@amzn/dlt-common", async () => {
  // The wire schema and its validator are real — this suite asserts parity
  // between the native and legacy paths, so stubbing the parser would test
  // nothing. The log-stream parser is real too, since the topic is now derived
  // from it. Only the env/client/logger seams are mocked.
  const { LIVE_DATA_FILTER_MARKER, LIVE_DATA_V1_SCHEMA, parseLiveDataPoint } = await import(
    "../../common/src/schemas/live-data.js"
  );
  const { parseTestIdFromLogStream } = await import("../../common/src/naming.js");

  return {
    LIVE_DATA_FILTER_MARKER,
    LIVE_DATA_V1_SCHEMA,
    parseLiveDataPoint,
    parseTestIdFromLogStream,
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
  };
});

const iotMock = mockClient(IoTDataPlaneClient);
const gzipAsync = promisify(gzip);

async function makeEvent(payload: unknown) {
  const zipped = await gzipAsync(JSON.stringify(payload));
  return { awslogs: { data: Buffer.from(zipped).toString("base64") } };
}

// The awslogs driver names each stream `{prefix}/{containerName}/{ecsTaskId}`,
// and the task-runner sets the prefix to `load-testing/{testId}`
// (buildLiveDataStreamPrefix), so a real live-data stream looks like this.
const LOG_STREAM_CONTAINER = "dlt-stack-load-tester-locust";
function streamFor(testId: string) {
  return `load-testing/${testId}/${LOG_STREAM_CONTAINER}/3750ba41b41940aeb043ec114fc0fc8f`;
}

// The testId in the stream name is the authoritative, infrastructure-assigned
// identity — it, not the line content, decides the topic. `streamTestId`
// defaults to the testId the fixtures use; `logStreamOverride` lets a test
// supply a raw (e.g. malformed) stream name to exercise fail-closed behavior.
function cwLogsPayload(
  logEvents: { message: string; timestamp?: number }[],
  streamTestId = "testABC123",
  logStreamOverride?: string
) {
  return {
    messageType: "DATA_MESSAGE",
    owner: "123456789012",
    logGroup: "/ecs/load-tester",
    logStream: logStreamOverride ?? streamFor(streamTestId),
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

// Minimal Taurus-format line. load-test.sh prepends "{testId} {LIVE_DATA_ENABLED} "
// to every bzt line, so the testId is the leading token:
// "{testId} ... {N} vu\t{N} succ\t{N} fail\t{N} avg rt ..."
function metricLine(testId: string, opts: { vu?: number; succ?: number; fail?: number; avgRt?: number } = {}) {
  const { vu = 10, succ = 5, fail = 0, avgRt = 1.0 } = opts;
  return `${testId} ${vu} vu\t${succ} succ\t${fail} fail\t${avgRt} avg rt`;
}

// One native-mode live-data line, as sidecar.py / emitter.ts write it to stdout.
function nativeLine(
  testId: string,
  opts: { vu?: number; succ?: number; fail?: number; avgRt?: number; timestamp?: number } = {}
) {
  const { vu = 10, succ = 5, fail = 0, avgRt = 1.0, timestamp = 1700000000000 } = opts;
  return JSON.stringify({
    _filter: "INFO: Current: live=true",
    schema: "dlt.live-data.v1",
    testId,
    region: "us-west-2",
    timestamp,
    vu,
    succ,
    fail,
    avgRt,
  });
}

describe("real-time-data-publisher", () => {
  beforeEach(() => {
    iotMock.reset();
    iotMock.on(PublishCommand).resolves({});
  });

  // --- Happy path ---

  it("extracts metrics from a batch and publishes to the correct IoT topic", async () => {
    const event = await makeEvent(
      cwLogsPayload(
        [
          { message: metricLine("testABC123", { vu: 100, succ: 58, fail: 0, avgRt: 3.631 }), timestamp: 1643834990117 },
          { message: metricLine("testABC123", { vu: 100, succ: 27, fail: 0, avgRt: 3.916 }), timestamp: 1643834991098 },
        ],
        "testABC123"
      )
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
      cwLogsPayload(
        [{ message: metricLine("singleEvt0", { vu: 1, succ: 1, fail: 0, avgRt: 0.5 }), timestamp: 1700000000499 }],
        "singleEvt0"
      )
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
      cwLogsPayload([{ message: metricLine("zeroVals00", { vu: 0, succ: 0, fail: 0, avgRt: 0.0 }) }], "zeroVals00")
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { payload } = parsePublished();
    const metrics = payload["us-west-2"] as Record<string, unknown>[];
    expect(metrics[0]).toMatchObject({ vu: 0, succ: 0, fail: 0, avgRt: 0 });
  });

  it("handles large numeric values at regex quantifier boundaries", async () => {
    const event = await makeEvent(
      cwLogsPayload(
        [{ message: metricLine("bigNums001", { vu: 999999, succ: 999999, fail: 999999, avgRt: 999.999 }) }],
        "bigNums001"
      )
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { payload } = parsePublished();
    const metrics = payload["us-west-2"] as Record<string, unknown>[];
    expect(metrics[0]).toMatchObject({ vu: 999999, succ: 999999, fail: 999999, avgRt: 999.999 });
  });

  it("rounds timestamps to the nearest second", async () => {
    const event = await makeEvent(
      cwLogsPayload([{ message: metricLine("roundTs000"), timestamp: 1700000000999 }], "roundTs000")
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
      cwLogsPayload(
        [
          { message: metricLine("mixedBatch") },
          { message: "some unrelated log output" },
          { message: metricLine("mixedBatch") },
          { message: "" },
        ],
        "mixedBatch"
      )
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

  it("routes to the log stream's testId regardless of where the metric appears", async () => {
    const event = await makeEvent(
      cwLogsPayload(
        [
          { message: "not a metric line" },
          { message: metricLine("firstMatch") },
          { message: metricLine("firstMatch") },
        ],
        "firstMatch"
      )
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { topic } = parsePublished();
    expect(topic).toBe("dlt/firstMatch");
  });

  it("keys the payload by the Lambda's configured region", async () => {
    const event = await makeEvent(cwLogsPayload([{ message: metricLine("regionKey0") }], "regionKey0"));

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { payload } = parsePublished();
    expect(payload["us-west-2"]).toBeDefined();
    expect(Object.keys(payload)).toHaveLength(1);
  });

  // --- Stream-derived identity: forgery & fail-closed ---

  it("drops a legacy line whose testId disagrees with its log stream", async () => {
    // Attacker's own task (stream = attackerId) prints a line carrying a
    // victim's testId. The forged line is dropped; only the attacker's own
    // metrics reach the attacker's own topic.
    const event = await makeEvent(
      cwLogsPayload(
        [
          { message: metricLine("victimId00", { vu: 99999 }) },
          { message: metricLine("attackerId", { vu: 7 }) },
        ],
        "attackerId"
      )
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { topic, payload } = parsePublished();
    expect(topic).toBe("dlt/attackerId");
    const metrics = payload["us-west-2"] as Record<string, unknown>[];
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({ testId: "attackerId", vu: 7 });
  });

  it("drops a native line whose testId disagrees with its log stream", async () => {
    const event = await makeEvent(
      cwLogsPayload(
        [
          { message: nativeLine("victimId00", { vu: 99999 }) },
          { message: nativeLine("attackerId", { vu: 7 }) },
        ],
        "attackerId"
      )
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { topic, payload } = parsePublished();
    expect(topic).toBe("dlt/attackerId");
    const metrics = payload["us-west-2"] as Record<string, unknown>[];
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({ testId: "attackerId", vu: 7 });
  });

  it("does not publish anything when every line forges a different testId", async () => {
    // A script that only ever prints a victim's testId cannot reach the victim's
    // topic: all lines are dropped and nothing is published.
    const event = await makeEvent(
      cwLogsPayload(
        [{ message: nativeLine("victimId00") }, { message: metricLine("victimId00") }],
        "attackerId"
      )
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    expect(iotMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it("fails closed (no publish) when the log stream name is not in the expected format", async () => {
    const event = await makeEvent(
      cwLogsPayload([{ message: metricLine("testABC123") }], "testABC123", "ecs/load-tester/abc123")
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    expect(iotMock.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it("handles a hyphenated testId in both the stream and legacy/native lines", async () => {
    // Guards the TEST_ID_PATTERN charset fix: a hyphenated testId must be
    // captured in full (\w would truncate at the first hyphen) so it still
    // matches the stream and is not wrongly dropped.
    const event = await makeEvent(
      cwLogsPayload(
        [{ message: metricLine("my-test-01", { vu: 3 }) }, { message: nativeLine("my-test-01", { vu: 4 }) }],
        "my-test-01"
      )
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { topic, payload } = parsePublished();
    expect(topic).toBe("dlt/my-test-01");
    const metrics = payload["us-west-2"] as Record<string, unknown>[];
    expect(metrics.map((m) => m["vu"])).toEqual([3, 4]);
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

    const event = await makeEvent(cwLogsPayload([{ message: metricLine("failPub000") }], "failPub000"));

    const { handler } = await import("../src/index.js");
    await expect(handler(event)).rejects.toThrow("ServiceUnavailable");
  });

  // --- Partial match edge cases ---

  it("skips a line missing avg rt", async () => {
    const event = await makeEvent(
      cwLogsPayload(
        [{ message: "partial000 10 vu\t5 succ\t0 fail" }, { message: metricLine("partial000") }],
        "partial000"
      )
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { payload } = parsePublished();
    expect(payload["us-west-2"]).toHaveLength(1);
  });

  it("extracts the first match for each field, not values from later in the line", async () => {
    // Line has "2.5 avg rt" in the current section and "99.999 avg rt" later
    const event = await makeEvent(
      cwLogsPayload(
        [{ message: "firstVals0 50 vu\t20 succ\t3 fail\t2.5 avg rt\t99.999 avg rt", timestamp: 1700000000000 }],
        "firstVals0"
      )
    );

    const { handler } = await import("../src/index.js");
    await handler(event);

    const { payload } = parsePublished();
    const metrics = payload["us-west-2"] as Record<string, unknown>[];
    expect(metrics[0]).toMatchObject({ vu: 50, succ: 20, fail: 3, avgRt: 2.5 });
  });

  // --- Native mode (dlt.live-data.v1 JSON lines) ---

  describe("native mode", () => {
    it("publishes a native line to the same topic and payload shape as legacy", async () => {
      const event = await makeEvent(
        cwLogsPayload(
          [{ message: nativeLine("nativeAB12", { vu: 100, succ: 58, fail: 2, avgRt: 3.631, timestamp: 1643834990000 }) }],
          "nativeAB12"
        )
      );

      const { handler } = await import("../src/index.js");
      await handler(event);

      const { topic, payload } = parsePublished();
      expect(topic).toBe("dlt/nativeAB12");
      expect(payload["us-west-2"]).toEqual([
        { testId: "nativeAB12", vu: 100, succ: 58, fail: 2, avgRt: 3.631, timestamp: 1643834990000 },
      ]);
    });

    it("produces the same keys in the same order with the same types as the legacy path", async () => {
      // avgRt 3.631 and a second-aligned timestamp are exactly representable
      // through both paths, so the values match too. Values are only comparable
      // for such fixtures — see the full-precision test below.
      const values = { vu: 100, succ: 58, fail: 2, avgRt: 3.631 };
      const legacyEvent = await makeEvent(
        cwLogsPayload([{ message: metricLine("parityTest", values), timestamp: 1643834990000 }], "parityTest")
      );
      const nativeEvent = await makeEvent(
        cwLogsPayload([{ message: nativeLine("parityTest", { ...values, timestamp: 1643834990000 }) }], "parityTest")
      );

      const { handler } = await import("../src/index.js");

      await handler(legacyEvent);
      const legacy = parsePublished();
      const legacyMetric = (legacy.payload["us-west-2"] as Record<string, unknown>[])[0];

      iotMock.reset();
      iotMock.on(PublishCommand).resolves({});
      await handler(nativeEvent);
      const native = parsePublished();
      const nativeMetric = (native.payload["us-west-2"] as Record<string, unknown>[])[0];

      expect(native.topic).toBe(legacy.topic);
      expect(Object.keys(nativeMetric!)).toEqual(Object.keys(legacyMetric!));
      expect(nativeMetric).toEqual(legacyMetric);
      for (const key of Object.keys(legacyMetric!)) {
        expect(typeof nativeMetric![key]).toBe(typeof legacyMetric![key]);
      }
    });

    it("preserves a full-precision avgRt bit-for-bit, with no unit round trip", async () => {
      // Chosen so (avgRt * 1000) / 1000 !== avgRt: it survives JSON but not a
      // seconds → ms → seconds conversion. Guards against reintroducing the
      // unit round trip the design forbids (H4). The legacy AVG_RT_PATTERN also
      // caps at 3 decimals, so only the native path can carry this value.
      const avgRt = 0.010875706819060915;
      expect((avgRt * 1000) / 1000).not.toBe(avgRt);

      const event = await makeEvent(cwLogsPayload([{ message: nativeLine("precision1", { avgRt }) }], "precision1"));

      const { handler } = await import("../src/index.js");
      await handler(event);

      const { payload } = parsePublished();
      const metrics = payload["us-west-2"] as Record<string, unknown>[];
      expect(metrics[0]!["avgRt"]).toBe(avgRt);
    });

    it("uses the producer's timestamp without re-rounding", async () => {
      // CloudWatch's event timestamp is deliberately offset from the bucket the
      // producer reported; the native path must report the producer's value.
      const event = await makeEvent(
        cwLogsPayload(
          [{ message: nativeLine("tsNative01", { timestamp: 1700000005000 }), timestamp: 1700000009999 }],
          "tsNative01"
        )
      );

      const { handler } = await import("../src/index.js");
      await handler(event);

      const { payload } = parsePublished();
      const metrics = payload["us-west-2"] as Record<string, unknown>[];
      expect(metrics[0]).toMatchObject({ timestamp: 1700000005000 });
    });

    it("publishes both native and legacy metrics from a mixed batch, in log order", async () => {
      const event = await makeEvent(
        cwLogsPayload(
          [
            { message: nativeLine("mixedMode1", { vu: 1, timestamp: 1700000001000 }) },
            { message: metricLine("mixedMode1", { vu: 2 }), timestamp: 1700000002000 },
            { message: nativeLine("mixedMode1", { vu: 3, timestamp: 1700000003000 }) },
          ],
          "mixedMode1"
        )
      );

      const { handler } = await import("../src/index.js");
      await handler(event);

      const { topic, payload } = parsePublished();
      expect(topic).toBe("dlt/mixedMode1");
      const metrics = payload["us-west-2"] as Record<string, unknown>[];
      expect(metrics.map((m) => m["vu"])).toEqual([1, 2, 3]);
      expect(metrics.map((m) => m["timestamp"])).toEqual([1700000001000, 1700000002000, 1700000003000]);
    });

    it("skips a malformed native line and still publishes the rest of the batch", async () => {
      // A line that claims the schema but fails validation is dropped as invalid
      // (distinct from a testId-mismatch drop); valid lines still publish.
      const malformed = JSON.stringify({
        _filter: "INFO: Current: live=true",
        schema: "dlt.live-data.v1",
        testId: "malformed1",
        region: "us-west-2",
        timestamp: 1700000000000,
        vu: 10,
        succ: 5,
        fail: 0,
      });
      const event = await makeEvent(
        cwLogsPayload([{ message: malformed }, { message: nativeLine("malformed1", { vu: 7 }) }], "malformed1")
      );

      const { handler } = await import("../src/index.js");
      await handler(event);

      const { topic, payload } = parsePublished();
      expect(topic).toBe("dlt/malformed1");
      expect(payload["us-west-2"]).toEqual([
        { testId: "malformed1", vu: 7, succ: 5, fail: 0, avgRt: 1.0, timestamp: 1700000000000 },
      ]);
    });

    it("skips truncated native JSON without failing the invocation", async () => {
      const truncated = nativeLine("truncated1").slice(0, -5);
      const event = await makeEvent(cwLogsPayload([{ message: truncated }], "truncated1"));

      const { handler } = await import("../src/index.js");
      await expect(handler(event)).resolves.toBeUndefined();

      expect(iotMock.commandCalls(PublishCommand)).toHaveLength(0);
    });

    it("logs at error level when a native line is skipped, so an alarm can catch it", async () => {
      const { createLogger } = await import("@amzn/dlt-common");
      const event = await makeEvent(cwLogsPayload([{ message: nativeLine("logged1").slice(0, -5) }], "logged1"));

      const { handler } = await import("../src/index.js");
      await handler(event);

      // The handler creates its logger per invocation, so grab the one created
      // by this call (the most recent createLogger result).
      const logger = vi.mocked(createLogger).mock.results.at(-1)?.value as { error: ReturnType<typeof vi.fn> };
      expect(logger.error).toHaveBeenCalledWith("Skipping invalid dlt.live-data.v1 payload", { logEventId: "0" });
    });

    it("routes a native-only batch to the log stream's testId", async () => {
      const event = await makeEvent(
        cwLogsPayload(
          [
            { message: "starting locust" },
            { message: nativeLine("firstNativ") },
            { message: nativeLine("firstNativ") },
          ],
          "firstNativ"
        )
      );

      const { handler } = await import("../src/index.js");
      await handler(event);

      const { topic, payload } = parsePublished();
      expect(topic).toBe("dlt/firstNativ");
      expect(payload["us-west-2"]).toHaveLength(2);
    });

    it("keys the payload by the Lambda's region, not the region in the line", async () => {
      // nativeLine() reports us-west-2, matching AWS_REGION here; assert the
      // payload key comes from the Lambda's own region either way.
      const line = JSON.parse(nativeLine("regionNat1")) as Record<string, unknown>;
      line["region"] = "eu-central-1";
      const event = await makeEvent(cwLogsPayload([{ message: JSON.stringify(line) }], "regionNat1"));

      const { handler } = await import("../src/index.js");
      await handler(event);

      const { payload } = parsePublished();
      expect(Object.keys(payload)).toEqual(["us-west-2"]);
    });

    it("still parses a legacy line that mentions live=true", async () => {
      // The prefilter keys off the schema identifier, not the filter marker, so
      // a Taurus line carrying the marker still goes down the regex path. The
      // testId leads the line (load-test.sh prepends it), the marker follows.
      const event = await makeEvent(
        cwLogsPayload(
          [{ message: `markerOnly live=true INFO: Current: ${metricLine("").trim()}`, timestamp: 1700000000000 }],
          "markerOnly"
        )
      );

      const { handler } = await import("../src/index.js");
      await handler(event);

      const { payload } = parsePublished();
      const metrics = payload["us-west-2"] as Record<string, unknown>[];
      expect(metrics).toHaveLength(1);
      expect(metrics[0]).toMatchObject({ vu: 10, succ: 5, fail: 0, avgRt: 1 });
    });

    it("does not reinterpret an invalid native line as a legacy metric", async () => {
      const event = await makeEvent(
        cwLogsPayload(
          [{ message: `schemaWord1 emitting dlt.live-data.v1 lines\t10 vu\t5 succ\t0 fail\t1.0 avg rt` }],
          "schemaWord1"
        )
      );

      const { handler } = await import("../src/index.js");
      await handler(event);

      // Skipped, not re-parsed by the legacy regex: the schema marker claims the
      // line for the native path, and a native line that fails validation is dropped.
      expect(iotMock.commandCalls(PublishCommand)).toHaveLength(0);
    });
  });
});
