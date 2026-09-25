// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: () => "/mock/home",
}));

import { existsSync, mkdirSync, chmodSync, statSync } from "node:fs";
import { DLT_DIR, ensureDltDir, ensureMode } from "../../src/lib/paths.js";

// Helper: make statSync report a given permission mode.
const mockMode = (mode: number) => {
  vi.mocked(statSync).mockReturnValue({ mode } as unknown as ReturnType<typeof statSync>);
};

describe("paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: existing entries report loosened perms so chmod repairs run.
    mockMode(0o755);
  });

  describe("DLT_DIR", () => {
    it("is based on homedir", () => {
      expect(DLT_DIR).toBe("/mock/home/.dlt");
    });
  });

  describe("ensureMode", () => {
    it("chmods when the current mode differs from the desired mode", () => {
      mockMode(0o644);
      ensureMode("/some/file", 0o600);
      expect(chmodSync).toHaveBeenCalledWith("/some/file", 0o600);
    });

    it("skips chmod when the current mode already matches", () => {
      mockMode(0o600);
      ensureMode("/some/file", 0o600);
      expect(chmodSync).not.toHaveBeenCalled();
    });

    it("ignores non-permission bits (file type) when comparing", () => {
      // 0o100600 = regular file (0o100000) with 0o600 perms
      mockMode(0o100600);
      ensureMode("/some/file", 0o600);
      expect(chmodSync).not.toHaveBeenCalled();
    });
  });

  describe("ensureDltDir", () => {
    it("creates the directory with 0700 if it does not exist", () => {
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

    it("repairs permissions on an existing directory (e.g. restored as 0755)", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      mockMode(0o755);
      ensureDltDir();
      // chmod is applied even though the directory was not (re)created
      expect(mkdirSync).not.toHaveBeenCalled();
      expect(chmodSync).toHaveBeenCalledWith("/mock/home/.dlt", 0o700);
    });

    it("does not chmod an existing directory that is already 0700", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      mockMode(0o700);
      ensureDltDir();
      expect(chmodSync).not.toHaveBeenCalled();
    });
  });
});
