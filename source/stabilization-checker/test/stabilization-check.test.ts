// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { DeploymentRolloutState, DescribeServicesCommand, ECSClient } from "@aws-sdk/client-ecs";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Logger } from "@amzn/dlt-common";

import { checkStabilization } from "../src/stabilization-check.js";

const ecsMock = mockClient(ECSClient);

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  appendKeys: vi.fn(),
} as unknown as Logger;

function makeParams(overrides: Partial<Parameters<typeof checkStabilization>[0]> = {}) {
  return {
    ecs: new ECSClient({}),
    cluster: "dlt-cluster",
    serviceName: "dlt-test-abc123-us-east-1",
    desiredCount: 5,
    logger,
    ...overrides,
  };
}

describe("checkStabilization", () => {
  beforeEach(() => {
    ecsMock.reset();
  });

  it("should return isStable=true when rollout is COMPLETED and running >= desired", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [
        {
          deployments: [
            {
              rolloutState: DeploymentRolloutState.COMPLETED,
              runningCount: 5,
            },
          ],
        },
      ],
    });

    const result = await checkStabilization(makeParams());

    expect(result).toEqual({
      isStable: true,
      isFailed: false,
      runningCount: 5,
    });
  });

  it("should return isFailed=true when rollout is FAILED", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [
        {
          deployments: [
            {
              rolloutState: DeploymentRolloutState.FAILED,
              runningCount: 2,
              rolloutStateReason: "Circuit breaker triggered",
            },
          ],
        },
      ],
    });

    const result = await checkStabilization(makeParams());

    expect(result).toEqual({
      isStable: false,
      isFailed: true,
      runningCount: 2,
      errorMessage: "Circuit breaker triggered",
    });
  });

  it("should return pending when rollout is IN_PROGRESS", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [
        {
          deployments: [
            {
              rolloutState: DeploymentRolloutState.IN_PROGRESS,
              runningCount: 3,
            },
          ],
        },
      ],
    });

    const result = await checkStabilization(makeParams());

    expect(result).toEqual({
      isStable: false,
      isFailed: false,
      runningCount: 3,
    });
  });

  it("should return pending when COMPLETED but running < desired", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [
        {
          deployments: [
            {
              rolloutState: DeploymentRolloutState.COMPLETED,
              runningCount: 3,
            },
          ],
        },
      ],
    });

    const result = await checkStabilization(makeParams({ desiredCount: 5 }));

    expect(result).toEqual({
      isStable: false,
      isFailed: false,
      runningCount: 3,
    });
  });

  it("should throw when service not found", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [],
    });

    await expect(checkStabilization(makeParams())).rejects.toThrow("Service dlt-test-abc123-us-east-1 not found");
  });

  it("should throw when service has no deployments", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [
        {
          deployments: [],
        },
      ],
    });

    await expect(checkStabilization(makeParams())).rejects.toThrow("has no deployments");
  });

  it("should default rolloutState to IN_PROGRESS when undefined", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [
        {
          deployments: [
            {
              runningCount: 2,
            },
          ],
        },
      ],
    });

    const result = await checkStabilization(makeParams());

    expect(result.isStable).toBe(false);
    expect(result.isFailed).toBe(false);
  });

  it("should default runningCount to 0 when undefined", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [
        {
          deployments: [
            {
              rolloutState: DeploymentRolloutState.IN_PROGRESS,
            },
          ],
        },
      ],
    });

    const result = await checkStabilization(makeParams());

    expect(result.runningCount).toBe(0);
  });

  it("should return isFailed=true when service status is INACTIVE", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [
        {
          status: "INACTIVE",
          desiredCount: 5,
          deployments: [
            {
              rolloutState: DeploymentRolloutState.COMPLETED,
              runningCount: 0,
            },
          ],
        },
      ],
    });

    const result = await checkStabilization(makeParams());

    expect(result).toEqual({
      isStable: false,
      isFailed: true,
      runningCount: 0,
      errorMessage: "Service is INACTIVE (deleted externally)",
    });
  });

  it("should return isFailed=true when desired count is externally set to 0", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [
        {
          status: "ACTIVE",
          desiredCount: 0,
          deployments: [
            {
              rolloutState: DeploymentRolloutState.IN_PROGRESS,
              runningCount: 0,
            },
          ],
        },
      ],
    });

    const result = await checkStabilization(makeParams({ desiredCount: 5 }));

    expect(result).toEqual({
      isStable: false,
      isFailed: true,
      runningCount: 0,
      errorMessage: "Service desired count was externally set to 0",
    });
  });

  it("should use default error message when rolloutStateReason is undefined", async () => {
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [
        {
          deployments: [
            {
              rolloutState: DeploymentRolloutState.FAILED,
              runningCount: 0,
            },
          ],
        },
      ],
    });

    const result = await checkStabilization(makeParams());

    expect(result.errorMessage).toBe("Circuit breaker triggered");
  });
});
