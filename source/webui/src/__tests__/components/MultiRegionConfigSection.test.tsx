// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi, type Mock } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MultiRegionConfigSection } from "../../pages/scenarios/components/MultiRegionConfigSection";
import { FormData, RegionConfig } from "../../pages/scenarios/types";
import { TestMode, TestTypes } from "../../pages/scenarios/constants";
import { rootReducer } from "../../store/store";
import { solutionApi } from "../../store/solutionApi";

vi.mock("../../store/regionsSlice", async () => {
  const actual = await vi.importActual("../../store/regionsSlice");
  return { ...actual, useGetRegionsQuery: () => ({ isLoading: false }) };
});

// Mock only the query hook; keep the real availableTasksDisplay helper.
// us-east-1: floor((4000 - 0) / 2) = 2000 available tasks.
vi.mock("../../pages/scenarios/hooks/useVCPUDetails", async () => {
  const actual = await vi.importActual<typeof import("../../pages/scenarios/hooks/useVCPUDetails")>(
    "../../pages/scenarios/hooks/useVCPUDetails"
  );
  return {
    ...actual,
    useGetVCPUDetailsQuery: () => ({ data: { "us-east-1": { vCPUsPerTask: 2, vCPULimit: 4000, vCPUsInUse: 0 } } }),
  };
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
    expect(screen.getByText("Multi-region traffic configuration")).toBeInTheDocument();
    // Column headers, queried by role.
    expect(screen.getByRole("columnheader", { name: "Region" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Traffic (virtual users)" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Task Limit" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Available" })).toBeInTheDocument();
    // Region cell shows code + human-readable name from getRegionName.
    expect(screen.getByText("us-east-1 — N. Virginia")).toBeInTheDocument();
    expect(screen.getByText("us-west-2 — Oregon")).toBeInTheDocument();
  });

  test("shows the Task Limit and Available capacity columns in standard mode", () => {
    render(
      <Provider store={createStore()}>
        <MultiRegionConfigSection formData={createFormData()} updateFormData={vi.fn()} />
      </Provider>
    );
    expect(screen.getByRole("columnheader", { name: "Task Limit" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Available" })).toBeInTheDocument();
    // us-east-1: task limit floor(4000 / 2) = 2000, available floor((4000 - 0) / 2) = 2000.
    expect(screen.getAllByText("2000").length).toBeGreaterThanOrEqual(2);
  });

  test("renders the healthy threshold input below the table", () => {
    render(
      <Provider store={createStore()}>
        <MultiRegionConfigSection formData={createFormData()} updateFormData={vi.fn()} />
      </Provider>
    );
    expect(screen.getByText("Healthy threshold (%)")).toBeInTheDocument();
    expect(document.querySelector('[data-cy="healthy-threshold-input"] input')).not.toBeNull();
  });

  test("names per-region inputs and enables them only for selected regions", () => {
    render(
      <Provider store={createStore()}>
        <MultiRegionConfigSection
          formData={createFormData([{ region: "us-east-1", taskCount: "1", concurrency: "1" }])}
          updateFormData={vi.fn()}
        />
      </Provider>
    );
    expect(screen.getByRole("textbox", { name: "Tasks for us-east-1" })).not.toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Tasks for us-west-2" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Traffic (virtual users) for us-east-1" })).not.toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Traffic (virtual users) for us-west-2" })).toBeDisabled();
  });

  test("clicking a region row adds it to the form regions", async () => {
    const user = userEvent.setup();
    const updateFormData: Mock<(updates: Partial<FormData>) => void> = vi.fn();
    render(
      <Provider store={createStore()}>
        <MultiRegionConfigSection formData={createFormData([])} updateFormData={updateFormData} />
      </Provider>
    );
    await user.click(screen.getByText("us-east-1 — N. Virginia"));
    expect(updateFormData).toHaveBeenCalledWith(
      expect.objectContaining({ regions: [{ region: "us-east-1", taskCount: "", concurrency: "" }] })
    );
  });

  test("clicking per-region inputs does not toggle the selected row", async () => {
    const user = userEvent.setup();
    const updateFormData: Mock<(updates: Partial<FormData>) => void> = vi.fn();
    render(
      <Provider store={createStore()}>
        <MultiRegionConfigSection
          formData={createFormData([{ region: "us-east-1", taskCount: "1", concurrency: "1" }])}
          updateFormData={updateFormData}
        />
      </Provider>
    );

    await user.click(screen.getByRole("textbox", { name: "Tasks for us-east-1" }));
    await user.click(screen.getByRole("textbox", { name: "Traffic (virtual users) for us-east-1" }));

    expect(updateFormData).not.toHaveBeenCalled();
  });

  test("clicking the Implementation Guide link in a threshold warning does not deselect the region", async () => {
    const user = userEvent.setup();
    const updateFormData: Mock<(updates: Partial<FormData>) => void> = vi.fn();
    render(
      <Provider store={createStore()}>
        <MultiRegionConfigSection
          // Task count above WARNING_THRESHOLDS.TASK_COUNT (2000) so the warning renders.
          formData={createFormData([{ region: "us-east-1", taskCount: "2500", concurrency: "1" }])}
          updateFormData={updateFormData}
        />
      </Provider>
    );

    await user.click(screen.getByRole("link", { name: /Implementation Guide/ }));

    // The click must not bubble to onRowClick, which would drop the region's config.
    expect(updateFormData).not.toHaveBeenCalled();
  });

  test("selecting a region by keyboard adds it to the form regions", async () => {
    const user = userEvent.setup();
    const updateFormData: Mock<(updates: Partial<FormData>) => void> = vi.fn();
    render(
      <Provider store={createStore()}>
        <MultiRegionConfigSection formData={createFormData([])} updateFormData={updateFormData} />
      </Provider>
    );

    screen.getByRole("checkbox", { name: "Include us-east-1" }).focus();
    await user.keyboard(" ");

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

  describe("native mode", () => {
    const nativeFormData = (regions: RegionConfig[] = []): FormData => ({
      ...createFormData(regions),
      testMode: TestMode.NATIVE,
    });

    test("shows the same columns as standard, with a read-only Traffic cell", () => {
      render(
        <Provider store={createStore()}>
          <MultiRegionConfigSection
            formData={nativeFormData([{ region: "us-east-1", taskCount: "2", concurrency: "" }])}
            updateFormData={vi.fn()}
          />
        </Provider>
      );
      // Native shares the standard columns, including capacity.
      expect(screen.getByRole("columnheader", { name: "Tasks" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Traffic (virtual users)" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Task Limit" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Available" })).toBeInTheDocument();
      // Traffic is read-only in native mode: no editable concurrency input, shows the placeholder.
      expect(document.querySelector('[data-cy="concurrency-input-us-east-1"]')).toBeNull();
      const trafficInput = screen.getByRole("textbox", { name: "Traffic (virtual users) for us-east-1" });
      expect(trafficInput).toBeDisabled();
      expect(trafficInput).toHaveAttribute("placeholder", "Defined by script");
    });

    test("describes task count without mentioning concurrent users", () => {
      render(
        <Provider store={createStore()}>
          <MultiRegionConfigSection formData={nativeFormData()} updateFormData={vi.fn()} />
        </Provider>
      );
      expect(screen.getByText(/your script sets the number of virtual users per container/)).toBeInTheDocument();
    });

    test("still renders the task count input", () => {
      render(
        <Provider store={createStore()}>
          <MultiRegionConfigSection
            formData={nativeFormData([{ region: "us-east-1", taskCount: "2", concurrency: "" }])}
            updateFormData={vi.fn()}
          />
        </Provider>
      );
      expect(document.querySelector('[data-cy="task-count-input-us-east-1"] input')).not.toBeDisabled();
    });
  });
});
