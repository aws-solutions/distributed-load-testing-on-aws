// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { generateUniqueId } from "../src/id.js";

const ALPHA_NUMERIC_PATTERN = /^[A-Za-z0-9]+$/;

describe("generateUniqueId", () => {
  it("returns a string of length 10 by default", () => {
    const id = generateUniqueId();
    expect(id).toHaveLength(10);
    expect(id).toMatch(ALPHA_NUMERIC_PATTERN);
  });

  it("returns a string of length 1", () => {
    const id = generateUniqueId(1);
    expect(id).toHaveLength(1);
    expect(id).toMatch(ALPHA_NUMERIC_PATTERN);
  });

  it("returns a string of length 20", () => {
    const id = generateUniqueId(20);
    expect(id).toHaveLength(20);
    expect(id).toMatch(ALPHA_NUMERIC_PATTERN);
  });

  it("returns different values on successive calls", () => {
    const a = generateUniqueId();
    const b = generateUniqueId();
    // Extremely unlikely to collide with 62^10 possibilities
    expect(a).not.toBe(b);
  });
});
