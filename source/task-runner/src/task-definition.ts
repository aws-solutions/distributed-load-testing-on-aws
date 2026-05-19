// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { buildTaskDefinitionFamily, type Logger } from "@amzn/dlt-common";
import type { ECSClient } from "@aws-sdk/client-ecs";
import { DescribeTaskDefinitionCommand, RegisterTaskDefinitionCommand } from "@aws-sdk/client-ecs";

export interface CreateTestTaskDefinitionParams {
  /** ECS client targeting the hub region (for DescribeTaskDefinition) */
  readonly hubEcs: ECSClient;
  /** ECS client targeting the spoke region (for RegisterTaskDefinition) */
  readonly spokeEcs: ECSClient;
  /** Hub's task definition ARN — single source of truth for container shape */
  readonly hubTaskDefinition: string;
  /** Spoke's task role ARN from DynamoDB */
  readonly taskRoleArn: string;
  /** Spoke's execution role ARN from DynamoDB */
  readonly executionRoleArn: string;
  /** Spoke's CloudWatch log group name from DynamoDB */
  readonly ecsCloudWatchLogGroup: string;
  /** Spoke region */
  readonly region: string;
  readonly testId: string;
  readonly testRunId: string;
  /** Environment variables to bake into the container (TEST_ID, TEST_TYPE, etc.) */
  readonly envVars: Record<string, string>;
  readonly solutionId: string;
  readonly logger: Logger;
}

export interface TaskDefinitionResult {
  readonly taskDefinitionArn: string;
  readonly family: string;
}

/**
 * Creates a test-specific ECS task definition revision.
 *
 * Container shape (image, cpu, memory, healthCheck, runtimePlatform, etc.)
 * is sourced from the hub's task definition via DescribeTaskDefinition.
 * IAM roles and log configuration come from the spoke's DynamoDB config.
 * The new task definition is registered in the spoke region.
 */
export async function createTestTaskDefinition(params: CreateTestTaskDefinitionParams): Promise<TaskDefinitionResult> {
  const {
    hubEcs,
    spokeEcs,
    hubTaskDefinition,
    taskRoleArn,
    executionRoleArn,
    ecsCloudWatchLogGroup,
    region,
    testId,
    testRunId,
    envVars,
    solutionId,
    logger,
  } = params;
  const family = buildTaskDefinitionFamily(testId);

  logger.info("Fetching hub task definition", { hubTaskDefinition });

  const describeResponse = await hubEcs.send(
    new DescribeTaskDefinitionCommand({ taskDefinition: hubTaskDefinition, include: ["TAGS"] }),
  );

  const hubDef = describeResponse.taskDefinition;
  if (!hubDef) {
    throw new Error(`Hub task definition not found: ${hubTaskDefinition}`);
  }

  const hubContainers = hubDef.containerDefinitions ?? [];
  if (hubContainers.length === 0) {
    throw new Error("Hub task definition has no container definitions");
  }
  if (hubContainers.length > 1) {
    throw new Error("Hub task definition has unexpected number of container definitions");
  }

  const hubContainer = hubContainers[0];
  if (!hubContainer) {
    throw new Error("Hub task definition container is undefined");
  }

  logger.info("Hub container shape resolved", {
    image: hubContainer.image,
    cpu: hubDef.cpu,
    memory: hubDef.memory,
    runtimePlatform: hubDef.runtimePlatform,
  });

  const environment = Object.entries(envVars).map(([name, value]) => ({ name, value }));

  const containerDefinitions = [
    {
      name: hubContainer.name,
      image: hubContainer.image,
      cpu: hubContainer.cpu,
      memory: hubContainer.memory,
      memoryReservation: hubContainer.memoryReservation,
      essential: hubContainer.essential,
      portMappings: hubContainer.portMappings,
      logConfiguration: {
        logDriver: "awslogs" as const,
        options: {
          "awslogs-group": ecsCloudWatchLogGroup,
          "awslogs-region": region,
          "awslogs-stream-prefix": "load-testing",
        },
      },
      healthCheck: hubContainer.healthCheck,
      environment,
      mountPoints: hubContainer.mountPoints,
      volumesFrom: hubContainer.volumesFrom,
      ulimits: hubContainer.ulimits,
    },
  ];

  logger.info("Registering test-specific task definition", { family });

  const registerResponse = await spokeEcs.send(
    new RegisterTaskDefinitionCommand({
      family,
      taskRoleArn,
      executionRoleArn,
      networkMode: hubDef.networkMode,
      containerDefinitions,
      volumes: hubDef.volumes,
      requiresCompatibilities: hubDef.requiresCompatibilities,
      cpu: hubDef.cpu,
      memory: hubDef.memory,
      runtimePlatform: hubDef.runtimePlatform,
      tags: [
        ...(describeResponse.tags?.filter(t => t.key !== "SolutionId") ?? []),
        { key: "SolutionId", value: solutionId },
        { key: "TestId", value: testId },
        { key: "TestRunId", value: testRunId },
      ],
    })
  );

  const registeredDef = registerResponse.taskDefinition;
  if (!registeredDef?.taskDefinitionArn) {
    throw new Error("Failed to register task definition: no ARN returned");
  }

  logger.info("Task definition registered", {
    taskDefinitionArn: registeredDef.taskDefinitionArn,
    family,
    revision: registeredDef.revision,
  });

  return {
    taskDefinitionArn: registeredDef.taskDefinitionArn,
    family,
  };
}
