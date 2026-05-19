// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  const params = {
    serviceName: "TestService",
    solutionId: "SO0062",
    version: "0.0.0",
  };

  it("returns a Logger instance that can log without throwing", () => {
    const logger = createLogger(params);
    expect(() => {
      logger.info("test message");
    }).not.toThrow();
  });

  it("includes solutionId and version in persistent log attributes", () => {
    const logger = createLogger(params);
    const attributes = logger.getPersistentLogAttributes();
    expect(attributes).toMatchObject({
      solutionId: "SO0062",
      version: "0.0.0",
    });
  });

  it("supports appendKeys for per-invocation correlation", () => {
    const logger = createLogger(params);

    // appendKeys should not throw — keys will appear in log output
    expect(() => {
      logger.appendKeys({ testId: "test-123", testRunId: "run-456", region: "us-east-1" });
    }).not.toThrow();

    // Verify logging still works after appending keys
    expect(() => {
      logger.info("with correlation keys");
    }).not.toThrow();
  });

  it("creates independent logger instances", () => {
    const logger1 = createLogger({ ...params, serviceName: "Service1" });
    const logger2 = createLogger({ ...params, serviceName: "Service2" });

    logger1.appendKeys({ testId: "from-logger1" });

    // logger2 should not have logger1's keys
    const attrs2 = logger2.getPersistentLogAttributes();
    expect(attrs2).not.toHaveProperty("testId");
  });
});
