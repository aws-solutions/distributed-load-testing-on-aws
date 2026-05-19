// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Logger } from "@amzn/dlt-common";
import { ExecutionStatus, ListExecutionsCommand, SFNClient } from "@aws-sdk/client-sfn";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveTestIds } from "../src/execution-check.js";

const sfnMock = mockClient(SFNClient);

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  appendKeys: vi.fn(),
} as unknown as Logger;

const STATE_MACHINE_ARN = "arn:aws:states:us-east-1:123456789:stateMachine:dlt-test";

function makeExecution(name: string | undefined) {
  return {
    executionArn: `arn:aws:states:us-east-1:123456789:execution:dlt-test:${name ?? "unknown"}`,
    stateMachineArn: STATE_MACHINE_ARN,
    name: name,
    status: "RUNNING" as const,
    startDate: new Date(),
  };
}

beforeEach(() => {
  sfnMock.reset();
  vi.clearAllMocks();
});

describe("getActiveTestIds", () => {
  it("extracts testIds from execution names", async () => {
    sfnMock.on(ListExecutionsCommand).resolves({
      executions: [makeExecution("scenario-testAAA-run-runAAA"), makeExecution("scenario-testBBB-run-runBBB")],
    });

    const result = await getActiveTestIds(new SFNClient({}), STATE_MACHINE_ARN, logger);
    expect(result).toEqual(new Set(["testAAA", "testBBB"]));
  });

  it("returns empty set when no running executions", async () => {
    sfnMock.on(ListExecutionsCommand).resolves({ executions: [] });

    const result = await getActiveTestIds(new SFNClient({}), STATE_MACHINE_ARN, logger);
    expect(result.size).toBe(0);
  });

  it("handles paginated list results", async () => {
    sfnMock
      .on(ListExecutionsCommand)
      .resolvesOnce({
        executions: [makeExecution("scenario-test1-run-run1")],
        nextToken: "page2",
      })
      .resolvesOnce({
        executions: [makeExecution("scenario-test2-run-run2")],
      });

    const result = await getActiveTestIds(new SFNClient({}), STATE_MACHINE_ARN, logger);
    expect(result).toEqual(new Set(["test1", "test2"]));
  });

  it("deduplicates testIds across executions", async () => {
    sfnMock.on(ListExecutionsCommand).resolves({
      executions: [makeExecution("scenario-sameTest-run-run1"), makeExecution("scenario-sameTest-run-run2")],
    });

    const result = await getActiveTestIds(new SFNClient({}), STATE_MACHINE_ARN, logger);
    expect(result.size).toBe(1);
    expect(result.has("sameTest")).toBe(true);
  });

  it("passes RUNNING status filter to ListExecutions", async () => {
    sfnMock.on(ListExecutionsCommand).resolves({ executions: [] });

    await getActiveTestIds(new SFNClient({}), STATE_MACHINE_ARN, logger);

    const call = sfnMock.commandCalls(ListExecutionsCommand)[0];
    expect(call?.args[0].input.statusFilter).toBe(ExecutionStatus.RUNNING);
  });

  it("throws when execution has no name", async () => {
    sfnMock.on(ListExecutionsCommand).resolves({
      executions: [makeExecution(undefined)],
    });

    await expect(getActiveTestIds(new SFNClient({}), STATE_MACHINE_ARN, logger)).rejects.toThrow(
      "Execution has no name"
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it("throws when execution name has invalid format", async () => {
    sfnMock.on(ListExecutionsCommand).resolves({
      executions: [makeExecution("not-a-valid-name")],
    });

    await expect(getActiveTestIds(new SFNClient({}), STATE_MACHINE_ARN, logger)).rejects.toThrow(
      "Invalid execution name format"
    );
  });

  it("does not call DescribeExecution", async () => {
    sfnMock.on(ListExecutionsCommand).resolves({
      executions: [makeExecution("scenario-abc-run-xyz")],
    });

    await getActiveTestIds(new SFNClient({}), STATE_MACHINE_ARN, logger);

    // Only ListExecutionsCommand should have been called — no DescribeExecution
    const allCalls = sfnMock.calls();
    expect(allCalls).toHaveLength(1);
    expect(allCalls[0]?.args[0]).toBeInstanceOf(ListExecutionsCommand);
  });
});
