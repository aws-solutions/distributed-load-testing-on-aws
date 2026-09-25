// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { nativeTestFieldsShape } from "../../src/api/create-test.ts";

// Callers spread the shape into their own request schema, so wrap it the same
// way here.
const nativeFields = z.object(nativeTestFieldsShape);

describe("nativeTestFieldsShape", () => {
  it("leaves nativeRunMode absent for a legacy request", () => {
    expect(nativeFields.parse({}).nativeRunMode).toBeUndefined();
  });

  it("parses a native request with only maxTestDurationSeconds", () => {
    const result = nativeFields.parse({
      nativeRunMode: {
        maxTestDurationSeconds: 3600,
      },
    });

    expect(result).toEqual({
      nativeRunMode: {
        maxTestDurationSeconds: 3600,
      },
    });
  });

  it("rejects a legacy loadOverrides field", () => {
    expect(
      nativeFields.safeParse({
        nativeRunMode: {
          maxTestDurationSeconds: 3600,
          loadOverrides: { locustLoadOverrides: { users: 100 } },
        },
      }).success
    ).toBe(false);
  });

  it("requires maxTestDurationSeconds when nativeRunMode is present", () => {
    expect(nativeFields.safeParse({ nativeRunMode: {} }).success).toBe(false);
  });

  it("accepts maxTestDurationSeconds at the boundaries", () => {
    expect(
      nativeFields.parse({ nativeRunMode: { maxTestDurationSeconds: 1 } }).nativeRunMode?.maxTestDurationSeconds
    ).toBe(1);
    expect(
      nativeFields.parse({ nativeRunMode: { maxTestDurationSeconds: 86_400 } }).nativeRunMode?.maxTestDurationSeconds
    ).toBe(86_400);
  });

  it.each([0, -1, 1.5, 86_401])("rejects a maxTestDurationSeconds of %s", (value) => {
    expect(nativeFields.safeParse({ nativeRunMode: { maxTestDurationSeconds: value } }).success).toBe(false);
  });

  it("rejects unknown nativeRunMode fields", () => {
    expect(nativeFields.safeParse({ nativeRunMode: { maxTestDurationSeconds: 60, enabled: true } }).success).toBe(
      false
    );
  });
});
