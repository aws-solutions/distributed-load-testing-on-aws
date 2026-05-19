// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { classifyStopCode, StopCategory } from "../src/task-failure.js";

describe("classifyStopCode", () => {
  it("returns OutOfMemory for exit code 137", () => {
    expect(classifyStopCode("EssentialContainerExited", 137)).toBe(StopCategory.OutOfMemory);
  });

  it("returns OutOfMemory for exit code 137 regardless of stop code", () => {
    expect(classifyStopCode("SomeOtherCode", 137)).toBe(StopCategory.OutOfMemory);
  });

  it("returns Infrastructure for TaskFailedToStart", () => {
    expect(classifyStopCode("TaskFailedToStart", undefined)).toBe(StopCategory.Infrastructure);
  });

  it("returns Infrastructure for ServiceSchedulerInitiated", () => {
    expect(classifyStopCode("ServiceSchedulerInitiated", undefined)).toBe(StopCategory.Infrastructure);
  });

  it("returns Infrastructure for SpotInterruption", () => {
    expect(classifyStopCode("SpotInterruption", undefined)).toBe(StopCategory.Infrastructure);
  });

  it("returns ContainerError for non-zero exit code (exit 1)", () => {
    expect(classifyStopCode("EssentialContainerExited", 1)).toBe(StopCategory.ContainerError);
  });

  it("returns BztError for exit code 2", () => {
    expect(classifyStopCode("EssentialContainerExited", 2)).toBe(StopCategory.BztError);
  });

  it("returns Unknown for exit code 143 (SIGTERM during normal shutdown)", () => {
    expect(classifyStopCode("EssentialContainerExited", 143)).toBe(StopCategory.Unknown);
  });

  it("returns Unknown when exit code is undefined and stop code is unrecognized", () => {
    expect(classifyStopCode("UnknownStopCode", undefined)).toBe(StopCategory.Unknown);
  });

  it("returns Unknown when exit code is 0 (graceful — should not reach classifyStopCode in practice)", () => {
    expect(classifyStopCode("EssentialContainerExited", 0)).toBe(StopCategory.Unknown);
  });

  it("prioritizes OOM over infrastructure stop codes", () => {
    // Unlikely combination, but exit code 137 should always win
    expect(classifyStopCode("TaskFailedToStart", 137)).toBe(StopCategory.OutOfMemory);
  });
});
