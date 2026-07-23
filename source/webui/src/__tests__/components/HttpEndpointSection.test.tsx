// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HttpEndpointSection } from "../../pages/scenarios/components/HttpEndpointSection";
import { TestTypes } from "../../pages/scenarios/constants";
import { FormData } from "../../pages/scenarios/types";

const baseFormData = {
  testType: TestTypes.SIMPLE,
  httpEndpoint: "",
  httpMethod: { label: "GET", value: "GET" },
  requestHeaders: "",
  bodyPayload: "",
} as unknown as FormData;

describe("HttpEndpointSection", () => {
  it("renders the endpoint, method, headers, and body fields", () => {
    render(<HttpEndpointSection formData={baseFormData} updateFormData={vi.fn()} />);
    expect(screen.getByText("HTTP Endpoint Configuration")).toBeInTheDocument();
    expect(screen.getByText("HTTP Endpoint")).toBeInTheDocument();
    expect(screen.getByText("HTTP Method")).toBeInTheDocument();
  });

  it("shows the required error after the endpoint field is blurred", () => {
    render(<HttpEndpointSection formData={baseFormData} updateFormData={vi.fn()} />);
    expect(screen.queryByText("HTTP endpoint is required")).not.toBeInTheDocument();

    const input = screen.getByPlaceholderText("http://www.example.com");
    fireEvent.blur(input);
    expect(screen.getByText("HTTP endpoint is required")).toBeInTheDocument();
  });

  it("shows the required error immediately when a submit was attempted", () => {
    render(<HttpEndpointSection formData={baseFormData} updateFormData={vi.fn()} showValidationErrors />);
    expect(screen.getByText("HTTP endpoint is required")).toBeInTheDocument();
  });

  it("warns on invalid JSON headers", () => {
    render(
      <HttpEndpointSection
        formData={{ ...baseFormData, requestHeaders: "{bad" }}
        updateFormData={vi.fn()}
      />
    );
    expect(screen.getByText("WARNING: headers text is not valid JSON")).toBeInTheDocument();
  });
});
