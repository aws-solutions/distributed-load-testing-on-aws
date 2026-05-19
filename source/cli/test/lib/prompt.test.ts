// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExistsSync = vi.fn();
const mockQuestion = vi.fn();
const mockClose = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: mockQuestion,
    close: mockClose,
  }),
}));

import { confirmOverwrite } from "../../src/lib/prompt.js";

describe("confirmOverwrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips prompt when force is true", async () => {
    mockExistsSync.mockReturnValue(true);

    await confirmOverwrite("/some/path", true);

    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockQuestion).not.toHaveBeenCalled();
  });

  it("skips prompt when target does not exist", async () => {
    mockExistsSync.mockReturnValue(false);

    await confirmOverwrite("/some/path", false);

    expect(mockExistsSync).toHaveBeenCalledWith("/some/path");
    expect(mockQuestion).not.toHaveBeenCalled();
  });

  it("proceeds when user answers 'y'", async () => {
    mockExistsSync.mockReturnValue(true);
    mockQuestion.mockResolvedValue("y");

    await confirmOverwrite("/some/path", false);

    expect(mockQuestion).toHaveBeenCalledWith(expect.stringContaining("already exists"));
    expect(mockClose).toHaveBeenCalled();
  });

  it("proceeds when user answers 'Y'", async () => {
    mockExistsSync.mockReturnValue(true);
    mockQuestion.mockResolvedValue("Y");

    await confirmOverwrite("/some/path", false);

    expect(mockQuestion).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  it("throws when user answers 'n'", async () => {
    mockExistsSync.mockReturnValue(true);
    mockQuestion.mockResolvedValue("n");

    await expect(confirmOverwrite("/some/path", false)).rejects.toThrow("Aborted");
    expect(mockClose).toHaveBeenCalled();
  });

  it("throws when user answers empty string (default No)", async () => {
    mockExistsSync.mockReturnValue(true);
    mockQuestion.mockResolvedValue("");

    await expect(confirmOverwrite("/some/path", false)).rejects.toThrow("Aborted");
    expect(mockClose).toHaveBeenCalled();
  });

  it("closes readline even if an error occurs", async () => {
    mockExistsSync.mockReturnValue(true);
    mockQuestion.mockRejectedValue(new Error("readline error"));

    await expect(confirmOverwrite("/some/path", false)).rejects.toThrow("readline error");
    expect(mockClose).toHaveBeenCalled();
  });

  it("includes the path in the prompt message", async () => {
    mockExistsSync.mockReturnValue(true);
    mockQuestion.mockResolvedValue("y");

    await confirmOverwrite("/my/special/file.json", false);

    expect(mockQuestion).toHaveBeenCalledWith(expect.stringContaining("/my/special/file.json"));
  });
});
