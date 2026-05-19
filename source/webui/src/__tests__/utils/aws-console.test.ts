// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { getConsoleDomain } from "../../utils/aws-console";

describe("getConsoleDomain", () => {
  it("returns the commercial domain for a standard region", () => {
    expect(getConsoleDomain("us-west-2")).toBe("console.aws.amazon.com");
  });

  it("returns the commercial domain for other commercial regions", () => {
    expect(getConsoleDomain("eu-west-1")).toBe("console.aws.amazon.com");
    expect(getConsoleDomain("ap-southeast-2")).toBe("console.aws.amazon.com");
  });

  it("returns the GovCloud domain for us-gov-west-1", () => {
    expect(getConsoleDomain("us-gov-west-1")).toBe("console.amazonaws-us-gov.com");
  });

  it("returns the GovCloud domain for us-gov-east-1", () => {
    expect(getConsoleDomain("us-gov-east-1")).toBe("console.amazonaws-us-gov.com");
  });

  it("returns the China domain for cn-north-1", () => {
    expect(getConsoleDomain("cn-north-1")).toBe("console.amazonaws.cn");
  });

  it("returns the China domain for cn-northwest-1", () => {
    expect(getConsoleDomain("cn-northwest-1")).toBe("console.amazonaws.cn");
  });

  it("falls back to the commercial domain for an unknown region", () => {
    expect(getConsoleDomain("totally-fake-region")).toBe("console.aws.amazon.com");
  });

  it("falls back to the commercial domain for empty string", () => {
    expect(getConsoleDomain("")).toBe("console.aws.amazon.com");
  });

  it("falls back to the commercial domain for undefined", () => {
    expect(getConsoleDomain(undefined)).toBe("console.aws.amazon.com");
  });

  it("falls back to the commercial domain for null", () => {
    expect(getConsoleDomain(null)).toBe("console.aws.amazon.com");
  });
});
