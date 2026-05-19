// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getAwsClientConfig } from "../src/sdk-options.js";

describe("getAwsClientConfig", () => {
  it("sets customUserAgent from solutionId and version", () => {
    expect(getAwsClientConfig({ solutionId: "SOxxx", version: "testVersion" })).toEqual({
      customUserAgent: "AwsSolution/SOxxx/testVersion",
    });
  });

  it("includes region when provided", () => {
    expect(
      getAwsClientConfig({ solutionId: "SOxxx", version: "testVersion", region: "us-west-2" }),
    ).toEqual({
      region: "us-west-2",
      customUserAgent: "AwsSolution/SOxxx/testVersion",
    });
  });

  it("omits region key when not provided", () => {
    const config = getAwsClientConfig({ solutionId: "SOxxx", version: "1.0.0" });
    expect(config).not.toHaveProperty("region");
  });
});
