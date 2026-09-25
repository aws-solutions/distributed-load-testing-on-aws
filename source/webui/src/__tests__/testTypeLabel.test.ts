// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { TestTypeLabels, TestTypes, getTestTypeLabel } from "../pages/scenarios/constants";

describe("getTestTypeLabel", () => {
  // The create/edit form's Test Type radio is driven by TestTypeLabels, so
  // detail/summary screens must resolve the same label to stay consistent.
  it("returns the same label the create/edit form shows for every test type", () => {
    for (const { value, label } of TestTypeLabels) {
      expect(getTestTypeLabel(value as string)).toBe(label);
    }
  });

  it("maps the SIMPLE enum to the Simple HTTP Endpoint label", () => {
    expect(getTestTypeLabel(TestTypes.SIMPLE)).toBe("Simple HTTP Endpoint");
  });

  it("falls back to the raw value for an unknown/legacy type", () => {
    expect(getTestTypeLabel("legacy-unknown")).toBe("legacy-unknown");
  });
});
