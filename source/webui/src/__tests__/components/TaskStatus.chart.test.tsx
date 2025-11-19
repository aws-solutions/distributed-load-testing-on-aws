// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { mockScenarioDetails } from "../../mocks/handlers";
import { TaskStatus } from "../../pages/scenarios/components/TaskStatus";

// Mock dependencies
vi.mock("@aws-amplify/pubsub", () => ({
  PubSub: vi.fn(),
}));
vi.mock("../../utils/chartHelpers", () => ({
  createRegionalTimeSeriesChart: vi.fn(),
  ChartMetric: {
    AverageResponseTime: 'avgRt',
    VirtualUsers: 'vu',
    SuccessfulRequests: 'succ',
    FailedRequests: 'fail'
  }
}));
vi.mock("../../utils/colorUtils", () => ({
  createRegionColorMap: vi.fn(() => ({
    "us-east-1": "#688ae8",
    "us-west-2": "#ff9900"
  }))
}));

describe("TaskStatus Chart.js functionality", () => {
  let mockPubSubInstance: any;
  let mockSubscription: any;
  let mockObservable: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create mock subscription and observable
    mockSubscription = {
      unsubscribe: vi.fn(),
    };

    mockObservable = {
      subscribe: vi.fn().mockReturnValue(mockSubscription),
    };

    mockPubSubInstance = {
      subscribe: vi.fn().mockReturnValue(mockObservable),
    };

    // Mock PubSub constructor
    const { PubSub } = await import("@aws-amplify/pubsub");
    vi.mocked(PubSub).mockImplementation(() => mockPubSubInstance);

    // Mock chart helper
    const { createRegionalTimeSeriesChart } = await import("../../utils/chartHelpers");
    vi.mocked(createRegionalTimeSeriesChart).mockClear();

    // Mock fetch response with proper Response object
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          IoTEndpoint: "test.iot.us-east-1.amazonaws.com",
        }),
      clone: () => ({
        json: () =>
          Promise.resolve({
            IoTEndpoint: "test.iot.us-east-1.amazonaws.com",
          }),
      }),
    } as Response);

    // Mock canvas context
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      canvas: {},
    })) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders no data message when chartData is empty", () => {
    render(<TaskStatus scenario_definition={mockScenarioDetails} />);

    expect(screen.getAllByText("There is no data available.")).toHaveLength(4);
  });

  it("creates charts when PubSub data is received", async () => {
    const mockData = {
      "us-east-1": [
        {
          timestamp: Date.now(),
          avgRt: 100,
          vu: 50,
          succ: 200,
          fail: 5,
        },
      ],
    };

    let subscribeCallback: any;
    mockObservable.subscribe.mockImplementation((callback: any) => {
      subscribeCallback = callback;
      return mockSubscription;
    });

    await act(async () => {
      render(<TaskStatus scenario_definition={mockScenarioDetails} />);
    });

    // Wait for component to set up PubSub
    await waitFor(
      () => {
        expect(mockPubSubInstance.subscribe).toHaveBeenCalled();
      },
      { timeout: 3000 }
    );

    // Simulate data emission
    await act(async () => {
      if (subscribeCallback && subscribeCallback.next) {
        subscribeCallback.next(mockData);
      }
    });

    const { createRegionalTimeSeriesChart } = await import("../../utils/chartHelpers");
    const mockedChart = vi.mocked(createRegionalTimeSeriesChart);

    await waitFor(
      () => {
        expect(mockedChart).toHaveBeenCalledTimes(4);
      },
      { timeout: 3000 }
    );

    // Verify chart creation calls
    expect(mockedChart).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Array),
      expect.objectContaining({
        metric: "avgRt",
        yAxisTitle: "Response Time (ms)",
      })
    );

    expect(mockedChart).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Array),
      expect.objectContaining({
        metric: "vu",
        yAxisTitle: "Virtual Users",
      })
    );
  });

  it("processes PubSub data correctly", async () => {
    const mockData = {
      "us-east-1": [
        {
          timestamp: 1234567890,
          avgRt: 150,
          vu: 75,
          succ: 300,
          fail: 10,
        },
      ],
    };

    let subscribeCallback: any;
    mockObservable.subscribe.mockImplementation((callback: any) => {
      subscribeCallback = callback;
      return mockSubscription;
    });

    await act(async () => {
      render(<TaskStatus scenario_definition={mockScenarioDetails} />);
    });

    // Wait for component to set up PubSub
    await waitFor(
      () => {
        expect(mockPubSubInstance.subscribe).toHaveBeenCalled();
      },
      { timeout: 3000 }
    );

    // Simulate data emission
    await act(async () => {
      if (subscribeCallback && subscribeCallback.next) {
        subscribeCallback.next(mockData);
      }
    });

    const { createRegionalTimeSeriesChart } = await import("../../utils/chartHelpers");
    const mockedChart = vi.mocked(createRegionalTimeSeriesChart);

    await waitFor(
      () => {
        expect(mockedChart).toHaveBeenCalled();
      },
      { timeout: 3000 }
    );

    // Verify data structure passed to chart
    const chartCall = mockedChart.mock.calls[0];
    const chartData = chartCall[1];

    expect(chartData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          timestamp: 1234567890,
          region: "us-east-1",
          avgRt: 150,
          vu: 7500,
          succ: 300,
          fail: 10,
        }),
      ])
    );
  });
});
