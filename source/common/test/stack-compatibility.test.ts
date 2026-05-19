// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { checkRegionalCompatibility, isUpdateAvailable } from "../src/stack-compatibility.js";

describe("checkRegionalCompatibility", () => {
  it("returns compatible when versions are equal", () => {
    expect(checkRegionalCompatibility("v4.1.0", "v4.1.0", "4.1.0")).toEqual({ compatible: true });
  });

  it("returns compatible when spoke is between minimum and hub", () => {
    expect(checkRegionalCompatibility("v4.2.0", "v4.1.5", "4.1.0")).toEqual({ compatible: true });
  });

  it("returns incompatible when spoke is below minimum", () => {
    const result = checkRegionalCompatibility("v4.2.0", "v4.0.9", "4.1.0");
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain("below minimum");
    }
  });

  it("returns incompatible when spoke is newer than hub", () => {
    const result = checkRegionalCompatibility("v4.1.0", "v4.2.0", "4.1.0");
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain("newer than hub");
    }
  });

  it("returns incompatible for unparseable hub version", () => {
    const result = checkRegionalCompatibility("dev", "v4.1.0", "4.1.0");
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain("hub stack version");
    }
  });

  it("returns incompatible for unparseable spoke version", () => {
    const result = checkRegionalCompatibility("v4.1.0", "unknown", "4.1.0");
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain("regional stack version");
    }
  });

  it("returns incompatible for unparseable minimum version", () => {
    const result = checkRegionalCompatibility("v4.1.0", "v4.1.0", "bad");
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain("minimum compatible version");
    }
  });

  it("handles prefixed versions like custom-v4.0.12", () => {
    expect(checkRegionalCompatibility("custom-v4.1.0", "custom-v4.1.0", "4.1.0")).toEqual({ compatible: true });
  });

  it("compares patch versions numerically, not lexicographically", () => {
    expect(checkRegionalCompatibility("v4.0.10", "v4.0.9", "4.0.0")).toEqual({ compatible: true });
  });
});

describe("isUpdateAvailable", () => {
  it("returns true when latest is newer at major", () => {
    expect(isUpdateAvailable("v4.1.0", "5.0.0")).toBe(true);
  });

  it("returns true when latest is newer at minor", () => {
    expect(isUpdateAvailable("v4.1.0", "4.2.0")).toBe(true);
  });

  it("returns true when latest is newer at patch", () => {
    expect(isUpdateAvailable("v4.0.11", "4.0.15")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(isUpdateAvailable("v4.1.0", "4.1.0")).toBe(false);
  });

  it("returns false when current is ahead of latest", () => {
    expect(isUpdateAvailable("v4.2.0", "4.1.5")).toBe(false);
  });

  it("ignores suffixes after MAJOR.MINOR.PATCH", () => {
    expect(isUpdateAvailable("v4.1.0-ITL", "4.1.0")).toBe(false);
    expect(isUpdateAvailable("v4.1.0-rc1", "4.1.0")).toBe(false);
    expect(isUpdateAvailable("v4.1.0", "4.1.0-ITL")).toBe(false);
  });

  it("compares patch numerically, not lexicographically", () => {
    expect(isUpdateAvailable("v4.0.9", "4.0.10")).toBe(true);
  });

  it("returns false when currentVersion is undefined", () => {
    expect(isUpdateAvailable(undefined, "4.1.0")).toBe(false);
  });

  it("returns false when latestVersion is undefined", () => {
    expect(isUpdateAvailable("v4.1.0", undefined)).toBe(false);
  });

  it("returns false when currentVersion is unparseable", () => {
    expect(isUpdateAvailable("unknown", "4.1.0")).toBe(false);
  });

  it("returns false when latestVersion is unparseable", () => {
    expect(isUpdateAvailable("v4.1.0", "not-a-version")).toBe(false);
  });

  it("returns false when both inputs are empty strings", () => {
    expect(isUpdateAvailable("", "")).toBe(false);
  });
});
