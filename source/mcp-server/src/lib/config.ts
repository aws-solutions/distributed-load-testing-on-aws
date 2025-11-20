// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Configuration module for MCP Server
 * Loads environment variables at module initialization time for better performance
 */

interface Config {
  apiGatewayEndpoint: string;
  scenariosBucketName: string;
  region: string;
  solutionId: string;
  uuid: string;
  version: string;
  metricUrl: string;
}

/**
 * Load and validate environment variables at module initialization
 * This happens once when the module is first imported, not on every Lambda invocation
 */
const loadConfig = (): Config => {
  const apiGatewayEndpoint = process.env["API_GATEWAY_ENDPOINT"];
  if (!apiGatewayEndpoint) {
    throw new Error("API_GATEWAY_ENDPOINT environment variable not set");
  }

  const scenariosBucketName = process.env["SCENARIOS_BUCKET_NAME"];
  if (!scenariosBucketName) {
    throw new Error("SCENARIOS_BUCKET_NAME environment variable not set");
  }

  const region = process.env["AWS_REGION"];
  if (!region) {
    throw new Error("REGION environment variable not set");
  }

  const solutionId = process.env["SOLUTION_ID"];
  if (!solutionId) {
    throw new Error("SOLUTION_ID environment variable not set");
  }

  const uuid = process.env["UUID"];
  if (!uuid) {
    throw new Error("UUID environment variable not set");
  }

  const version = process.env["VERSION"];
  if (!version) {
    throw new Error("VERSION environment variable not set");
  }

  const metricUrl = process.env["METRIC_URL"];
  if (!metricUrl) {
    throw new Error("METRIC_URL environment variable not set");
  }

  return {
    apiGatewayEndpoint,
    scenariosBucketName,
    region,
    solutionId,
    uuid,
    version,
    metricUrl,
  };
};

// Load configuration once at module initialization
const config: Config = loadConfig();

// Export the configuration object
export { config };

// Export individual getters for convenient access
export const getApiGatewayEndpoint = (): string => config.apiGatewayEndpoint;
export const getScenariosBucket = (): string => config.scenariosBucketName;
export const getRegion = (): string => config.region;
export const getSolutionId = (): string => config.solutionId;
export const getUuid = (): string => config.uuid;
export const getVersion = (): string => config.version;
export const getMetricUrl = (): string => config.metricUrl;
