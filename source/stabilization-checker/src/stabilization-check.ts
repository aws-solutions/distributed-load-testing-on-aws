// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { EcsServiceStatus, type Logger } from "@amzn/dlt-common";
import { DeploymentRolloutState, DescribeServicesCommand, type ECSClient } from "@aws-sdk/client-ecs";

export interface CheckStabilizationParams {
  readonly ecs: ECSClient;
  readonly cluster: string;
  readonly serviceName: string;
  readonly desiredCount: number;
  readonly logger: Logger;
}

export interface StabilizationStatus {
  readonly isStable: boolean;
  readonly isFailed: boolean;
  readonly runningCount: number;
  readonly errorMessage?: string;
}

/**
 * Checks the current stabilization state of an ECS service by inspecting
 * the primary deployment's rollout state.
 *
 * - COMPLETED with running >= desired → stable
 * - FAILED → circuit breaker triggered
 * - IN_PROGRESS or other → still pending
 */
export async function checkStabilization(params: CheckStabilizationParams): Promise<StabilizationStatus> {
  const { ecs, cluster, serviceName, desiredCount, logger } = params;

  const response = await ecs.send(
    new DescribeServicesCommand({
      cluster,
      services: [serviceName],
    })
  );

  const services = response.services ?? [];
  if (services.length === 0) {
    throw new Error(`Service ${serviceName} not found in cluster ${cluster}`);
  }

  const service = services[0];
  if (service === undefined) {
    throw new Error(`Service ${serviceName} not found in cluster ${cluster}`);
  }

  const serviceStatus = service.status ?? EcsServiceStatus.ACTIVE;
  if (serviceStatus === EcsServiceStatus.INACTIVE) {
    const errorMessage = "Service is INACTIVE (deleted externally)";
    logger.error("Service is INACTIVE", { serviceName });
    return { isStable: false, isFailed: true, runningCount: 0, errorMessage };
  }

  const currentDesiredCount = service.desiredCount ?? desiredCount;
  if (currentDesiredCount === 0 && desiredCount > 0) {
    const errorMessage = "Service desired count was externally set to 0";
    logger.error("Service externally scaled to zero", { serviceName });
    return { isStable: false, isFailed: true, runningCount: 0, errorMessage };
  }

  const deployments = service.deployments ?? [];
  if (deployments.length === 0) {
    throw new Error(`Service ${serviceName} has no deployments`);
  }

  const primary = deployments[0];
  if (primary === undefined) {
    throw new Error(`Service ${serviceName} has no deployments`);
  }

  const rolloutState = primary.rolloutState ?? DeploymentRolloutState.IN_PROGRESS;
  const runningCount = primary.runningCount ?? 0;

  logger.info("Stabilization check", {
    serviceName,
    rolloutState,
    runningCount,
    desiredCount,
  });

  if (rolloutState === DeploymentRolloutState.FAILED) {
    const errorMessage = primary.rolloutStateReason ?? "Circuit breaker triggered";
    logger.error("Service deployment failed", { serviceName, errorMessage });
    return { isStable: false, isFailed: true, runningCount, errorMessage };
  }

  if (rolloutState === DeploymentRolloutState.COMPLETED && runningCount >= desiredCount) {
    logger.info("Service is stable", { serviceName, runningCount, desiredCount });
    return { isStable: true, isFailed: false, runningCount };
  }

  return { isStable: false, isFailed: false, runningCount };
}
