// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Determines which test IDs have active Step Functions executions.
 *
 * A service is orphaned if its associated Step Functions execution is
 * terminal (SUCCEEDED, FAILED, TIMED_OUT, ABORTED) or absent entirely.
 * This module queries SFN for all RUNNING executions and extracts their
 * testIds from the execution name (format: scenario-{testId}-run-{testRunId}).
 */

import type { Logger } from "@amzn/dlt-common";
import { parseExecutionName } from "@amzn/dlt-common";
import { ExecutionStatus, ListExecutionsCommand, type SFNClient } from "@aws-sdk/client-sfn";

/**
 * Returns the set of testIds that have a RUNNING Step Functions execution.
 *
 * The testId is extracted directly from the execution name using
 * `parseExecutionName()`. This avoids calling `DescribeExecution` per
 * execution (eliminating the N+1 API call pattern).
 */
export async function getActiveTestIds(
  sfn: SFNClient,
  stateMachineArn: string,
  logger: Logger
): Promise<ReadonlySet<string>> {
  const activeIds = new Set<string>();
  let nextToken: string | undefined;

  do {
    const listResult = await sfn.send(
      new ListExecutionsCommand({
        stateMachineArn,
        statusFilter: ExecutionStatus.RUNNING,
        nextToken,
      })
    );

    for (const execution of listResult.executions ?? []) {
      if (!execution.name) {
        logger.error("Execution has no name", { executionArn: execution.executionArn });
        throw new Error(`Execution has no name: ${execution.executionArn}`);
      }

      const { testId } = parseExecutionName(execution.name);
      activeIds.add(testId);
    }

    nextToken = listResult.nextToken;
  } while (nextToken);

  logger.info("Active Step Functions executions", { activeTestIdCount: activeIds.size });
  return activeIds;
}
