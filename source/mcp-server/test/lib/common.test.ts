// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  parseEventWithSchema,
  TEST_RUN_ID_LENGTH,
  TEST_RUN_ID_REGEX,
  TEST_SCENARIO_ID_LENGTH,
  TEST_SCENARIO_ID_REGEX,
} from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";

describe("parseEventWithSchema", () => {
  const testSchema = z.object({
    testId: z.string(),
    count: z.number(),
  });

  it("should successfully parse valid input", () => {
    const event = { testId: "test-123", count: 5 };
    const result = parseEventWithSchema(testSchema, event);

    expect(result).toEqual({ testId: "test-123", count: 5 });
  });

  it("should throw AppError with 400 status for invalid input", () => {
    const event = { testId: "test-123", count: "invalid" };

    expect(() => parseEventWithSchema(testSchema, event)).toThrow(AppError);
    try {
      parseEventWithSchema(testSchema, event);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(400);
      expect((error as AppError).message).toContain("Validation failed");
    }
  });

  it("should include field path in error message", () => {
    const event = { testId: "test-123", count: "invalid" };

    try {
      parseEventWithSchema(testSchema, event);
    } catch (error) {
      expect((error as AppError).message).toContain("count");
    }
  });

  it("should handle missing required fields", () => {
    const event = { testId: "test-123" };

    expect(() => parseEventWithSchema(testSchema, event)).toThrow(AppError);
    try {
      parseEventWithSchema(testSchema, event);
    } catch (error) {
      expect((error as AppError).code).toBe(400);
      expect((error as AppError).message).toContain("count");
    }
  });

  it("should pass through non-ZodError errors", () => {
    const errorSchema = z.object({}).transform(() => {
      throw new Error("Generic error");
    });
    const event = {};

    expect(() => parseEventWithSchema(errorSchema, event)).toThrow("Generic error");
    expect(() => parseEventWithSchema(errorSchema, event)).not.toThrow(AppError);
  });
});

describe("Constants", () => {
  it("should have correct TEST_SCENARIO_ID_LENGTH", () => {
    expect(TEST_SCENARIO_ID_LENGTH).toBe(10);
  });

  it("should have correct TEST_RUN_ID_LENGTH", () => {
    expect(TEST_RUN_ID_LENGTH).toBe(10);
  });

  describe("TEST_SCENARIO_ID_REGEX", () => {
    it("should match valid scenario IDs", () => {
      expect(TEST_SCENARIO_ID_REGEX.test("abc123-xyz")).toBe(true);
      expect(TEST_SCENARIO_ID_REGEX.test("ABC123XYZ9")).toBe(true);
      expect(TEST_SCENARIO_ID_REGEX.test("test-id-01")).toBe(true);
    });

    it("should reject invalid scenario IDs", () => {
      expect(TEST_SCENARIO_ID_REGEX.test("abc_123")).toBe(false);
      expect(TEST_SCENARIO_ID_REGEX.test("abc 123")).toBe(false);
      expect(TEST_SCENARIO_ID_REGEX.test("abc@123")).toBe(false);
      expect(TEST_SCENARIO_ID_REGEX.test("")).toBe(false);
    });
  });

  describe("TEST_RUN_ID_REGEX", () => {
    it("should match valid run IDs", () => {
      expect(TEST_RUN_ID_REGEX.test("run123-xyz")).toBe(true);
      expect(TEST_RUN_ID_REGEX.test("RUN123XYZ9")).toBe(true);
      expect(TEST_RUN_ID_REGEX.test("test-run-1")).toBe(true);
    });

    it("should reject invalid run IDs", () => {
      expect(TEST_RUN_ID_REGEX.test("run_123")).toBe(false);
      expect(TEST_RUN_ID_REGEX.test("run 123")).toBe(false);
      expect(TEST_RUN_ID_REGEX.test("run@123")).toBe(false);
      expect(TEST_RUN_ID_REGEX.test("")).toBe(false);
    });
  });
});
