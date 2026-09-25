// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";

type StdoutWriteSpy = MockInstance<typeof process.stdout.write>;

function capturedLines(spy: StdoutWriteSpy): Record<string, unknown>[] {
  return spy.mock.calls
    .map((call): string => {
      const chunk = call[0];
      return typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    })
    .flatMap((text: string) => text.split("\n").filter((line: string) => line.length > 0))
    .map((line: string) => JSON.parse(line) as Record<string, unknown>);
}

describe("createLogger", () => {
  let stdoutSpy: StdoutWriteSpy;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it("emits the expected field shape", () => {
    const logger = createLogger({ serviceName: "load-tester" });
    logger.info({ testId: "ABCD1234" }, "Downloaded test config");

    const lines = capturedLines(stdoutSpy);
    expect(lines).toHaveLength(1);
    const [entry] = lines;
    expect(entry?.["level"]).toBe("INFO");
    expect(entry?.["service"]).toBe("load-tester");
    expect(entry?.["message"]).toBe("Downloaded test config");
    expect(entry?.["testId"]).toBe("ABCD1234");
    expect(entry?.["timestamp"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("strips pino's default pid and hostname bindings", () => {
    const logger = createLogger({ serviceName: "load-tester" });
    logger.info("hello");

    const [entry] = capturedLines(stdoutSpy);
    expect(entry).not.toHaveProperty("pid");
    expect(entry).not.toHaveProperty("hostname");
  });

  it("emits level as uppercase for each level", () => {
    const logger = createLogger({ serviceName: "load-tester", level: "debug" });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    const lines = capturedLines(stdoutSpy);
    expect(lines.map((l) => l["level"])).toEqual(["DEBUG", "INFO", "WARN", "ERROR"]);
  });

  it("respects the level threshold and drops lower-severity calls", () => {
    const logger = createLogger({ serviceName: "load-tester", level: "warn" });
    logger.debug("dropped");
    logger.info("dropped");
    logger.warn("kept");
    logger.error("kept");

    const lines = capturedLines(stdoutSpy);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l["message"])).toEqual(["kept", "kept"]);
  });

  it("defaults the level to info when omitted", () => {
    const logger = createLogger({ serviceName: "load-tester" });
    logger.debug("dropped");
    logger.info("kept");

    const lines = capturedLines(stdoutSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.["message"]).toBe("kept");
  });

  it("child loggers merge bindings into every emission", () => {
    const logger = createLogger({ serviceName: "load-tester" });
    const child = logger.child({ testId: "ABCD1234", region: "us-east-1" });
    child.info("hello");

    const [entry] = capturedLines(stdoutSpy);
    expect(entry?.["testId"]).toBe("ABCD1234");
    expect(entry?.["region"]).toBe("us-east-1");
    expect(entry?.["message"]).toBe("hello");
  });

  it("normalizes Error objects via pino's default serializer", () => {
    const logger = createLogger({ serviceName: "load-tester" });
    logger.error({ err: new Error("boom") }, "operation failed");

    const [entry] = capturedLines(stdoutSpy);
    expect(entry?.["message"]).toBe("operation failed");
    const err = entry?.["err"] as Record<string, unknown>;
    expect(err["type"]).toBe("Error");
    expect(err["message"]).toBe("boom");
    expect(typeof err["stack"]).toBe("string");
  });
});
