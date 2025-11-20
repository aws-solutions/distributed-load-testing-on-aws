// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors.js";

describe("AppError", () => {
  it("should create an AppError with message and code", () => {
    const error = new AppError("Test error", 400);
    
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toBe("Test error");
    expect(error.code).toBe(400);
    expect(error.name).toBe("AppError");
  });

  it("should handle different status codes", () => {
    const error404 = new AppError("Not found", 404);
    const error500 = new AppError("Internal error", 500);
    
    expect(error404.code).toBe(404);
    expect(error500.code).toBe(500);
  });

  it("should preserve error stack trace", () => {
    const error = new AppError("Test error", 400);
    
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("AppError");
  });
});
