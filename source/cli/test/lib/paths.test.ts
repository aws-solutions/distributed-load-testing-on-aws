// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/mock/home",
}));

import { existsSync, mkdirSync } from "node:fs";
import { DLT_DIR, ensureDltDir } from "../../src/lib/paths.js";

describe("paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("DLT_DIR", () => {
    it("is based on homedir", () => {
      expect(DLT_DIR).toBe("/mock/home/.dlt");
    });
  });

  describe("ensureDltDir", () => {
    it("creates the directory if it does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      ensureDltDir();
      expect(mkdirSync).toHaveBeenCalledWith("/mock/home/.dlt", {
        recursive: true,
        mode: 0o700,
      });
    });

    it("does not create the directory if it already exists", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      ensureDltDir();
      expect(mkdirSync).not.toHaveBeenCalled();
    });
  });
});
