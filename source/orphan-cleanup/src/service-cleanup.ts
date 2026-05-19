// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Deletes orphaned ECS services.
 *
 * Unlike the task-canceler's graceful drain (which waits up to 150s for
 * SIGTERM handlers), orphan cleanup uses a shorter cycle: scale to zero,
 * brief grace period, then force-delete. These services have no active
 * step function — the test is already terminal — so we prioritize
 * resource reclamation over graceful shutdown.
 *
 * Errors on individual services are logged and skipped so that one
 * stuck service does not block cleanup of the rest.
 */

import type { Logger } from "@amzn/dlt-common";
import {
    DeleteServiceCommand,
    type ECSClient,
    ServiceNotActiveException,
    ServiceNotFoundException,
    UpdateServiceCommand,
} from "@aws-sdk/client-ecs";
import type { DiscoveredService } from "./service-scanner.js";

/**
 * Default grace period (ms) after scaling to zero before force-deleting.
 * Shorter than the task-canceler's 30s + 120s drain cycle — orphaned
 * services have no active orchestration waiting for results.
 */
export const DEFAULT_ORPHAN_GRACE_PERIOD_MS = 10_000;

/** Result of cleaning up a single orphaned service. */
export interface CleanupResult {
  readonly serviceName: string;
  readonly cluster: string;
  readonly testId: string;
  readonly success: boolean;
  readonly error?: string;
}

/** Parameters for {@link cleanupOrphanedServices}. */
export interface CleanupOrphanedServicesParams {
  readonly ecs: ECSClient;
  readonly orphans: readonly DiscoveredService[];
  readonly logger: Logger;
  /** Override for testing. Defaults to {@link DEFAULT_ORPHAN_GRACE_PERIOD_MS}. */
  readonly gracePeriodMs?: number;
}

/**
 * Deletes a list of orphaned ECS services.
 *
 * For each service:
 * 1. `updateService(desiredCount: 0)` — sends SIGTERM to running tasks
 * 2. Wait a brief grace period
 * 3. `deleteService({ force: true })` — removes the service
 *
 * Errors on individual services are caught and recorded in the results;
 * processing continues with the remaining services.
 */
export async function cleanupOrphanedServices(
  params: CleanupOrphanedServicesParams
): Promise<readonly CleanupResult[]> {
  const { ecs, orphans, logger, gracePeriodMs = DEFAULT_ORPHAN_GRACE_PERIOD_MS } = params;

  const results = await Promise.all(
    orphans.map((orphan) => deleteOrphanedService(ecs, orphan, gracePeriodMs, logger))
  );

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  logger.info("Orphan cleanup complete", { succeeded, failed, total: results.length });

  return results;
}

/**
 * Scales down and force-deletes a single orphaned ECS service.
 * Returns a {@link CleanupResult} — never throws.
 */
async function deleteOrphanedService(
  ecs: ECSClient,
  service: DiscoveredService,
  gracePeriodMs: number,
  logger: Logger
): Promise<CleanupResult> {
  const { serviceName, cluster, testId } = service;

  try {
    // Step 1: Scale to zero — sends SIGTERM to running tasks
    logger.info("Scaling orphaned service to zero", { serviceName, cluster, testId });
    try {
      await ecs.send(
        new UpdateServiceCommand({
          cluster,
          service: serviceName,
          desiredCount: 0,
        })
      );
    } catch (error: unknown) {
      if (isServiceGoneError(error)) {
        logger.info("Orphaned service already gone during scale-down", { serviceName });
        return { serviceName, cluster, testId, success: true };
      }
      throw error;
    }

    // Step 2: Brief grace period for SIGTERM handlers
    await sleep(gracePeriodMs);

    // Step 3: Force-delete the service
    logger.info("Force-deleting orphaned service", { serviceName, cluster, testId });
    try {
      await ecs.send(
        new DeleteServiceCommand({
          cluster,
          service: serviceName,
          force: true,
        })
      );
    } catch (error: unknown) {
      if (isServiceGoneError(error)) {
        logger.info("Orphaned service already gone during deletion", { serviceName });
        return { serviceName, cluster, testId, success: true };
      }
      throw error;
    }

    logger.info("Orphaned service deleted", { serviceName, cluster, testId });
    return { serviceName, cluster, testId, success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to clean up orphaned service", { serviceName, cluster, testId, error });
    return { serviceName, cluster, testId, success: false, error: message };
  }
}

/**
 * Checks whether an error indicates the service no longer exists.
 */
function isServiceGoneError(error: unknown): boolean {
  return error instanceof ServiceNotFoundException || error instanceof ServiceNotActiveException;
}

/** Promise-based sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
