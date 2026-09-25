// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { isIgnoredTestFile } from "../../src/archive/ignored-files.js";

describe("isIgnoredTestFile", () => {
  it("ignores macOS metadata", () => {
    expect(isIgnoredTestFile("__MACOSX")).toBe(true);
    expect(isIgnoredTestFile(".DS_Store")).toBe(true);
  });

  it("ignores anything starting with a dot", () => {
    expect(isIgnoredTestFile(".git")).toBe(true);
    expect(isIgnoredTestFile(".gitignore")).toBe(true);
    expect(isIgnoredTestFile(".hidden.py")).toBe(true);
  });

  it("keeps Python package files", () => {
    expect(isIgnoredTestFile("__init__.py")).toBe(false);
    expect(isIgnoredTestFile("__main__.py")).toBe(false);
    expect(isIgnoredTestFile("_helpers.py")).toBe(false);
  });

  it("keeps ordinary test assets", () => {
    expect(isIgnoredTestFile("locustfile.py")).toBe(false);
    expect(isIgnoredTestFile("locust.conf")).toBe(false);
    expect(isIgnoredTestFile("data.csv")).toBe(false);
    expect(isIgnoredTestFile("my-test.jmx")).toBe(false);
  });

  it("only matches __MACOSX exactly", () => {
    expect(isIgnoredTestFile("__MACOSX_backup")).toBe(false);
    expect(isIgnoredTestFile("my__MACOSX")).toBe(false);
    expect(isIgnoredTestFile("__macosx")).toBe(false);
  });
});
