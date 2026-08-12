// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi, type Mock } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MultiRegionConfigSection } from "../../pages/scenarios/components/MultiRegionConfigSection";
import { FormData, RegionConfig } from "../../pages/scenarios/types";
import { TestTypes } from "../../pages/scenarios/constants";
import { rootReducer } from "../../store/store";
import { solutionApi } from "../../store/solutionApi";

vi.mock("../../store/regionsSlice", async () => {
  const actual = await vi.importActual("../../store/regionsSlice");
  return { ...actual, useGetRegionsQuery: () => ({ isLoading: false }) };
});

function createStore(regionNames: string[] | null = ["us-east-1", "us-west-2"]) {
  return configureStore({
    reducer: rootReducer,
    preloadedState: { regions: { regionNames, regionalStacks: null } },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(solutionApi.middleware),
  });
}

function createFormData(regions: RegionConfig[] = []): FormData {
  return {
    testId: "test-123",
    testName: "Test",
    testType: TestTypes.SIMPLE,
    regions,
    rampUpUnit: "minutes",
    rampUpValue: "",
    holdForUnit: "minutes",
    holdForValue: "",
  } as unknown as FormData;
}

describe("MultiRegionConfigSection", () => {
  test("renders a region table with all deployed regions and friendly names", () => {
    render(
      <Provider store={createStore()}>
        <MultiRegionConfigSection formData={createFormData()} updateFormData={vi.fn()} />
      </Provider>
    );
    expect(screen.getByText("Multi-Region Traffic Configuration")).toBeInTheDocument();
    expect(screen.getByText("Region")).toBeInTheDocument();
    expect(screen.getByText("Number of tasks")).toBeInTheDocument();
    expect(screen.getByText("Concurrent users")).toBeInTheDocument();
    // Region cell shows code + human-readable name from getRegionName.
    expect(screen.getByText("us-east-1 — N. Virginia")).toBeInTheDocument();
    expect(screen.getByText("us-west-2 — Oregon")).toBeInTheDocument();
  });

  test("enables per-region inputs only for enabled regions", () => {
    render(
      <Provider store={createStore()}>
        <MultiRegionConfigSection
          formData={createFormData([{ region: "us-east-1", taskCount: "1", concurrency: "1" }])}
          updateFormData={vi.fn()}
        />
      </Provider>
    );
    expect(document.querySelector('[data-cy="task-count-input-us-east-1"] input')).not.toBeDisabled();
    expect(document.querySelector('[data-cy="task-count-input-us-west-2"] input')).toBeDisabled();
  });

  test("selecting a region row adds it to the form regions", () => {
    const updateFormData: Mock<(updates: Partial<FormData>) => void> = vi.fn();
    render(
      <Provider store={createStore()}>
        <MultiRegionConfigSection formData={createFormData([])} updateFormData={updateFormData} />
      </Provider>
    );
    (screen.getByRole("checkbox", { name: "Include us-east-1" }) as HTMLElement).click();
    expect(updateFormData).toHaveBeenCalledWith(
      expect.objectContaining({ regions: [{ region: "us-east-1", taskCount: "", concurrency: "" }] })
    );
  });

  test("shows the 'select at least one region' error after a submit attempt", () => {
    render(
      <Provider store={createStore()}>
        <MultiRegionConfigSection formData={createFormData([])} updateFormData={vi.fn()} showValidationErrors />
      </Provider>
    );
    expect(screen.getByText("Please select at least one region")).toBeInTheDocument();
  });

  test("hides the cap message below the maximum number of regions", () => {
    render(
      <Provider store={createStore()}>
        <MultiRegionConfigSection
          formData={createFormData([{ region: "us-east-1", taskCount: "1", concurrency: "1" }])}
          updateFormData={vi.fn()}
        />
      </Provider>
    );
    expect(screen.queryByText(/Maximum of 5 regions reached/)).not.toBeInTheDocument();
  });

  test("shows the cap message when the maximum number of regions is selected", () => {
    const regions = ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-south-1"];
    render(
      <Provider store={createStore(regions)}>
        <MultiRegionConfigSection
          formData={createFormData(regions.map((region) => ({ region, taskCount: "1", concurrency: "1" })))}
          updateFormData={vi.fn()}
        />
      </Provider>
    );
    expect(screen.getByText(/Maximum of 5 regions reached/)).toBeInTheDocument();
  });

  test("auto-selects the only compatible region when none are selected", () => {
    const updateFormData: Mock<(updates: Partial<FormData>) => void> = vi.fn();
    render(
      <Provider store={createStore(["us-east-1"])}>
        <MultiRegionConfigSection formData={createFormData([])} updateFormData={updateFormData} />
      </Provider>
    );
    expect(updateFormData).toHaveBeenCalledWith(
      expect.objectContaining({ regions: [{ region: "us-east-1", taskCount: "", concurrency: "" }] })
    );
  });
});
