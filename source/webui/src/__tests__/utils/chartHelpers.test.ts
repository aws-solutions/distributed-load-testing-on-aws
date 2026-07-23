// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { vi } from "vitest";

const { MockChartClass } = vi.hoisted(() => {
  class MockChartClass {
    static instances: MockChartClass[] = [];
    ctx: any;
    chartConfig: any;
    constructor(ctx: any, config: any) {
      this.ctx = ctx;
      this.chartConfig = config;
      MockChartClass.instances.push(this);
    }
    static reset() {
      MockChartClass.instances = [];
    }
  }
  return { MockChartClass };
});

vi.mock("chart.js/auto", () => ({
  default: MockChartClass,
}));

import {
  ChartMetric,
  createRegionalTimeSeriesChart,
  type RegionalChartDataPoint,
  type RegionalChartConfig,
} from "../../utils/chartHelpers";

import { beforeEach } from "vitest";

describe("chartHelpers", () => {
  beforeEach(() => {
    MockChartClass.reset();
  });

  describe("ChartMetric enum", () => {
    it("should have correct values", () => {
      expect(ChartMetric.AverageResponseTime).toBe("avgRt");
      expect(ChartMetric.VirtualUsers).toBe("vu");
      expect(ChartMetric.SuccessfulRequests).toBe("succ");
      expect(ChartMetric.FailedRequests).toBe("fail");
    });
  });

  describe("createRegionalTimeSeriesChart", () => {
    const mockCtx = {} as CanvasRenderingContext2D;

    it("should create a chart with region-specific datasets", () => {
      const data: RegionalChartDataPoint[] = [
        { timestamp: 1000, region: "us-east-1", avgRt: 100, vu: 10, succ: 5, fail: 0 },
        { timestamp: 2000, region: "us-east-1", avgRt: 110, vu: 10, succ: 6, fail: 1 },
        { timestamp: 1000, region: "us-west-2", avgRt: 90, vu: 8, succ: 4, fail: 0 },
      ];

      const config: RegionalChartConfig = {
        metric: ChartMetric.AverageResponseTime,
        yAxisTitle: "Response Time (ms)",
        regionColors: { "us-east-1": "#688ae8", "us-west-2": "#c33d69" },
      };

      createRegionalTimeSeriesChart(mockCtx, data, config);

      expect(MockChartClass.instances).toHaveLength(1);
      const instance = MockChartClass.instances[0];
      expect(instance.ctx).toBe(mockCtx);
      expect(instance.chartConfig.type).toBe("scatter");
      expect(instance.chartConfig.data.datasets).toHaveLength(2);
    });

    it("should group data points by region", () => {
      const data: RegionalChartDataPoint[] = [
        { timestamp: 1000, region: "us-east-1", avgRt: 100, vu: 10, succ: 5, fail: 0 },
        { timestamp: 2000, region: "eu-west-1", avgRt: 200, vu: 20, succ: 10, fail: 2 },
        { timestamp: 3000, region: "us-east-1", avgRt: 110, vu: 12, succ: 6, fail: 0 },
      ];

      const config: RegionalChartConfig = {
        metric: ChartMetric.VirtualUsers,
        yAxisTitle: "Virtual Users",
        regionColors: { "us-east-1": "#688ae8", "eu-west-1": "#c33d69" },
      };

      createRegionalTimeSeriesChart(mockCtx, data, config);

      const { chartConfig } = MockChartClass.instances[0];
      const datasets = chartConfig.data.datasets;
      expect(datasets).toHaveLength(2);

      const usEast = datasets.find((d: any) => d.label === "us-east-1");
      const euWest = datasets.find((d: any) => d.label === "eu-west-1");
      expect(usEast.data).toHaveLength(2);
      expect(euWest.data).toHaveLength(1);
    });

    it("should use configured metric for y-axis parsing", () => {
      const data: RegionalChartDataPoint[] = [
        { timestamp: 1000, region: "us-east-1", avgRt: 100, vu: 10, succ: 5, fail: 0 },
      ];

      const config: RegionalChartConfig = {
        metric: ChartMetric.FailedRequests,
        yAxisTitle: "Failed Requests",
        regionColors: { "us-east-1": "#688ae8" },
      };

      createRegionalTimeSeriesChart(mockCtx, data, config);

      const { chartConfig } = MockChartClass.instances[0];
      expect(chartConfig.data.datasets[0].parsing.yAxisKey).toBe("fail");
      expect(chartConfig.data.datasets[0].parsing.xAxisKey).toBe("timestamp");
    });

    it("should use regionColors from config", () => {
      const data: RegionalChartDataPoint[] = [
        { timestamp: 1000, region: "us-east-1", avgRt: 100, vu: 10, succ: 5, fail: 0 },
      ];

      const config: RegionalChartConfig = {
        metric: ChartMetric.AverageResponseTime,
        yAxisTitle: "Response Time",
        regionColors: { "us-east-1": "#ff0000" },
      };

      createRegionalTimeSeriesChart(mockCtx, data, config);

      const { chartConfig } = MockChartClass.instances[0];
      expect(chartConfig.data.datasets[0].borderColor).toBe("#ff0000");
      expect(chartConfig.data.datasets[0].backgroundColor).toBe("#ff0000");
    });

    it("should use default color when region is not in colorMap", () => {
      const data: RegionalChartDataPoint[] = [
        { timestamp: 1000, region: "ap-south-1", avgRt: 100, vu: 10, succ: 5, fail: 0 },
      ];

      const config: RegionalChartConfig = {
        metric: ChartMetric.AverageResponseTime,
        yAxisTitle: "Response Time",
        regionColors: {},
      };

      createRegionalTimeSeriesChart(mockCtx, data, config);

      const { chartConfig } = MockChartClass.instances[0];
      expect(chartConfig.data.datasets[0].borderColor).toBe("#688ae8");
    });

    it("should handle empty data array", () => {
      const config: RegionalChartConfig = {
        metric: ChartMetric.AverageResponseTime,
        yAxisTitle: "Response Time",
        regionColors: {},
      };

      createRegionalTimeSeriesChart(mockCtx, [], config);

      const { chartConfig } = MockChartClass.instances[0];
      expect(chartConfig.data.datasets).toHaveLength(0);
    });

    it("should skip data points without a region", () => {
      const data: RegionalChartDataPoint[] = [
        { timestamp: 1000, region: "", avgRt: 100, vu: 10, succ: 5, fail: 0 },
        { timestamp: 2000, region: "us-east-1", avgRt: 110, vu: 10, succ: 6, fail: 1 },
      ];

      const config: RegionalChartConfig = {
        metric: ChartMetric.AverageResponseTime,
        yAxisTitle: "Response Time",
        regionColors: { "us-east-1": "#688ae8" },
      };

      createRegionalTimeSeriesChart(mockCtx, data, config);

      const { chartConfig } = MockChartClass.instances[0];
      expect(chartConfig.data.datasets).toHaveLength(1);
      expect(chartConfig.data.datasets[0].label).toBe("us-east-1");
    });

    it("should configure chart with correct options", () => {
      const data: RegionalChartDataPoint[] = [
        { timestamp: 1000, region: "us-east-1", avgRt: 100, vu: 10, succ: 5, fail: 0 },
      ];

      const config: RegionalChartConfig = {
        metric: ChartMetric.AverageResponseTime,
        yAxisTitle: "Custom Title",
        regionColors: {},
      };

      createRegionalTimeSeriesChart(mockCtx, data, config);

      const { chartConfig } = MockChartClass.instances[0];
      expect(chartConfig.options.responsive).toBe(true);
      expect(chartConfig.options.scales.y.title.text).toBe("Custom Title");
      expect(chartConfig.options.scales.y.min).toBe(0);
      expect(chartConfig.options.scales.x.type).toBe("time");
    });
  });
});
