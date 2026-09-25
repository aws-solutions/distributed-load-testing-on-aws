// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    buildExecutionName,
    buildLiveDataStreamPrefix,
    buildServiceName,
    buildTaskDefinitionFamily,
    DLT_SERVICE_PREFIX,
    LIVE_DATA_LOG_STREAM_PREFIX,
    parseExecutionName,
    parseTestIdFromLogStream,
} from "../src/naming.ts";

describe("buildServiceName", () => {
  it("builds service name from testId and region", () => {
    expect(buildServiceName("abc123", "us-east-1")).toBe("dlt-abc123-us-east-1");
  });

  it("uses DLT_SERVICE_PREFIX", () => {
    const name = buildServiceName("test1", "eu-west-1");
    expect(name.startsWith(DLT_SERVICE_PREFIX)).toBe(true);
  });
});

describe("buildTaskDefinitionFamily", () => {
  it("builds task definition family from testId", () => {
    expect(buildTaskDefinitionFamily("abc123")).toBe("dlt-worker-abc123");
  });
});

describe("buildLiveDataStreamPrefix", () => {
  it("builds the stream prefix from testId", () => {
    expect(buildLiveDataStreamPrefix("abc123")).toBe("load-testing/abc123");
  });

  it("uses LIVE_DATA_LOG_STREAM_PREFIX as the root segment", () => {
    expect(buildLiveDataStreamPrefix("abc123").startsWith(`${LIVE_DATA_LOG_STREAM_PREFIX}/`)).toBe(true);
  });
});

describe("parseTestIdFromLogStream", () => {
  // The awslogs driver appends /{container}/{taskId} to the prefix.
  const streamFor = (testId: string) => `${buildLiveDataStreamPrefix(testId)}/dlt-stack-load-tester-locust/task123`;

  it("extracts the testId from a well-formed live-data stream name", () => {
    expect(parseTestIdFromLogStream(streamFor("abc123"))).toBe("abc123");
  });

  it("roundtrips with buildLiveDataStreamPrefix for a hyphenated testId", () => {
    expect(parseTestIdFromLogStream(streamFor("my-test-01"))).toBe("my-test-01");
  });

  it("returns undefined for a stream name without the load-testing prefix", () => {
    expect(parseTestIdFromLogStream("ecs/load-tester/task123")).toBeUndefined();
  });

  it("returns undefined for the legacy two-segment prefix (no testId embedded)", () => {
    // Before the testId was embedded, streams were load-testing/{container}/{taskId}.
    // The parser must not resolve the container name as a testId.
    expect(parseTestIdFromLogStream("load-testing/dlt-stack-load-tester-locust/task123")).toBeUndefined();
  });

  it("returns undefined when the container/task suffix is missing", () => {
    expect(parseTestIdFromLogStream("load-testing/abc123")).toBeUndefined();
    expect(parseTestIdFromLogStream("load-testing/abc123/onlyOneSegment")).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    expect(parseTestIdFromLogStream("")).toBeUndefined();
  });
});

describe("buildExecutionName", () => {
  it("builds execution name from testId and testRunId", () => {
    expect(buildExecutionName("abc123", "run456")).toBe("scenario-abc123-run-run456");
  });

  it("produces a name under the 80-char SFN limit for typical IDs", () => {
    const name = buildExecutionName("abcde12345", "fghij67890");
    expect(name.length).toBeLessThanOrEqual(80);
  });
});

describe("parseExecutionName", () => {
  it("extracts testId and testRunId from a valid execution name", () => {
    const result = parseExecutionName("scenario-abc123-run-run456");
    expect(result).toEqual({ testId: "abc123", testRunId: "run456" });
  });

  it("roundtrips with buildExecutionName", () => {
    const testId = "abcde12345";
    const testRunId = "fghij67890";
    const name = buildExecutionName(testId, testRunId);
    const parsed = parseExecutionName(name);
    expect(parsed.testId).toBe(testId);
    expect(parsed.testRunId).toBe(testRunId);
  });

  it("throws on missing scenario prefix", () => {
    expect(() => parseExecutionName("abc123-run-run456")).toThrow("Invalid execution name format");
  });

  it("throws on missing run segment", () => {
    expect(() => parseExecutionName("scenario-abc123")).toThrow("Invalid execution name format");
  });

  it("throws on empty string", () => {
    expect(() => parseExecutionName("")).toThrow("Invalid execution name format");
  });

  it("handles testId containing hyphens", () => {
    // testId is alphanumeric in practice, but the regex is greedy so
    // it matches the last -run- occurrence. This tests robustness.
    const name = "scenario-test-with-hyphens-run-myRunId";
    const result = parseExecutionName(name);
    expect(result.testId).toBe("test-with-hyphens");
    expect(result.testRunId).toBe("myRunId");
  });
});
