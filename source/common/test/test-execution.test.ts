// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  FRAMEWORKS,
  MAX_TEST_DURATION_SECONDS,
  TEST_TYPE_TO_FRAMEWORK,
} from "../src/test-execution.js";

describe("MAX_TEST_DURATION_SECONDS", () => {
  it("is 24 hours in seconds", () => {
    expect(MAX_TEST_DURATION_SECONDS).toBe(86_400);
  });
});

describe("FRAMEWORKS", () => {
  it("contains all supported frameworks", () => {
    expect(FRAMEWORKS).toEqual(["jmeter", "k6", "locust"]);
  });

  it("has exactly 3 entries", () => {
    expect(FRAMEWORKS).toHaveLength(3);
  });
});

describe("TEST_TYPE_TO_FRAMEWORK", () => {
  it("maps simple to locust", () => {
    expect(TEST_TYPE_TO_FRAMEWORK.simple).toBe("locust");
  });

  it("maps jmeter to jmeter", () => {
    expect(TEST_TYPE_TO_FRAMEWORK.jmeter).toBe("jmeter");
  });

  it("maps k6 to k6", () => {
    expect(TEST_TYPE_TO_FRAMEWORK.k6).toBe("k6");
  });

  it("maps locust to locust", () => {
    expect(TEST_TYPE_TO_FRAMEWORK.locust).toBe("locust");
  });

  it("covers all TestType values", () => {
    expect(Object.keys(TEST_TYPE_TO_FRAMEWORK).sort()).toEqual(
      ["jmeter", "k6", "locust", "simple"],
    );
  });
});
