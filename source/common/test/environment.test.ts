// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRequiredEnv } from "../src/environment.js";

describe("getRequiredEnv", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it("returns the value when the variable is set", () => {
    process.env["MY_VAR"] = "hello";
    expect(getRequiredEnv("MY_VAR")).toBe("hello");
  });

  it("trims whitespace from the value", () => {
    process.env["MY_VAR"] = "  hello  ";
    expect(getRequiredEnv("MY_VAR")).toBe("hello");
  });

  it("throws when the variable is not set", () => {
    delete process.env["MY_VAR"];
    expect(() => getRequiredEnv("MY_VAR")).toThrow('Required environment variable "MY_VAR" is not set or is empty');
  });

  it("throws when the variable is an empty string", () => {
    process.env["MY_VAR"] = "";
    expect(() => getRequiredEnv("MY_VAR")).toThrow('Required environment variable "MY_VAR" is not set or is empty');
  });

  it("throws when the variable is only whitespace", () => {
    process.env["MY_VAR"] = "   ";
    expect(() => getRequiredEnv("MY_VAR")).toThrow('Required environment variable "MY_VAR" is not set or is empty');
  });
});
