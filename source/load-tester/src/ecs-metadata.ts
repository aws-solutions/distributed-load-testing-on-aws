// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export interface EcsTaskMetadata {
  readonly taskArn: string;
  readonly taskId: string;
  readonly taskCpu: number;
  readonly taskMemory: number;
  /** ISO 8601 timestamp of when this container started. */
  readonly startedAt: string;
}

// Fargate requires cpu/memory at task-definition time, so TaskARN and
// Limits are always present. Containers[0].StartedAt is present because
// our own code is running inside that container.
interface MetadataResponse {
  readonly TaskARN: string;
  readonly Limits: { readonly CPU: number; readonly Memory: number };
  readonly Containers: readonly { readonly StartedAt: string }[];
}

export async function fetchEcsTaskMetadata(metadataUri: string): Promise<EcsTaskMetadata> {
  const url = `${metadataUri}/task`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ECS metadata endpoint returned ${response.status} ${response.statusText} for ${url}`);
  }

  let body: MetadataResponse;
  try {
    body = (await response.json()) as MetadataResponse;
  } catch (cause) {
    throw new Error(`ECS metadata endpoint returned non-JSON body for ${url}`, { cause });
  }

  const container = body.Containers[0];
  if (!container) {
    throw new Error(`ECS metadata response has empty Containers array: ${JSON.stringify(body)}`);
  }

  return {
    taskArn: body.TaskARN,
    taskId: extractTaskId(body.TaskARN),
    taskCpu: body.Limits.CPU,
    taskMemory: body.Limits.Memory,
    startedAt: container.StartedAt,
  };
}

export function ecsDurationSeconds(metadata: EcsTaskMetadata, end: Date): number {
  const startMilliseconds = new Date(metadata.startedAt).getTime();
  if (Number.isNaN(startMilliseconds)) return 0;
  return Math.max(0, Math.round((end.getTime() - startMilliseconds) / 1_000));
}

function extractTaskId(taskArn: string): string {
  const last = taskArn.split("/").at(-1);
  if (last === undefined || last === "") {
    throw new Error(`Could not extract task ID from TaskARN "${taskArn}"`);
  }
  return last;
}
