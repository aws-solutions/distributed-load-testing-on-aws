// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { classifyStopCode, sanitizeStopReason, StopCategory } from "../src/task-failure.ts";

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

describe("sanitizeStopReason", () => {
  it("passes through a benign reason unchanged", () => {
    expect(sanitizeStopReason("Essential container in task exited")).toBe("Essential container in task exited");
  });

  it("redacts AWS account IDs", () => {
    const out = sanitizeStopReason("Task stopped for account 123456789012 quota");
    expect(out).toBe("Task stopped for account <account-id> quota");
    expect(out).not.toContain("123456789012");
  });

  it("redacts ARNs", () => {
    const out = sanitizeStopReason("AccessDenied for arn:aws:iam::123456789012:role/customer-secret-role during pull");
    expect(out).toContain("<arn>");
    expect(out).not.toContain("customer-secret-role");
    expect(out).not.toContain("123456789012");
  });

  it("redacts ECR image URIs including the account id and customer image name", () => {
    const out = sanitizeStopReason(
      "CannotPullContainerError: 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-private-repo:latest not found"
    );
    expect(out).toContain("CannotPullContainerError:");
    expect(out).toContain("<image>");
    expect(out).not.toContain("my-private-repo");
    expect(out).not.toContain("123456789012");
  });

  it("redacts S3 URIs", () => {
    const out = sanitizeStopReason("ResourceInitializationError: failed to download s3://customer-bucket/config.json");
    expect(out).toContain("<s3-uri>");
    expect(out).not.toContain("customer-bucket");
  });

  it("redacts IPv4 addresses", () => {
    const out = sanitizeStopReason("Timeout connecting to 10.0.42.17");
    expect(out).toBe("Timeout connecting to <ip>");
  });

  it("redacts IPv6 addresses", () => {
    const out = sanitizeStopReason("Timeout connecting to 2001:0db8:85a3:0000:0000:8a2e:0370:7334");
    expect(out).toContain("<ip>");
    expect(out).not.toContain("2001");
  });

  it("redacts email addresses (PII)", () => {
    const out = sanitizeStopReason("Access denied for user jane.doe@example.com");
    expect(out).toBe("Access denied for user <email>");
    expect(out).not.toContain("jane.doe@example.com");
  });

  it("redacts credentials and secret-shaped tokens", () => {
    expect(sanitizeStopReason("leaked AKIAIOSFODNN7EXAMPLE key")).toBe("leaked <redacted> key");
    expect(sanitizeStopReason("aws_secret_access_key=abc123def456")).toBe("<redacted>");
    expect(sanitizeStopReason("Authorization: Bearer customer-token")).toBe("<redacted>");
    expect(sanitizeStopReason("Authorization=Basic customer-token")).toBe("<redacted>");
    expect(sanitizeStopReason("Authorization: Digest customer-token")).toBe("<redacted>");
    expect(sanitizeStopReason("Authorization: customer-token")).toBe("<redacted>");
    expect(sanitizeStopReason("x-api-key=customer-key")).toBe("<redacted>");
    expect(sanitizeStopReason("aws_session_token temporary-session-token")).toBe("<redacted>");
    expect(sanitizeStopReason("password: hunter2")).toBe("<redacted>");
    // A space/tab-delimited secret value (no =/: delimiter) must not slip through.
    const spaceDelimited = sanitizeStopReason("aws_secret_access_key wJalrXUtnFEMI");
    expect(spaceDelimited).toBe("<redacted>");
    expect(spaceDelimited).not.toContain("wJalrXUtnFEMI");
  });

  it("handles hostile authorization input without ambiguous backtracking", () => {
    const hostile = `Authorization:${" ".repeat(100_000)}Bearer${" ".repeat(100_000)}`;
    expect(sanitizeStopReason(hostile)).toBe("<redacted>");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeStopReason("  Essential\n container   exited \t")).toBe("Essential container exited");
  });

  it("caps the length at 1024 characters", () => {
    expect(sanitizeStopReason("x".repeat(2000)).length).toBe(1024);
  });

  it("handles empty input", () => {
    expect(sanitizeStopReason("")).toBe("");
  });
});
