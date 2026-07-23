// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("config", () => {
  const REQUIRED_VARS: Record<string, string> = {
    API_GATEWAY_ENDPOINT: "https://api.example.com/prod",
    AWS_ACCOUNT_ID: "123456789012",
    SCENARIOS_BUCKET_NAME: "dlt-scenarios-bucket",
    AWS_REGION: "us-east-1",
    SOLUTION_ID: "SO0062",
    UUID: "test-uuid-1234",
    VERSION: "v4.1.0",
    METRIC_URL: "https://metrics.awssolutionsbuilder.com/generic",
  };

  beforeEach(() => {
    vi.resetModules();
    for (const [key, val] of Object.entries(REQUIRED_VARS)) {
      process.env[key] = val;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(REQUIRED_VARS)) {
      delete process.env[key];
    }
  });

  it("should load config with all env vars set", async () => {
    const { config } = await import("../../src/lib/config.js");
    expect(config.apiGatewayEndpoint).toBe("https://api.example.com/prod");
    expect(config.awsAccountId).toBe("123456789012");
    expect(config.scenariosBucketName).toBe("dlt-scenarios-bucket");
    expect(config.region).toBe("us-east-1");
    expect(config.solutionId).toBe("SO0062");
    expect(config.uuid).toBe("test-uuid-1234");
    expect(config.version).toBe("v4.1.0");
    expect(config.metricUrl).toBe("https://metrics.awssolutionsbuilder.com/generic");
  });

  it("should export getter functions that return config values", async () => {
    const {
      getApiGatewayEndpoint,
      getAwsAccountId,
      getScenariosBucket,
      getRegion,
      getSolutionId,
      getUuid,
      getVersion,
      getMetricUrl,
    } = await import("../../src/lib/config.js");

    expect(getApiGatewayEndpoint()).toBe("https://api.example.com/prod");
    expect(getAwsAccountId()).toBe("123456789012");
    expect(getScenariosBucket()).toBe("dlt-scenarios-bucket");
    expect(getRegion()).toBe("us-east-1");
    expect(getSolutionId()).toBe("SO0062");
    expect(getUuid()).toBe("test-uuid-1234");
    expect(getVersion()).toBe("v4.1.0");
    expect(getMetricUrl()).toBe("https://metrics.awssolutionsbuilder.com/generic");
  });

  it("should throw when API_GATEWAY_ENDPOINT is missing", async () => {
    delete process.env["API_GATEWAY_ENDPOINT"];
    await expect(import("../../src/lib/config.js")).rejects.toThrow("API_GATEWAY_ENDPOINT environment variable not set");
  });

  it("should throw when AWS_ACCOUNT_ID is missing", async () => {
    delete process.env["AWS_ACCOUNT_ID"];
    await expect(import("../../src/lib/config.js")).rejects.toThrow("AWS_ACCOUNT_ID environment variable not set");
  });

  it("should throw when SCENARIOS_BUCKET_NAME is missing", async () => {
    delete process.env["SCENARIOS_BUCKET_NAME"];
    await expect(import("../../src/lib/config.js")).rejects.toThrow("SCENARIOS_BUCKET_NAME environment variable not set");
  });

  it("should throw when AWS_REGION is missing", async () => {
    delete process.env["AWS_REGION"];
    await expect(import("../../src/lib/config.js")).rejects.toThrow("REGION environment variable not set");
  });

  it("should throw when SOLUTION_ID is missing", async () => {
    delete process.env["SOLUTION_ID"];
    await expect(import("../../src/lib/config.js")).rejects.toThrow("SOLUTION_ID environment variable not set");
  });

  it("should throw when UUID is missing", async () => {
    delete process.env["UUID"];
    await expect(import("../../src/lib/config.js")).rejects.toThrow("UUID environment variable not set");
  });

  it("should throw when VERSION is missing", async () => {
    delete process.env["VERSION"];
    await expect(import("../../src/lib/config.js")).rejects.toThrow("VERSION environment variable not set");
  });

  it("should throw when METRIC_URL is missing", async () => {
    delete process.env["METRIC_URL"];
    await expect(import("../../src/lib/config.js")).rejects.toThrow("METRIC_URL environment variable not set");
  });
});
