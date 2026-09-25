// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { scenarioRecordSchema } from "../../src/scenarios/schema.ts";

const validRecord = {
  testId: "test-123",
  testName: "Load Test",
  testType: "simple",
  status: "running",
  testTaskConfigs: [{ region: "us-east-1", taskCount: 5, concurrency: 5 }],
  testScenario: '{"execution":[{"hold-for":"1m"}]}',
  desiredTaskCount: 5,
  taskFailureCount: 0,
};

describe("scenarioRecordSchema", () => {
  it("parses a valid full record", () => {
    const result = scenarioRecordSchema.safeParse(validRecord);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.testId).toBe("test-123");
      expect(result.data.testTaskConfigs[0]?.region).toBe("us-east-1");
    }
  });

  it("defaults desiredTaskCount and taskFailureCount when missing", () => {
    const input = {
      testId: "test-123",
      testName: "Load Test",
      testType: "simple",
      status: "running",
      testTaskConfigs: [{ region: "us-east-1", taskCount: "5", concurrency: "5" }],
      testScenario: '{"execution":[{"hold-for":"1m"}]}',
    };
    const result = scenarioRecordSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.desiredTaskCount).toBe(0);
      expect(result.data.taskFailureCount).toBe(0);
    }
  });

  it("passes through unknown fields", () => {
    const result = scenarioRecordSchema.safeParse({ ...validRecord, futureField: "hello" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["futureField"]).toBe("hello");
    }
  });

  it("fails when required fields are missing", () => {
    const result = scenarioRecordSchema.safeParse({ testId: "abc" });
    expect(result.success).toBe(false);
  });

  it("fails when testTaskConfigs items have wrong shape", () => {
    const result = scenarioRecordSchema.safeParse({
      ...validRecord,
      testTaskConfigs: [{ region: 123 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts legacy scheduled and created statuses", () => {
    for (const status of ["scheduled", "created"]) {
      const result = scenarioRecordSchema.safeParse({ ...validRecord, status });
      expect(result.success).toBe(true);
    }
  });

  it("fails when status is not a known TestStatus", () => {
    const result = scenarioRecordSchema.safeParse({ ...validRecord, status: "bogus" });
    expect(result.success).toBe(false);
  });

  it("coerces string taskCount/concurrency to numbers", () => {
    const result = scenarioRecordSchema.safeParse({
      ...validRecord,
      testTaskConfigs: [{ region: "us-east-1", taskCount: "5", concurrency: "10" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.testTaskConfigs[0]?.taskCount).toBe(5);
      expect(result.data.testTaskConfigs[0]?.concurrency).toBe(10);
    }
  });

  describe("nativeRunMode", () => {
    it("parses a legacy record without native configuration", () => {
      const result = scenarioRecordSchema.safeParse(validRecord);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nativeRunMode).toBeUndefined();
      }
    });

    it("reads a native record and keeps only maxTestDurationSeconds", () => {
      const result = scenarioRecordSchema.safeParse({
        ...validRecord,
        testType: "locust",
        nativeRunMode: { maxTestDurationSeconds: 3600 },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nativeRunMode).toEqual({ maxTestDurationSeconds: 3600 });
      }
    });

    // Backward compatibility: legacy records may still carry loadOverrides.
    // The read path must not fail; it strips the field so downstream sees only
    // maxTestDurationSeconds and the test runs the load its own script defines.
    it("tolerates and strips a legacy loadOverrides field on read", () => {
      const result = scenarioRecordSchema.safeParse({
        ...validRecord,
        testType: "locust",
        nativeRunMode: {
          maxTestDurationSeconds: 3600,
          loadOverrides: { locustLoadOverrides: { users: 100, spawnRate: 10 } },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nativeRunMode).toEqual({ maxTestDurationSeconds: 3600 });
        expect((result.data.nativeRunMode as Record<string, unknown>)["loadOverrides"]).toBeUndefined();
      }
    });

    it("strips even a structurally invalid legacy loadOverrides rather than failing", () => {
      const result = scenarioRecordSchema.safeParse({
        ...validRecord,
        nativeRunMode: {
          maxTestDurationSeconds: 60,
          loadOverrides: { locustLoadOverrides: { users: -5 } },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nativeRunMode).toEqual({ maxTestDurationSeconds: 60 });
      }
    });

    it("rejects missing or corrupt maxTestDurationSeconds", () => {
      expect(scenarioRecordSchema.safeParse({ ...validRecord, nativeRunMode: {} }).success).toBe(false);
      for (const value of [0, -1, 1.5]) {
        const result = scenarioRecordSchema.safeParse({
          ...validRecord,
          nativeRunMode: { maxTestDurationSeconds: value },
        });
        expect(result.success).toBe(false);
      }
    });
  });
});
