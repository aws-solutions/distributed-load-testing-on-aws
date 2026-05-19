// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewAndCreateStep } from "../../pages/scenarios/components/ReviewAndCreateStep";

const formData = {
  testName: "Load Test",
  testDescription: "Test description",
  testId: "test-123",
  testType: "simple",
  executionTiming: "run-now",
  showLive: true,
  tags: [{ label: "perf", dismissLabel: "Remove perf" }],
  httpEndpoint: "https://example.com",
  httpMethod: { label: "GET", value: "GET" },
  requestHeaders: "",
  bodyPayload: "",
  regions: [{ region: "us-east-1", taskCount: "5", concurrency: "10" }],
  rampUpValue: "1",
  rampUpUnit: "m",
  holdForValue: "5",
  holdForUnit: "m",
} as any;

describe("ReviewAndCreateStep", () => {
  it("renders test configuration summary", () => {
    render(<ReviewAndCreateStep formData={formData} updateFormData={vi.fn()} onEdit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Load Test")).toBeInTheDocument();
    expect(screen.getByText("Test description")).toBeInTheDocument();
    expect(screen.getByText("test-123")).toBeInTheDocument();
    expect(screen.getByText("perf")).toBeInTheDocument();
    expect(screen.getByText("Traffic Configuration")).toBeInTheDocument();
    expect(screen.getByText("us-east-1")).toBeInTheDocument();
  });
});
