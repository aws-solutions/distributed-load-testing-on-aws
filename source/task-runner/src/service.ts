// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { Logger } from "@amzn/dlt-common";
import type { ECSClient } from "@aws-sdk/client-ecs";
import { AssignPublicIp, CreateServiceCommand, LaunchType, PropagateTags } from "@aws-sdk/client-ecs";

export interface CreateEcsServiceParams {
  readonly ecs: ECSClient;
  readonly cluster: string;
  readonly serviceName: string;
  readonly taskDefinitionArn: string;
  readonly desiredCount: number;
  readonly subnets: string[];
  readonly securityGroup: string;
  readonly testId: string;
  readonly testRunId: string;
  readonly solutionId: string;
  readonly logger: Logger;
}

export interface ServiceCreationResult {
  readonly serviceArn: string;
  readonly serviceName: string;
}

/**
 * Creates an ephemeral ECS service for a load test.
 *
 * The service is created with a deployment circuit breaker (no rollback)
 * so ECS will stop launching tasks if they repeatedly fail. Stabilization
 * polling is NOT done here — the step function drives a
 * Wait → Stabilization Checker → Choice loop to verify readiness.
 *
 * Tags are propagated from the task definition (which inherits from the
 * CloudFormation stack) via `propagateTags: TASK_DEFINITION` and
 * `enableECSManagedTags: true`.
 */
export async function createEcsService(params: CreateEcsServiceParams): Promise<ServiceCreationResult> {
  const {
    ecs,
    cluster,
    serviceName,
    taskDefinitionArn,
    desiredCount,
    subnets,
    securityGroup,
    testId,
    testRunId,
    solutionId,
    logger,
  } = params;

  logger.info("Creating ECS service", { serviceName, cluster, desiredCount, taskDefinitionArn });

  const createResponse = await ecs.send(
    new CreateServiceCommand({
      cluster,
      serviceName,
      taskDefinition: taskDefinitionArn,
      desiredCount,
      launchType: LaunchType.FARGATE,
      networkConfiguration: {
        awsvpcConfiguration: {
          assignPublicIp: AssignPublicIp.ENABLED,
          securityGroups: [securityGroup],
          subnets,
        },
      },
      deploymentConfiguration: {
        deploymentCircuitBreaker: {
          enable: true,
          rollback: false,
        },
      },
      enableECSManagedTags: true,
      propagateTags: PropagateTags.TASK_DEFINITION,
      tags: [
        { key: "SolutionId", value: solutionId },
        { key: "TestId", value: testId },
        { key: "TestRunId", value: testRunId },
      ],
    })
  );

  const serviceArn = createResponse.service?.serviceArn;
  if (!serviceArn) {
    throw new Error("Failed to create ECS service: no ARN returned");
  }

  logger.info("ECS service created", { serviceArn, serviceName });

  return { serviceArn, serviceName };
}
