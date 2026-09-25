// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseEventWithSchema } from "../../src/lib/common.js";
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
