// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from "@testing-library/react";
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { TrafficShapeStep } from "../../pages/scenarios/components/TrafficShapeStep";
import { FormData } from "../../pages/scenarios/types";
import { TestTypes } from "../../pages/scenarios/constants";
import { rootReducer } from "../../store/store";
import { solutionApi } from "../../store/solutionApi";

// Mock the RTK Query hooks used by TrafficShapeStep
vi.mock("../../store/regionsSlice", async () => {
  const actual = await vi.importActual("../../store/regionsSlice");
  return {
    ...actual,
    useGetRegionsQuery: () => ({ isLoading: false }),
  };
});

vi.mock("../../pages/scenarios/components/TrafficShapeStep", async () => {
  const actual = await vi.importActual("../../pages/scenarios/components/TrafficShapeStep");
  return {
    ...actual,
    useGetVCPUDetailsQuery: () => ({
      data: {
        "us-east-1": { vCPUsPerTask: 2, vCPULimit: 100, vCPUsInUse: 10 },
        "us-west-2": { vCPUsPerTask: 2, vCPULimit: 50, vCPUsInUse: 0 },
      },
    }),
  };
});

function createStore(regionsData: string[] | null = ["us-east-1", "us-west-2"]) {
  return configureStore({
    reducer: rootReducer,
    preloadedState: {
      regions: { regionNames: regionsData, regionalStacks: null },
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(solutionApi.middleware),
  });
}

function createFormData(overrides: Partial<FormData> = {}): FormData {
  return {
    testId: "test-123",
    testName: "Test",
    testDescription: "",
    testType: TestTypes.SIMPLE,
    executionTiming: "run-now",
    showLive: false,
    scriptFile: [],
    fileError: "",
    tags: [],
    httpEndpoint: "",
    httpMethod: { label: "GET", value: "GET" },
    requestHeaders: "",
    bodyPayload: "",
    scheduleTime: "",
    scheduleDate: "",
    cronMinutes: "",
    cronHours: "",
    cronDayOfMonth: "",
    cronMonth: "",
    cronDayOfWeek: "",
    cronExpiryDate: "",
    scheduleTimezone: "",
    regions: [],
    rampUpUnit: "minutes",
    rampUpValue: "",
    holdForUnit: "minutes",
    holdForValue: "",
    healthyThreshold: "",
    k6LicenseAcknowledged: false,
    ...overrides,
  };
}

function renderComponent(formData: FormData, updateFormData: ReturnType<typeof vi.fn>, store = createStore()) {
  return render(
    <Provider store={store}>
      <TrafficShapeStep formData={formData} updateFormData={updateFormData} showValidationErrors={false} />
    </Provider>
  );
}

describe("TrafficShapeStep", () => {
  let mockUpdateFormData: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockUpdateFormData = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    test("renders region selection and duration sections", () => {
      renderComponent(createFormData(), mockUpdateFormData);

      expect(screen.getByText("Multi-Region Traffic Configuration")).toBeInTheDocument();
      expect(screen.getByText("Select Regions")).toBeInTheDocument();
      expect(screen.getByText("Test Duration")).toBeInTheDocument();
      expect(screen.getByText("Ramp Up")).toBeInTheDocument();
      expect(screen.getByText("Hold For")).toBeInTheDocument();
      expect(screen.getByText("Table of Available Tasks")).toBeInTheDocument();
      expect(screen.getByText("us-east-1")).toBeInTheDocument();
      expect(screen.getByText("us-west-2")).toBeInTheDocument();
    });

    test("does not render available tasks table when no regions", () => {
      const store = createStore([]);
      renderComponent(createFormData(), mockUpdateFormData, store);

      expect(screen.queryByText("Table of Available Tasks")).not.toBeInTheDocument();
    });
  });

  describe("auto-select single region", () => {
    test("auto-selects when only one region is available and none selected", () => {
      const store = createStore(["us-east-1"]);
      renderComponent(createFormData({ regions: [] }), mockUpdateFormData, store);

      expect(mockUpdateFormData).toHaveBeenCalledWith({
        regions: [{ region: "us-east-1", taskCount: "", concurrency: "" }],
      });
    });

    test("does not auto-select when regions already selected", () => {
      const store = createStore(["us-east-1"]);
      const formData = createFormData({
        regions: [{ region: "us-east-1", taskCount: "5", concurrency: "10" }],
      });
      renderComponent(formData, mockUpdateFormData, store);

      expect(mockUpdateFormData).not.toHaveBeenCalled();
    });
  });

  describe("region configuration", () => {
    test("renders task count and concurrency inputs for each region", () => {
      const formData = createFormData({
        regions: [
          { region: "us-east-1", taskCount: "5", concurrency: "100" },
          { region: "us-west-2", taskCount: "3", concurrency: "50" },
        ],
      });
      renderComponent(formData, mockUpdateFormData);

      expect(screen.getByDisplayValue("5")).toBeInTheDocument();
      expect(screen.getByDisplayValue("100")).toBeInTheDocument();
      expect(screen.getByDisplayValue("3")).toBeInTheDocument();
      expect(screen.getByDisplayValue("50")).toBeInTheDocument();
    });
  });
});
