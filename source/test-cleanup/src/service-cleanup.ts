// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Logger } from "@amzn/dlt-common";
import {
  AccessDeniedException,
  DeleteServiceCommand,
  DescribeServicesCommand,
  type ECSClient,
  ServiceNotActiveException,
  ServiceNotFoundException,
  UpdateServiceCommand,
} from "@aws-sdk/client-ecs";

/**
 * Default initial grace period (ms) after scaling to zero before polling
 * drain status. Allows SIGTERM handlers time to begin copying partial results.
 */
export const DEFAULT_INITIAL_GRACE_PERIOD_MS = 30_000;

/**
 * Default interval (ms) between `describeServices` polls while waiting for drain.
 */
export const DEFAULT_DRAIN_POLL_INTERVAL_MS = 10_000;

/**
 * Default maximum time (ms) to wait for the service to drain after the initial
 * grace period. If still not drained after this, force-delete.
 *
 * Fargate `stopTimeout` max is 120s. We allow the full 120s for the
 * drain polling phase (on top of the 30s initial grace), giving tasks
 * up to ~150s total to handle SIGTERM.
 */
export const DEFAULT_MAX_DRAIN_WAIT_MS = 120_000;

/** Parameters for {@link drainAndDeleteService}. */
export interface DrainAndDeleteServiceParams {
  readonly ecs: ECSClient;
  readonly cluster: string;
  readonly serviceName: string;
  readonly logger: Logger;
  /** Override for testing. Defaults to {@link DEFAULT_INITIAL_GRACE_PERIOD_MS}. */
  readonly initialGracePeriodMs?: number;
  /** Override for testing. Defaults to {@link DEFAULT_DRAIN_POLL_INTERVAL_MS}. */
  readonly drainPollIntervalMs?: number;
  /** Override for testing. Defaults to {@link DEFAULT_MAX_DRAIN_WAIT_MS}. */
  readonly maxDrainWaitMs?: number;
}

/**
 * Gracefully drains and deletes an ECS service.
 *
 * 1. `updateService(desiredCount: 0)` — triggers SIGTERM to all running tasks
 * 2. Wait 30s initial grace period for SIGTERM handlers to start
 * 3. Poll `describeServices` every 10s for up to 120s, checking `runningCount === 0`
 * 4. If drained: `deleteService()` (no force needed)
 * 5. If not drained after timeout: `deleteService({ force: true })`
 *
 * We attempt to allow adequate time for SIGTERM tasks, such as copying logs over
 * when a load test is manually canceled. We may need to adjust timings.
 *
 * Catches `ServiceNotFoundException` / `ServiceNotActiveException` gracefully
 * throughout — the service may have already been cleaned up by another process.
 */
export async function drainAndDeleteService(params: DrainAndDeleteServiceParams): Promise<void> {
  const {
    ecs,
    cluster,
    serviceName,
    logger,
    initialGracePeriodMs = DEFAULT_INITIAL_GRACE_PERIOD_MS,
    drainPollIntervalMs = DEFAULT_DRAIN_POLL_INTERVAL_MS,
    maxDrainWaitMs = DEFAULT_MAX_DRAIN_WAIT_MS,
  } = params;

  // Pre-check: verify the service exists before attempting mutating calls.
  // When a test is cancelled before the task-runner creates the ECS service,
  // the tag-based IAM condition (aws:ResourceTag/SolutionId) cannot be
  // evaluated against a non-existent resource, so IAM denies the request
  // with AccessDenied rather than letting ECS return ServiceNotFoundException.
  // DescribeServices hits the same IAM denial, so we treat AccessDenied here
  // as equivalent to "service does not exist".
  // @see https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html
  try {
    const describeResponse = await ecs.send(
      new DescribeServicesCommand({ cluster, services: [serviceName] })
    );
    if (!describeResponse.services?.[0]) {
      logger.info("Service does not exist — nothing to clean up", { serviceName });
      return;
    }
  } catch (error: unknown) {
    if (error instanceof AccessDeniedException) {
      logger.info("Service does not exist (tag condition unresolvable) — nothing to clean up", { serviceName });
      return;
    }
    throw error;
  }

  // Step 1: Scale to zero — sends SIGTERM to all tasks
  try {
    logger.info("Scaling service to zero", { serviceName, cluster });
    await ecs.send(
      new UpdateServiceCommand({
        cluster,
        service: serviceName,
        desiredCount: 0,
      })
    );
  } catch (error: unknown) {
    if (isServiceNotFoundError(error)) {
      logger.info("Service not found during scale-down — already cleaned up", { serviceName });
      return;
    }
    throw error;
  }

  // Step 2: Initial grace period for SIGTERM handlers
  logger.info("Waiting initial grace period for SIGTERM handlers", {
    gracePeriodMs: initialGracePeriodMs,
  });
  await sleep(initialGracePeriodMs);

  // Step 3: Poll for drain completion
  const drained = await waitForDrain({
    ecs,
    cluster,
    serviceName,
    logger,
    drainPollIntervalMs,
    maxDrainWaitMs,
  });

  // Step 4/5: Delete the service
  try {
    if (drained) {
      logger.info("Service drained successfully — deleting", { serviceName });
      await ecs.send(
        new DeleteServiceCommand({
          cluster,
          service: serviceName,
        })
      );
    } else {
      logger.warn("Service did not drain within timeout — force deleting", { serviceName });
      await ecs.send(
        new DeleteServiceCommand({
          cluster,
          service: serviceName,
          force: true,
        })
      );
    }
  } catch (error: unknown) {
    if (isServiceNotFoundError(error)) {
      logger.info("Service not found during deletion — already cleaned up", { serviceName });
      return;
    }
    throw error;
  }

  logger.info("Service deleted", { serviceName });
}

/** Internal params for the drain polling loop. */
interface WaitForDrainParams {
  readonly ecs: ECSClient;
  readonly cluster: string;
  readonly serviceName: string;
  readonly logger: Logger;
  readonly drainPollIntervalMs: number;
  readonly maxDrainWaitMs: number;
}

/**
 * Polls `describeServices` until `runningCount === 0` or timeout.
 * Returns `true` if the service drained within the timeout.
 */
async function waitForDrain(params: WaitForDrainParams): Promise<boolean> {
  const { ecs, cluster, serviceName, logger, drainPollIntervalMs, maxDrainWaitMs } = params;
  const deadline = Date.now() + maxDrainWaitMs;

  while (Date.now() < deadline) {
    try {
      const response = await ecs.send(
        new DescribeServicesCommand({
          cluster,
          services: [serviceName],
        })
      );

      const service = response.services?.[0];
      if (!service) {
        logger.info("Service no longer exists — treating as drained", { serviceName });
        return true;
      }

      const runningCount = service.runningCount ?? 0;
      logger.info("Polling service drain status", { serviceName, runningCount });

      if (runningCount === 0) {
        return true;
      }
    } catch (error: unknown) {
      if (isServiceNotFoundError(error)) {
        logger.info("Service not found during drain poll — treating as drained", { serviceName });
        return true;
      }
      throw error;
    }

    await sleep(drainPollIntervalMs);
  }

  return false;
}

/**
 * Checks whether an error indicates the service does not exist or is
 * no longer active.
 */
function isServiceNotFoundError(error: unknown): boolean {
  return error instanceof ServiceNotFoundException || error instanceof ServiceNotActiveException;
}

/** Promise-based sleep for the given duration in milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
