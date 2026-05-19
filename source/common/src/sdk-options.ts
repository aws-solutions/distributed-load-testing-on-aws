// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Configuration returned for AWS SDK clients.
 */
export interface AwsClientConfig {
  readonly region?: string;
  readonly customUserAgent: string;
}

/**
 * Parameters accepted by {@link getAwsClientConfig}.
 */
export interface AwsClientConfigParams {
  /** Solution identifier, e.g. `"SO0062"`. */
  readonly solutionId: string;
  /** Solution version, e.g. `"0.0.0"`. */
  readonly version: string;
  /** Optional AWS region override for the SDK client. */
  readonly region?: string;
}

/**
 * Returns an AWS SDK client configuration object with `customUserAgent` set
 * from the provided solution identifier and version.
 *
 * @example
 * ```ts
 * import { ECS } from "@aws-sdk/client-ecs";
 * import { getAwsClientConfig } from "@amzn/dlt-common";
 *
 * const ecs = new ECS(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION, region: "us-east-1" }));
 * ```
 *
 * @param params - Solution identity and optional region override
 * @returns A configuration object suitable for passing to any AWS SDK v3 client constructor
 */
export function getAwsClientConfig(params: AwsClientConfigParams): AwsClientConfig {
  const config: AwsClientConfig = {
    customUserAgent: `AwsSolution/${params.solutionId}/${params.version}`,
    ...(params.region ? { region: params.region } : {}),
  };

  return config;
}
