// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { buildSpecTemplate } from "../../src/lib/spec-template.js";

describe("buildSpecTemplate", () => {
  it("emits HTTP fields for a simple test and standard load fields", () => {
    const spec = buildSpecTemplate("simple", false);
    expect(spec).toMatchObject({
      testType: "simple",
      httpEndpoint: expect.any(String),
      httpMethod: "GET",
      concurrency: 10,
      holdFor: "10m",
    });
    expect(spec).not.toHaveProperty("file");
    expect(spec).not.toHaveProperty("nativeMode");
  });

  it("emits a framework-specific script path for script test types", () => {
    expect(buildSpecTemplate("jmeter", false)["file"]).toBe("./path/to/script.jmx");
    expect(buildSpecTemplate("k6", false)["file"]).toBe("./path/to/script.js");
    expect(buildSpecTemplate("locust", false)["file"]).toBe("./path/to/script.py");
  });

  it("emits only native fields (no load overrides) for a native locust template", () => {
    const spec = buildSpecTemplate("locust", true);
    expect(spec).toMatchObject({
      nativeMode: true,
      maxTestDuration: "30m",
    });
    // Native runs are duration-driven — no standard concurrency/hold-for and no
    // per-framework load overrides.
    expect(spec).not.toHaveProperty("concurrency");
    expect(spec).not.toHaveProperty("holdFor");
    expect(spec).not.toHaveProperty("locustUsers");
  });

  it("emits only maxTestDuration for native k6 and jmeter templates", () => {
    for (const testType of ["k6", "jmeter"]) {
      const spec = buildSpecTemplate(testType, true);
      expect(spec).toMatchObject({ nativeMode: true, maxTestDuration: "30m" });
      expect(spec).not.toHaveProperty("locustUsers");
      expect(spec).not.toHaveProperty("k6Vus");
    }
  });

  it("always includes name/description/regions/tags/healthyThreshold", () => {
    const spec = buildSpecTemplate("simple", false);
    expect(spec).toMatchObject({
      testName: expect.any(String),
      testDescription: expect.any(String),
      regions: ["us-east-1"],
      tags: expect.any(Array),
      healthyThreshold: 90,
    });
  });

  it("includes scheduling fields that default to Run Now (all empty except UTC)", () => {
    for (const [testType, native] of [
      ["simple", false],
      ["locust", false],
      ["k6", true],
    ] as const) {
      const spec = buildSpecTemplate(testType, native);
      expect(spec).toMatchObject({
        cron: "",
        scheduleDate: "",
        scheduleTime: "",
        scheduleTimezone: "UTC",
      });
      // recurrence is vestigial (UI hardcodes it; cron encodes cadence) — not emitted.
      expect(spec).not.toHaveProperty("recurrence");
    }
  });
});
