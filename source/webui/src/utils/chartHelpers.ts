// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import Chart from "chart.js/auto";

/**
 * Enum defining the available chart metrics with meaningful names
 */
export enum ChartMetric {
  AverageResponseTime = 'avgRt',
  VirtualUsers = 'vu',
  SuccessfulRequests = 'succ',
  FailedRequests = 'fail'
}

/**
 * Interface for regional chart data points with explicit metric properties
 */
export interface RegionalChartDataPoint {
  timestamp: number;
  region: string;
  [ChartMetric.AverageResponseTime]: number;
  [ChartMetric.VirtualUsers]: number;
  [ChartMetric.SuccessfulRequests]: number;
  [ChartMetric.FailedRequests]: number;
}

/**
 * Configuration interface for regional time series charts
 */
export interface RegionalChartConfig {
  metric: ChartMetric;
  yAxisTitle: string;
  regionColors: Record<string, string>;
}

/**
 * Type for organizing chart data by region
 */
export type RegionalDatasets = Map<string, RegionalChartDataPoint[]>;

/**
 * Creates a time series chart with region-specific coloring
 * @param ctx - Canvas 2D rendering context
 * @param data - Array of regional chart data points
 * @param config - Chart configuration with metric and styling options
 * @returns Chart.js Chart instance
 */
export const createRegionalTimeSeriesChart = (
  ctx: CanvasRenderingContext2D, 
  data: RegionalChartDataPoint[], 
  config: RegionalChartConfig
): Chart => {
  const regionDatasets: RegionalDatasets = new Map();
  
  // Group data by region
  data.forEach(item => {
    if (item.region) {
      if (!regionDatasets.has(item.region)) {
        regionDatasets.set(item.region, []);
      }
      regionDatasets.get(item.region)!.push(item);
    }
  });

  // Create datasets for each region
  const datasets = Array.from(regionDatasets.entries()).map(([region, regionData]) => ({
    label: region,
    data: regionData as any,
    parsing: {
      yAxisKey: config.metric,
      xAxisKey: "timestamp",
    },
    pointRadius: 1,
    pointHoverRadius: 3,
    borderColor: config.regionColors[region] || "#688ae8",
    backgroundColor: config.regionColors[region] || "#688ae8",
    borderWidth: 2,
    fill: false,
  }));

  return new Chart(ctx, {
    type: "scatter",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1.5,
      animation: { duration: 0 },
      scales: {
        x: {
          type: "time",
          time: { unit: "minute" },
          title: { display: true, text: "Time" },
        },
        y: {
          type: "linear",
          display: true,
          position: "left",
          title: { display: true, text: config.yAxisTitle },
          min: 0,
        },
      },
      plugins: { 
        legend: { 
          display: true,
          position: "bottom",
          labels: {
            usePointStyle: true,
            pointStyle: "circle",
          }
        } 
      },
      interaction: {
        intersect: false,
        mode: "index",
      },
    },
  });
};
