// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  testIdSchema,
  testRunIdSchema,
  pathParametersSchema,
  scenariosQuerySchema,
  scenarioQuerySchema,
  testRunsQuerySchema,
  baselineQuerySchema,
  createTestSchema,
  setBaselineSchema,
  deleteTestRunsSchema,
  testNameSchema,
  testDescriptionSchema,
  healthyThresholdSchema,
  scheduleDateSchema,
  scheduleTimeSchema,
  concurrencySchema,
  taskCountSchema,
  rampUpSchema,
  holdForSchema,
  urlSchema,
} from "../../src/api/schemas.ts";
import { MAX_TEST_RUNS_PER_DELETE_REQUEST } from "../../src/api/limits.ts";

// These per-field schemas are re-exported to the webui (scenarioFieldSchemas.ts)
// so the UI validates against the same rules as the API. Lock the public surface.
describe("per-field schemas (shared with the webui)", () => {
  it("testNameSchema accepts a valid name and rejects too-short", () => {
    expect(testNameSchema.safeParse("My Test").success).toBe(true);
    expect(testNameSchema.safeParse("ab").success).toBe(false);
  });

  it("testDescriptionSchema enforces the 3-60000 length range", () => {
    expect(testDescriptionSchema.safeParse("valid description").success).toBe(true);
    expect(testDescriptionSchema.safeParse("ab").success).toBe(false);
  });

  it("healthyThresholdSchema accepts 0-100 integers only", () => {
    expect(healthyThresholdSchema.safeParse(90).success).toBe(true);
    expect(healthyThresholdSchema.safeParse(150).success).toBe(false);
    expect(healthyThresholdSchema.safeParse(3.5).success).toBe(false);
  });

  it("scheduleDateSchema requires YYYY-MM-DD", () => {
    expect(scheduleDateSchema.safeParse("2099-12-31").success).toBe(true);
    expect(scheduleDateSchema.safeParse("2099/12/31").success).toBe(false);
  });

  it("scheduleTimeSchema requires HH:MM(:SS)", () => {
    expect(scheduleTimeSchema.safeParse("12:00").success).toBe(true);
    expect(scheduleTimeSchema.safeParse("25:00").success).toBe(false);
  });

  it("concurrencySchema accepts 1-25000, rejects out of range", () => {
    expect(concurrencySchema.safeParse("50").success).toBe(true);
    expect(concurrencySchema.safeParse("0").success).toBe(false);
  });

  it("taskCountSchema accepts a positive integer and rejects zero or non-numeric strings", () => {
    expect(taskCountSchema.safeParse("5").success).toBe(true);
    expect(taskCountSchema.safeParse("0").success).toBe(false);
    expect(taskCountSchema.safeParse("abc").success).toBe(false);
  });

  it("rampUpSchema accepts a suffixed duration within range", () => {
    expect(rampUpSchema.safeParse("5m").success).toBe(true);
    expect(rampUpSchema.safeParse("1441m").success).toBe(false);
  });

  it("holdForSchema accepts a suffixed duration, rejects zero", () => {
    expect(holdForSchema.safeParse("10m").success).toBe(true);
    expect(holdForSchema.safeParse("0m").success).toBe(false);
  });

  it("urlSchema accepts http(s) URLs, rejects other schemes", () => {
    expect(urlSchema.safeParse("https://example.com").success).toBe(true);
    expect(urlSchema.safeParse("ftp://example.com").success).toBe(false);
  });
});

describe("testIdSchema", () => {
  it("accepts valid alphanumeric ids", () => {
    expect(testIdSchema.parse("abc-123")).toBe("abc-123");
  });

  it("rejects empty string", () => {
    expect(() => testIdSchema.parse("")).toThrow(/testId is required/);
  });

  it("rejects strings exceeding 128 characters", () => {
    expect(() => testIdSchema.parse("a".repeat(129))).toThrow(/must not exceed 128/);
  });

  it("rejects special characters", () => {
    expect(() => testIdSchema.parse("test@id")).toThrow(/alphanumeric/);
  });
});

describe("testRunIdSchema", () => {
  it("accepts valid run ids", () => {
    expect(testRunIdSchema.parse("run-456")).toBe("run-456");
  });

  it("rejects empty string", () => {
    expect(() => testRunIdSchema.parse("")).toThrow(/testRunId is required/);
  });
});

describe("pathParametersSchema", () => {
  it("accepts both ids", () => {
    const result = pathParametersSchema.parse({ testId: "abc", testRunId: "def" });
    expect(result).toEqual({ testId: "abc", testRunId: "def" });
  });

  it("accepts empty object", () => {
    expect(pathParametersSchema.parse({})).toEqual({});
  });
});

describe("scenariosQuerySchema", () => {
  it("accepts op=listRegions", () => {
    expect(scenariosQuerySchema.parse({ op: "listRegions" })).toEqual({ op: "listRegions" });
  });

  it("rejects unknown fields", () => {
    expect(() => scenariosQuerySchema.parse({ unknown: "x" })).toThrow();
  });
});

describe("scenarioQuerySchema", () => {
  it("accepts history and latest", () => {
    expect(scenarioQuerySchema.parse({ history: "true", latest: "false" })).toEqual({
      history: "true",
      latest: "false",
    });
  });
});

describe("testRunsQuerySchema", () => {
  it("transforms string limit to number", () => {
    const result = testRunsQuerySchema.parse({ limit: "50" });
    expect(result.limit).toBe(50);
  });

  it("rejects limit out of range", () => {
    expect(() => testRunsQuerySchema.parse({ limit: "200" })).toThrow(/between 1 and 100/);
  });

  it("accepts valid ISO date timestamps", () => {
    const result = testRunsQuerySchema.parse({ start_timestamp: "2025-01-01T00:00:00Z" });
    expect(result.start_timestamp).toBe("2025-01-01T00:00:00Z");
  });

  it("rejects invalid date string", () => {
    expect(() => testRunsQuerySchema.parse({ start_timestamp: "not-a-date" })).toThrow(/Invalid date/);
  });
});

describe("baselineQuerySchema", () => {
  it("accepts data=true", () => {
    expect(baselineQuerySchema.parse({ data: "true" })).toEqual({ data: "true" });
  });
});

describe("createTestSchema — duration validation", () => {
  const minimalPayload = {
    testName: "Valid Test Name",
    testDescription: "A valid description for testing",
    testType: "simple" as const,
    testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
    testScenario: { execution: [{ concurrency: 1, "hold-for": "1m" }] },
    regionalTaskDetails: { "us-east-1": { dltAvailableTasks: 10 } },
  };

  it("accepts valid hold-for string durations", () => {
    const result = createTestSchema.parse({
      ...minimalPayload,
      testScenario: { execution: [{ concurrency: 1, "hold-for": "30m" }] },
    });
    expect(result.testScenario.execution[0]!["hold-for"]).toBe("30m");
  });

  it("rejects hold-for of 0", () => {
    expect(() =>
      createTestSchema.parse({
        ...minimalPayload,
        testScenario: { execution: [{ concurrency: 1, "hold-for": "0m" }] },
      })
    ).toThrow(/greater than 0/);
  });

  it("accepts ramp-up of 0s", () => {
    const result = createTestSchema.parse({
      ...minimalPayload,
      testScenario: { execution: [{ concurrency: 1, "hold-for": "1m", "ramp-up": "0s" }] },
    });
    expect(result.testScenario.execution[0]!["ramp-up"]).toBe("0s");
  });

  it("rejects hold-for exceeding max", () => {
    expect(() =>
      createTestSchema.parse({
        ...minimalPayload,
        testScenario: { execution: [{ concurrency: 1, "hold-for": "5000s" }] },
      })
    ).toThrow(/exceeds maximum/);
  });

  it("rejects negative number for ramp-up", () => {
    expect(() =>
      createTestSchema.parse({
        ...minimalPayload,
        testScenario: { execution: [{ concurrency: 1, "hold-for": "1m", "ramp-up": -1 }] },
      })
    ).toThrow();
  });

  it("accepts numeric hold-for for backward compatibility", () => {
    const result = createTestSchema.parse({
      ...minimalPayload,
      testScenario: { execution: [{ concurrency: 1, "hold-for": 60 }] },
    });
    expect(result.testScenario.execution[0]!["hold-for"]).toBe(60);
  });
});

describe("createTestSchema — test asset file type", () => {
  const minimalPayload = {
    testName: "Valid Test Name",
    testDescription: "A valid description for testing",
    testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
    testScenario: { execution: [{ concurrency: 1, "hold-for": "1m" }] },
    regionalTaskDetails: { "us-east-1": { dltAvailableTasks: 10 } },
  };

  it.each(["jmeter", "k6", "locust"] as const)("rejects fileType none for %s", (testType) => {
    expect(() => createTestSchema.parse({ ...minimalPayload, testType, fileType: "none" })).toThrow(
      /fileType must be script or zip/
    );
  });

  it.each(["jmeter", "k6", "locust"] as const)("allows omitted fileType for %s", (testType) => {
    expect(() => createTestSchema.parse({ ...minimalPayload, testType })).not.toThrow();
  });
});

describe("createTestSchema — concurrency validation", () => {
  const minimalPayload = {
    testName: "Valid Test Name",
    testDescription: "A valid description for testing",
    testType: "simple" as const,
    testScenario: { execution: [{ concurrency: 1, "hold-for": "1m" }] },
    regionalTaskDetails: { "us-east-1": { dltAvailableTasks: 10 } },
  };

  it("accepts string concurrency in task configs", () => {
    const result = createTestSchema.parse({
      ...minimalPayload,
      testTaskConfigs: [{ region: "us-east-1", taskCount: "2", concurrency: "100" }],
    });
    expect(result.testTaskConfigs[0]!.concurrency).toBe(100);
    expect(result.testTaskConfigs[0]!.taskCount).toBe(2);
  });

  it("rejects concurrency above 25000", () => {
    expect(() =>
      createTestSchema.parse({
        ...minimalPayload,
        testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 30000 }],
      })
    ).toThrow(/between 1 and 25000/);
  });
});

describe("createTestSchema — region validation", () => {
  const minimalPayload = {
    testName: "Valid Test Name",
    testDescription: "A valid description for testing",
    testType: "simple" as const,
    testScenario: { execution: [{ concurrency: 1, "hold-for": "1m" }] },
    regionalTaskDetails: { "us-east-1": { dltAvailableTasks: 10 } },
  };

  it("accepts valid commercial region", () => {
    const result = createTestSchema.parse({
      ...minimalPayload,
      testTaskConfigs: [{ region: "eu-west-1", taskCount: 1, concurrency: 1 }],
    });
    expect(result.testTaskConfigs[0]!.region).toBe("eu-west-1");
  });

  it("accepts GovCloud region", () => {
    const result = createTestSchema.parse({
      ...minimalPayload,
      testTaskConfigs: [{ region: "us-gov-west-1", taskCount: 1, concurrency: 1 }],
    });
    expect(result.testTaskConfigs[0]!.region).toBe("us-gov-west-1");
  });

  it("rejects invalid region format", () => {
    expect(() =>
      createTestSchema.parse({
        ...minimalPayload,
        testTaskConfigs: [{ region: "invalid", taskCount: 1, concurrency: 1 }],
      })
    ).toThrow(/Invalid region format/);
  });
});

describe("createTestSchema — native run mode", () => {
  const minimalPayload = {
    testName: "Native k6 Test",
    testDescription: "A valid native test description",
    testType: "k6" as const,
    fileType: "script" as const,
    testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
    testScenario: { execution: [{ concurrency: 1, "hold-for": "1m" }] },
    regionalTaskDetails: { "us-east-1": { dltAvailableTasks: 10 } },
  };

  it.each([["k6"], ["locust"], ["jmeter"]] as const)(
    "accepts a native %s test with only maxTestDurationSeconds",
    (testType) => {
      const result = createTestSchema.parse({
        ...minimalPayload,
        testType,
        nativeRunMode: { maxTestDurationSeconds: 600 },
      });

      expect(result.nativeRunMode).toEqual({ maxTestDurationSeconds: 600 });
    }
  );

  it("rejects a legacy loadOverrides field on any framework", () => {
    expect(
      createTestSchema.safeParse({
        ...minimalPayload,
        nativeRunMode: {
          maxTestDurationSeconds: 600,
          loadOverrides: { k6LoadOverrides: { vus: 100, holdForSeconds: 540, rampUpSeconds: 60 } },
        },
      }).success
    ).toBe(false);

    expect(
      createTestSchema.safeParse({
        ...minimalPayload,
        testType: "locust",
        nativeRunMode: {
          maxTestDurationSeconds: 600,
          loadOverrides: { locustLoadOverrides: { users: 100 } },
        },
      }).success
    ).toBe(false);
  });

  it("rejects native mode for simple tests", () => {
    expect(() =>
      createTestSchema.parse({
        ...minimalPayload,
        testType: "simple",
        nativeRunMode: { maxTestDurationSeconds: 600 },
      })
    ).toThrow(/nativeRunMode is only supported for jmeter, k6, and locust tests/);
  });
});

describe("createTestSchema — testName validation", () => {
  const minimalPayload = {
    testDescription: "A valid description for testing",
    testType: "simple" as const,
    testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
    testScenario: { execution: [{ concurrency: 1, "hold-for": "1m" }] },
    regionalTaskDetails: { "us-east-1": { dltAvailableTasks: 10 } },
  };

  it("rejects name shorter than 3 characters", () => {
    expect(() => createTestSchema.parse({ ...minimalPayload, testName: "ab" })).toThrow(/at least 3 characters/);
  });

  it("rejects name with control characters", () => {
    expect(() => createTestSchema.parse({ ...minimalPayload, testName: "test\tname" })).toThrow(
      /disallowed control character/
    );
  });
});

describe("setBaselineSchema", () => {
  it("accepts valid testRunId", () => {
    expect(setBaselineSchema.parse({ testRunId: "run-123" })).toEqual({ testRunId: "run-123" });
  });

  it("rejects missing testRunId", () => {
    expect(() => setBaselineSchema.parse({})).toThrow();
  });

  it("rejects extra fields", () => {
    expect(() => setBaselineSchema.parse({ testRunId: "run-123", extra: "field" })).toThrow();
  });
});

describe("deleteTestRunsSchema", () => {
  it("accepts array of valid run ids", () => {
    expect(deleteTestRunsSchema.parse(["run-1", "run-2"])).toEqual(["run-1", "run-2"]);
  });

  it("accepts the maximum number of run ids", () => {
    const runIds = Array.from({ length: MAX_TEST_RUNS_PER_DELETE_REQUEST }, (_, index) => `run-${index}`);

    expect(deleteTestRunsSchema.parse(runIds)).toEqual(runIds);
  });

  it("rejects empty array", () => {
    expect(() => deleteTestRunsSchema.parse([])).toThrow(/At least one/);
  });

  it("rejects more than the maximum number of run ids with a deterministic error", () => {
    const runIds = Array.from({ length: MAX_TEST_RUNS_PER_DELETE_REQUEST + 1 }, (_, index) => `run-${index}`);

    expect(() => deleteTestRunsSchema.parse(runIds)).toThrow(
      `A maximum of ${MAX_TEST_RUNS_PER_DELETE_REQUEST} testRunIds is allowed per request`
    );
  });

  it("rejects invalid run id in array", () => {
    expect(() => deleteTestRunsSchema.parse(["valid-id", "invalid@id"])).toThrow(/alphanumeric/);
  });
});
