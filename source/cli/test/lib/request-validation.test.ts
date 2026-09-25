// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { validateOutboundRequest } from "../../src/lib/request-validation.js";

describe("validateOutboundRequest", () => {
  const passingSchema = {
    safeParse: () => ({ success: true as const }),
  };

  const failingSchema = (issues: Array<{ path: PropertyKey[]; message: string }>) => ({
    safeParse: () => ({ success: false as const, error: { issues } }),
  });

  it("does nothing when the payload is valid", () => {
    expect(() => validateOutboundRequest(passingSchema, { any: "data" }, "test")).not.toThrow();
  });

  it("throws with the request name in the message", () => {
    const schema = failingSchema([{ path: ["field"], message: "required" }]);
    expect(() => validateOutboundRequest(schema, {}, "create scenario")).toThrow(
      "Invalid create scenario request: field: required",
    );
  });

  it("joins multiple issues with semicolons", () => {
    const schema = failingSchema([
      { path: ["name"], message: "too short" },
      { path: ["type"], message: "invalid enum" },
    ]);
    expect(() => validateOutboundRequest(schema, {}, "update")).toThrow(
      "Invalid update request: name: too short; type: invalid enum",
    );
  });

  it("uses (root) when the issue path is empty", () => {
    const schema = failingSchema([{ path: [], message: "expected object" }]);
    expect(() => validateOutboundRequest(schema, null, "delete")).toThrow(
      "Invalid delete request: (root): expected object",
    );
  });

  it("joins nested paths with dots", () => {
    const schema = failingSchema([{ path: ["testScenario", "execution", 0, "concurrency"], message: "too high" }]);
    expect(() => validateOutboundRequest(schema, {}, "create")).toThrow(
      "Invalid create request: testScenario.execution.0.concurrency: too high",
    );
  });

  it("throws an Error instance", () => {
    const schema = failingSchema([{ path: ["x"], message: "bad" }]);
    let caught: unknown;
    try {
      validateOutboundRequest(schema, {}, "op");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });
});
