// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { classifySetupError, getSetupErrorReason, SETUP_ERROR_MESSAGES, SetupErrorCode } from "../src/setup-errors.ts";

/** Builds an Error whose `name` is set to an AWS-SDK-style exception code. */
function namedError(name: string, message = ""): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

describe("classifySetupError", () => {
  it("classifies the ECS 'still Draining' message as DRAINING", () => {
    const err = new Error("Unable to Start a service that is still Draining.");
    expect(classifySetupError(err)).toBe(SetupErrorCode.Draining);
  });

  it("classifies throttling by SDK exception name and by message", () => {
    expect(classifySetupError(namedError("ThrottlingException"))).toBe(SetupErrorCode.Throttling);
    expect(classifySetupError(namedError("TooManyRequestsException"))).toBe(SetupErrorCode.Throttling);
    expect(classifySetupError(new Error("Rate exceeded"))).toBe(SetupErrorCode.Throttling);
  });

  it("classifies quota/limit errors as QUOTA", () => {
    expect(classifySetupError(namedError("ServiceQuotaExceededException"))).toBe(SetupErrorCode.Quota);
    expect(classifySetupError(namedError("LimitExceededException"))).toBe(SetupErrorCode.Quota);
    expect(classifySetupError(new Error("Service limit exceeded"))).toBe(SetupErrorCode.Quota);
  });

  it("classifies capacity shortfalls as CAPACITY", () => {
    expect(classifySetupError(new Error("Capacity is unavailable at this time"))).toBe(SetupErrorCode.Capacity);
    expect(classifySetupError(new Error("insufficient capacity to run the task"))).toBe(SetupErrorCode.Capacity);
  });

  it("classifies networking misconfiguration as NETWORKING", () => {
    expect(classifySetupError(new Error("The subnet ID 'subnet-x' does not exist"))).toBe(SetupErrorCode.Networking);
    expect(classifySetupError(new Error("no available IP addresses in the subnet"))).toBe(SetupErrorCode.Networking);
    expect(classifySetupError(namedError("InvalidSecurityGroupID.NotFound"))).toBe(SetupErrorCode.Networking);
  });

  it("falls back to GENERIC for unrecognized errors", () => {
    expect(classifySetupError(new Error("something totally unexpected happened"))).toBe(SetupErrorCode.Generic);
    expect(classifySetupError(undefined)).toBe(SetupErrorCode.Generic);
    expect(classifySetupError("a bare string")).toBe(SetupErrorCode.Generic);
  });

  it("checks throttling before quota so RequestLimitExceeded is throttling, not quota", () => {
    expect(classifySetupError(namedError("RequestLimitExceeded"))).toBe(SetupErrorCode.Throttling);
  });
});

describe("getSetupErrorReason", () => {
  it("returns the curated catalog message for the classified code", () => {
    expect(getSetupErrorReason(new Error("Unable to Start a service that is still Draining."))).toBe(
      SETUP_ERROR_MESSAGES[SetupErrorCode.Draining]
    );
    expect(getSetupErrorReason(namedError("ThrottlingException"))).toBe(
      SETUP_ERROR_MESSAGES[SetupErrorCode.Throttling]
    );
    expect(getSetupErrorReason(new Error("boom"))).toBe(SETUP_ERROR_MESSAGES[SetupErrorCode.Generic]);
  });

  it("never leaks the raw error text", () => {
    const raw = "AccessDenied: arn:aws:iam::123456789012:role/secret-role is not authorized";
    expect(getSetupErrorReason(new Error(raw))).not.toContain("arn:aws:iam");
  });
});

describe("resilience — surfacing must never throw", () => {
  // Error surfacing is observational: a hostile or malformed error object must
  // degrade to GENERIC, never crash the caller's failure path.
  const hostileInputs: [string, unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["a symbol", Symbol("boom")],
    [
      "an object whose name/message getters throw",
      {
        get name(): string {
          throw new Error("name getter blew up");
        },
        get message(): string {
          throw new Error("message getter blew up");
        },
      },
    ],
    [
      "an object whose toString throws",
      {
        toString(): string {
          throw new Error("toString blew up");
        },
      },
    ],
  ];

  it.each(hostileInputs)("classifySetupError(%s) returns GENERIC without throwing", (_label, input) => {
    let code: SetupErrorCode | undefined;
    expect(() => {
      code = classifySetupError(input);
    }).not.toThrow();
    expect(code).toBe(SetupErrorCode.Generic);
  });

  it.each(hostileInputs)("getSetupErrorReason(%s) returns the generic message without throwing", (_label, input) => {
    let reason: string | undefined;
    expect(() => {
      reason = getSetupErrorReason(input);
    }).not.toThrow();
    expect(reason).toBe(SETUP_ERROR_MESSAGES[SetupErrorCode.Generic]);
  });
});
