// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildNativeRunMode } from "../../../api/contract/createScenario";

describe("buildNativeRunMode", () => {
  it("carries only the safety-duration ceiling; the script defines the load", () => {
    expect(buildNativeRunMode({ maxTestDurationSeconds: 1800 })).toEqual({
      maxTestDurationSeconds: 1800,
    });
  });
});
