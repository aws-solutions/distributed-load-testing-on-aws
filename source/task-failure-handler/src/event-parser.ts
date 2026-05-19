// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Parses ECS Task State Change events from EventBridge.
 *
 * The EventBridge rule already filters for source=aws.ecs,
 * detail-type="ECS Task State Change", lastStatus=STOPPED.
 * This module handles the two business-logic checks:
 * 1. Is this a DLT service? (extract testId/region from group name)
 * 2. Is this a real failure? (filter out graceful shutdowns)
 */

import { DLT_SERVICE_PREFIX } from "@amzn/dlt-common";

/** Parsed result from a valid ECS task failure event */
export interface ParsedTaskFailureEvent {
  readonly testId: string;
  readonly region: string;
  readonly taskArn: string;
  readonly clusterArn: string;
  readonly stoppedReason: string;
  readonly stopCode: string;
  /** Primary container exit code, undefined if the container never ran */
  readonly exitCode: number | undefined;
}

/** Container detail from an ECS Task State Change event */
interface ContainerDetail {
  readonly exitCode?: number;
}

/** ECS Task State Change event — shape guaranteed by EventBridge rule filter */
export interface ECSTaskStateChangeEvent {
  readonly detail: {
    readonly lastStatus: string;
    readonly group: string;
    readonly clusterArn: string;
    readonly taskArn: string;
    readonly stoppedReason?: string;
    readonly stopCode?: string;
    readonly containers: readonly ContainerDetail[];
  };
}

/**
 * Regex to extract testId and region from the ECS service group field.
 * Group field format: "service:{DLT_SERVICE_PREFIX}{testId}-{region}"
 * testId is a UUID (hex + hyphens), region is like us-east-1.
 * Uses the shared DLT_SERVICE_PREFIX constant from @amzn/dlt-common.
 */
const SERVICE_GROUP_PATTERN = new RegExp(`^service:${DLT_SERVICE_PREFIX}(.+)-([a-z]{2}-[a-z]+-\\d+)$`);

/**
 * Parses an ECS Task State Change event and extracts test metadata.
 * Returns undefined if the event should be skipped (not a DLT service
 * or a graceful shutdown where all containers exited with code 0).
 */
export function extractTaskFailure(event: ECSTaskStateChangeEvent): ParsedTaskFailureEvent | undefined {
  const { detail } = event;

  const match = SERVICE_GROUP_PATTERN.exec(detail.group);
  const testId = match?.[1];
  const region = match?.[2];
  if (!testId || !region) {
    return undefined;
  }

  if (isGracefulShutdown(detail.containers)) {
    return undefined;
  }

  // Use the first container's exit code for stop classification.
  // DLT tasks have a single container (the load-tester).
  const primaryExitCode = detail.containers[0]?.exitCode;

  return {
    testId,
    region,
    taskArn: detail.taskArn,
    clusterArn: detail.clusterArn,
    stoppedReason: detail.stoppedReason ?? "Unknown",
    stopCode: detail.stopCode ?? "Unknown",
    exitCode: primaryExitCode,
  };
}

/**
 * A task where every container exits gracefully is not a failure.
 * Exit code 0 = normal exit; 143 = 128 + 15 (SIGTERM) — the standard
 * exit code when ECS sends SIGTERM during service drain, scale-down,
 * or desiredCount=0 cleanup.
 */
function isGracefulShutdown(containers: readonly ContainerDetail[]): boolean {
  if (containers.length === 0) {
    return false;
  }
  return containers.every((c) => c.exitCode === 0 || c.exitCode === 143);
}
