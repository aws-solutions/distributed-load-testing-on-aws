// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseEnv } from "../src/env.js";

const MAX_DURATION_SECONDS = 3600;

function validEnv(): Record<string, string> {
  return {
    S3_BUCKET: "my-bucket",
    TEST_ID: "test-abc123",
    TEST_RUN_ID: "run-001",
    TEST_TYPE: "jmeter",
    FILE_TYPE: "zip",
    PREFIX: "2026-05-04_run-001",
    LIVE_DATA_ENABLED: "live=true",
    MAIN_STACK_REGION: "us-east-1",
    AWS_REGION: "us-west-2",
    ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/abcd",
    MAX_DURATION_SECONDS: String(MAX_DURATION_SECONDS),
  };
}

describe("parseEnv", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ...validEnv() };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns the parsed env when all required vars are set", () => {
    expect(parseEnv()).toEqual({
      s3Bucket: "my-bucket",
      testId: "test-abc123",
      testRunId: "run-001",
      testType: "jmeter",
      fileType: "zip",
      prefix: "2026-05-04_run-001",
      liveDataEnabled: true,
      mainStackRegion: "us-east-1",
      awsRegion: "us-west-2",
      ecsMetadataUri: "http://169.254.170.2/v4/abcd",
      maxDurationSeconds: 3600,
    });
  });

  it.each([
    "S3_BUCKET",
    "TEST_ID",
    "TEST_RUN_ID",
    "TEST_TYPE",
    "PREFIX",
    "LIVE_DATA_ENABLED",
    "MAIN_STACK_REGION",
    "AWS_REGION",
    "ECS_CONTAINER_METADATA_URI_V4",
    "MAX_DURATION_SECONDS",
  ])("throws when required var %s is missing", (name) => {
    Reflect.deleteProperty(process.env, name);
    expect(() => parseEnv()).toThrow(`Required environment variable "${name}" is not set or is empty`);
  });

  it.each(["simple", "jmeter", "k6", "locust"])("accepts TEST_TYPE=%s", (testType) => {
    process.env["TEST_TYPE"] = testType;
    expect(parseEnv().testType).toBe(testType);
  });

  it("rejects unknown TEST_TYPE values", () => {
    process.env["TEST_TYPE"] = "gatling";
    expect(() => parseEnv()).toThrow(/TEST_TYPE.*invalid value "gatling"/);
  });

  it.each(["none", "script", "zip"])("accepts FILE_TYPE=%s", (fileType) => {
    process.env["FILE_TYPE"] = fileType;
    expect(parseEnv().fileType).toBe(fileType);
  });

  it('coerces missing FILE_TYPE to "none"', () => {
    delete process.env["FILE_TYPE"];
    expect(parseEnv().fileType).toBe("none");
  });

  it('coerces empty FILE_TYPE to "none"', () => {
    process.env["FILE_TYPE"] = "";
    expect(parseEnv().fileType).toBe("none");
  });

  it("rejects unknown FILE_TYPE values", () => {
    process.env["FILE_TYPE"] = "tarball";
    expect(() => parseEnv()).toThrow(/FILE_TYPE.*invalid value "tarball"/);
  });

  it("parses LIVE_DATA_ENABLED=live=true as true", () => {
    process.env["LIVE_DATA_ENABLED"] = "live=true";
    expect(parseEnv().liveDataEnabled).toBe(true);
  });

  it("parses LIVE_DATA_ENABLED=live=false as false", () => {
    process.env["LIVE_DATA_ENABLED"] = "live=false";
    expect(parseEnv().liveDataEnabled).toBe(false);
  });

  it("rejects malformed LIVE_DATA_ENABLED values", () => {
    process.env["LIVE_DATA_ENABLED"] = "true";
    expect(() => parseEnv()).toThrow(/LIVE_DATA_ENABLED.*invalid value "true".*Expected "live=true" or "live=false"/);
  });

  it("never sets a loadOverrides property — DLT passes no load parameters", () => {
    process.env["TEST_TYPE"] = "locust";
    process.env["DLT_LOCUST_USERS"] = "50";
    process.env["DLT_LOCUST_RUN_TIME"] = "300";

    expect(parseEnv()).not.toHaveProperty("loadOverrides");
  });

  describe("MAX_DURATION_SECONDS", () => {
    it("uses the value the task runner sets", () => {
      process.env["MAX_DURATION_SECONDS"] = "3600";

      expect(parseEnv().maxDurationSeconds).toBe(3600);
    });

    it("rejects a missing value", () => {
      delete process.env["MAX_DURATION_SECONDS"];

      expect(() => parseEnv()).toThrow('Required environment variable "MAX_DURATION_SECONDS" is not set or is empty');
    });

    it.each(["0", "-1", "1.5", "", "abc"])("rejects %s", (value) => {
      process.env["MAX_DURATION_SECONDS"] = value;

      expect(() => parseEnv()).toThrow(/MAX_DURATION_SECONDS/);
    });
  });
});
