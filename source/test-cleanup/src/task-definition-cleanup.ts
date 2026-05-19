// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Logger } from "@amzn/dlt-common";
import {
  DeleteTaskDefinitionsCommand,
  DeregisterTaskDefinitionCommand,
  type ECSClient,
  ListTaskDefinitionsCommand,
  SortOrder,
  TaskDefinitionStatus,
} from "@aws-sdk/client-ecs";

/** Maximum number of task definition ARNs per `DeleteTaskDefinitions` call. */
const DELETE_BATCH_SIZE = 10;

/**
 * Number of most-recent INACTIVE revisions to retain.
 * Only revisions beyond this count are permanently deleted.
 */
const REVISIONS_TO_RETAIN = 3;

/** Parameters for {@link cleanupTaskDefinitions}. */
export interface CleanupTaskDefinitionsParams {
  readonly ecs: ECSClient;
  readonly family: string;
  readonly logger: Logger;
}

/**
 * Cleans up task definitions for a test-specific family.
 *
 * 1. Lists all ACTIVE revisions for the family and deregisters each one
 *    (moves ACTIVE → INACTIVE)
 * 2. Lists all INACTIVE revisions for the family (ascending order by revision)
 * 3. Retains the 3 most recent INACTIVE revisions
 * 4. Batch-deletes older INACTIVE revisions (10 at a time per API limit)
 *
 * This ensures no stale task definition revisions accumulate across test runs
 * while keeping recent revisions available for post-mortem analysis.
 * Errors during deregistration and deletion are logged but do not throw —
 * cleanup is best-effort.
 */
export async function cleanupTaskDefinitions(params: CleanupTaskDefinitionsParams): Promise<void> {
  const { ecs, family, logger } = params;

  // Step 1: Discover and deregister all ACTIVE revisions for the family
  await deregisterActiveRevisions(ecs, family, logger);

  // Step 2: List all INACTIVE revisions for the family
  const inactiveArns: string[] = [];
  let nextToken: string | undefined;

  try {
    do {
      const response = await ecs.send(
        new ListTaskDefinitionsCommand({
          familyPrefix: family,
          status: TaskDefinitionStatus.INACTIVE,
          sort: SortOrder.ASC,
          nextToken,
        })
      );

      if (response.taskDefinitionArns) {
        inactiveArns.push(...response.taskDefinitionArns);
      }
      nextToken = response.nextToken;
    } while (nextToken);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to list inactive task definitions", { family, error: message });
    return;
  }

  // Step 3: Retain the N most recent revisions.
  // ASC sort means oldest revisions first, newest last (per AWS API docs:
  // "ascending numerical order by revision so that the newest task definitions
  // in a family are listed last"). Slice off the oldest, keep the tail.
  const arnsToDelete =
    inactiveArns.length > REVISIONS_TO_RETAIN ? inactiveArns.slice(0, inactiveArns.length - REVISIONS_TO_RETAIN) : [];

  if (arnsToDelete.length === 0) {
    logger.info("No inactive task definitions beyond retention threshold to delete", {
      family,
      totalInactive: inactiveArns.length,
      retained: inactiveArns.length,
    });
    return;
  }

  logger.info("Deleting inactive task definitions beyond retention threshold", {
    family,
    totalInactive: inactiveArns.length,
    retained: REVISIONS_TO_RETAIN,
    deleting: arnsToDelete.length,
  });

  // Step 4: Batch-delete in groups of 10
  for (let i = 0; i < arnsToDelete.length; i += DELETE_BATCH_SIZE) {
    const batch = arnsToDelete.slice(i, i + DELETE_BATCH_SIZE);
    try {
      await ecs.send(
        new DeleteTaskDefinitionsCommand({
          taskDefinitions: batch,
        })
      );
      logger.info("Deleted task definition batch", { batchSize: batch.length, batchIndex: i / DELETE_BATCH_SIZE });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Failed to delete task definition batch — continuing", {
        batchIndex: i / DELETE_BATCH_SIZE,
        error: message,
      });
    }
  }
}

/**
 * Discovers all ACTIVE revisions for the given family and deregisters each one.
 * Errors are logged but do not throw — deregistration is best-effort.
 */
async function deregisterActiveRevisions(ecs: ECSClient, family: string, logger: Logger): Promise<void> {
  const activeArns: string[] = [];
  let nextToken: string | undefined;

  try {
    do {
      const response = await ecs.send(
        new ListTaskDefinitionsCommand({
          familyPrefix: family,
          status: TaskDefinitionStatus.ACTIVE,
          nextToken,
        })
      );

      if (response.taskDefinitionArns) {
        activeArns.push(...response.taskDefinitionArns);
      }
      nextToken = response.nextToken;
    } while (nextToken);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to list active task definitions for deregistration", { family, error: message });
    return;
  }

  if (activeArns.length === 0) {
    logger.info("No active task definitions found to deregister", { family });
    return;
  }

  logger.info("Deregistering active task definitions", { family, count: activeArns.length });

  for (const arn of activeArns) {
    try {
      await ecs.send(new DeregisterTaskDefinitionCommand({ taskDefinition: arn }));
      logger.info("Deregistered task definition", { taskDefinitionArn: arn });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Failed to deregister task definition — continuing", {
        taskDefinitionArn: arn,
        error: message,
      });
    }
  }
}
