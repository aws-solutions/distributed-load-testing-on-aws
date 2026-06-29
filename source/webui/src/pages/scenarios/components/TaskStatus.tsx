// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { PubSub } from "@aws-amplify/pubsub";
import { Box, ColumnLayout, Container, Header, SpaceBetween } from "@cloudscape-design/components";
import Chart from "chart.js/auto";
import "chartjs-adapter-date-fns";
import { useEffect, useRef, useState } from "react";
import type { Subscription } from "rxjs";
import { ChartMetric, createRegionalTimeSeriesChart, RegionalDatasets } from "../../../utils/chartHelpers";
import { createRegionColorMap } from "../../../utils/colorUtils";
import { isTerminalState, TestStatus } from "../constants";
import type { ScenarioDefinition, TasksPerRegion, TestTaskConfig, TaskStatusItem } from "../types";
import { RegionProgressIndicator } from "./RegionProgressIndicator";

export type { TaskStatusItem };

/** Convenience alias extracted from the TaskStatusItem interface. */
type RegionStatus = TaskStatusItem["regionStatus"];

/** States where task provisioning data is still relevant. */
const TASK_PROGRESS_STATES: ReadonlySet<string> = new Set([
  TestStatus.QUEUED,
  TestStatus.PROVISIONING,
  TestStatus.RUNNING,
]);

interface TaskStatusProps {
  readonly scenario_definition: ScenarioDefinition;
  readonly isRefreshing?: boolean;
}

/**
 * Derives the region health status from ECS task counts and the overall test status.
 *
 * - "Degraded"      — stopped > 0 while the test is running (unexpected worker loss)
 * - "Stopping"      — stopped > 0 while the test is cancelling or cleaning up
 * - "Ready"         — running === desired (all tasks healthy)
 * - "Provisioning"  — running < desired, no stopped tasks
 */
function deriveRegionStatus(
  running: number,
  stopped: number,
  desired: number,
  testStatus: string,
): RegionStatus {
  if (stopped > 0) {
    if (testStatus === TestStatus.RUNNING) {
      return "Degraded";
    }
    if (testStatus === TestStatus.CANCELLING || testStatus === TestStatus.CLEANING_UP) {
      return "Stopping";
    }
  }
  if (running === desired) {
    return "Ready";
  }
  return "Provisioning";
}

/**
 * Computes a TaskStatusItem from aggregate ECS service counts and region config.
 * Exported for independent testing.
 *
 * describeServices provides running, pending, and desired. Stopped count
 * comes from taskFailureCount (tracked by the Task Failure Handler in DDB).
 * Provisioning is inferred: tasks that are neither running, pending, nor stopped
 * but haven't reached the desired count yet.
 */
export function computeTaskStatusItem(
  tasksPerRegion: TasksPerRegion,
  testTaskConfig: TestTaskConfig | undefined,
  testStatus: string,
  taskFailureCount: number = 0,
): TaskStatusItem {
  const { running, pending } = tasksPerRegion;
  const desired = testTaskConfig?.taskCount ?? 0;
  const concurrency = testTaskConfig?.concurrency ?? 0;
  const stopped = taskFailureCount;
  // Tasks not yet running or pending, and not known to have stopped
  const provisioning = Math.max(0, desired - running - pending - stopped);

  return {
    region: tasksPerRegion.region,
    running,
    pending,
    provisioning,
    stopped,
    desired,
    concurrency,
    regionStatus: deriveRegionStatus(running, stopped, desired, testStatus),
  };
}

export function TaskStatus({ scenario_definition, isRefreshing }: TaskStatusProps) {
  const [chartData, setChartData] = useState<RegionalDatasets>(new Map());
  const avgRtChartRef = useRef<HTMLCanvasElement>(null);
  const avgRtChartInstance = useRef<Chart | null>(null);
  const vuChartRef = useRef<HTMLCanvasElement>(null);
  const vuChartInstance = useRef<Chart | null>(null);
  const succChartRef = useRef<HTMLCanvasElement>(null);
  const succChartInstance = useRef<Chart | null>(null);
  const failChartRef = useRef<HTMLCanvasElement>(null);
  const failChartInstance = useRef<Chart | null>(null);

  const getTaskCountForRegion = (region: string): number => {
    const testTaskConfig = scenario_definition.testTaskConfigs?.find((config) => config.region === region);
    return testTaskConfig?.taskCount ?? 1;
  };

  useEffect(() => {
    const testId = scenario_definition.testId;
    if (!testId) {
      console.log("No testId provided, skipping PubSub subscription");
      return;
    }

    let subscription: Subscription;

    const setupPubSub = async () => {
      try {
        const response = await fetch("/aws-exports.json");
        const config = await response.json();
        const pubsub = new PubSub({
          region: config.IoTEndpoint.split(".")[2],
          endpoint: `wss://${config.IoTEndpoint}/mqtt`,
        });

        subscription = pubsub.subscribe({ topics: [`dlt/${testId}`] }).subscribe({
          next: (data) => {
            Object.entries(data || {}).forEach(([region, regionData]: [string, unknown]) => {
              if (Array.isArray(regionData)) {
                regionData.forEach((item: unknown) => {
                  if (isChartDataPoint(item)) {
                    setChartData((prev) => {
                      const latestData = new Map(prev);
                      if (!latestData.has(region)) {
                        latestData.set(region, []);
                      }
                      const regionPoints = latestData.get(region);
                      if (regionPoints) {
                        regionPoints.push({
                          timestamp: item.timestamp,
                          region,
                          [ChartMetric.AverageResponseTime]: item.avgRt,
                          [ChartMetric.VirtualUsers]: (item.vu ?? 0) * getTaskCountForRegion(region), // Virtual Users (per task) * Number of Tasks
                          [ChartMetric.SuccessfulRequests]: item.succ ?? 0,
                          [ChartMetric.FailedRequests]: item.fail ?? 0,
                        });
                      }
                      return latestData;
                    });
                  }
                });
              }
            });
          },
        });
      } catch (error) {
        console.error("Error subscribing to IoT Topic:", error);
      }
    };

    setupPubSub();

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [scenario_definition.testId]);

  // Chart instance for Average Response Time
  useEffect(() => {
    if (!avgRtChartRef.current || !hasChartData()) return;

    const ctx = avgRtChartRef.current.getContext("2d");
    if (!ctx) return;

    if (avgRtChartInstance.current) {
      // Update existing chart (if available)
      updateChartDatasets(avgRtChartInstance.current, ChartMetric.AverageResponseTime);
    } else {
      // Create chart instance
      avgRtChartInstance.current = createRegionalTimeSeriesChart(ctx, getFlatChartData(), {
        metric: ChartMetric.AverageResponseTime,
        yAxisTitle: "Response Time (s)",
        regionColors: getRegionColors(),
      });
    }
  }, [chartData]);

  // Chart instance for Virtual Users
  useEffect(() => {
    if (!vuChartRef.current || !hasChartData()) return;

    const ctx = vuChartRef.current.getContext("2d");
    if (!ctx) return;

    if (vuChartInstance.current) {
      // Update existing chart (if available)
      updateChartDatasets(vuChartInstance.current, ChartMetric.VirtualUsers);
    } else {
      // Create chart instance
      vuChartInstance.current = createRegionalTimeSeriesChart(ctx, getFlatChartData(), {
        metric: ChartMetric.VirtualUsers,
        yAxisTitle: "Virtual Users",
        regionColors: getRegionColors(),
      });
    }
  }, [chartData]);

  // Chart instance for Successful Requests
  useEffect(() => {
    if (!succChartRef.current || !hasChartData()) return;

    const ctx = succChartRef.current.getContext("2d");
    if (!ctx) return;

    if (succChartInstance.current) {
      // Update existing chart (if available)
      updateChartDatasets(succChartInstance.current, ChartMetric.SuccessfulRequests);
    } else {
      // Create chart instance
      succChartInstance.current = createRegionalTimeSeriesChart(ctx, getFlatChartData(), {
        metric: ChartMetric.SuccessfulRequests,
        yAxisTitle: "Successful Requests",
        regionColors: getRegionColors(),
      });
    }
  }, [chartData]);

  // Chart instance for Failed Requests
  useEffect(() => {
    if (!failChartRef.current || !hasChartData()) return;

    const ctx = failChartRef.current.getContext("2d");
    if (!ctx) return;

    if (failChartInstance.current) {
      // Update existing chart (if available)
      updateChartDatasets(failChartInstance.current, ChartMetric.FailedRequests);
    } else {
      // Create chart instance
      failChartInstance.current = createRegionalTimeSeriesChart(ctx, getFlatChartData(), {
        metric: ChartMetric.FailedRequests,
        yAxisTitle: "Failed Requests",
        regionColors: getRegionColors(),
      });
    }
  }, [chartData]);

  const calculateTaskStatusByRegion = (): readonly TaskStatusItem[] => {
    // taskFailureCount is a scenario-level counter (not per-region).
    // It represents the total number of unexpected task exits across all regions.
    const taskFailureCount = scenario_definition.taskFailureCount ?? 0;
    return (
      scenario_definition.tasksPerRegion?.map((tasksPerRegion) => {
        const testTaskConfig = scenario_definition.testTaskConfigs?.find(
          (config) => config.region === tasksPerRegion.region
        );
        return computeTaskStatusItem(tasksPerRegion, testTaskConfig, scenario_definition.status, taskFailureCount);
      }) ?? []
    );
  };

  const taskStatusData = calculateTaskStatusByRegion();

  const hasChartData = () => chartData.size > 0;

  const getFlatChartData = () => {
    return Array.from(chartData.values()).flat();
  };

  const getRegionColors = () => {
    const regions = Array.from(chartData.keys());
    return createRegionColorMap(regions);
  };

  const updateChartDatasets = (chart: Chart, metric: ChartMetric) => {
    const flatData = getFlatChartData();
    const regionColors = getRegionColors();

    // Group data by region
    const regionDatasets: RegionalDatasets = new Map();
    flatData.forEach((item) => {
      if (item.region) {
        if (!regionDatasets.has(item.region)) {
          regionDatasets.set(item.region, []);
        }
        const regionPoints = regionDatasets.get(item.region);
        if (regionPoints) {
          regionPoints.push(item);
        }
      }
    });

    // Chart.js boundary: the parsing config reads our custom keys, but the
    // dataset type expects numeric arrays. This cast is safe because Chart.js
    // uses the parsing.yAxisKey / xAxisKey to extract values at render time.
    chart.data.datasets = Array.from(regionDatasets.entries()).map(([region, regionData]) => ({
      label: region,
      data: regionData as unknown as (number | null)[],
      parsing: {
        yAxisKey: metric,
        xAxisKey: "timestamp",
      },
      pointRadius: 1,
      pointHoverRadius: 3,
      borderColor: regionColors[region],
      backgroundColor: regionColors[region],
      borderWidth: 2,
      fill: false,
    }));

    chart.update("none"); // Update without animation
  };

  // Cleanup all charts on component unmount only
  useEffect(() => {
    return () => {
      avgRtChartInstance.current?.destroy();
      vuChartInstance.current?.destroy();
      succChartInstance.current?.destroy();
      failChartInstance.current?.destroy();
    };
  }, []);

  // For terminal states, hide the panel entirely when there's no data to show.
  // During active states the panel is always visible for live monitoring.
  if (isTerminalState(scenario_definition.status) && !hasChartData() && taskStatusData.length === 0) {
    return null;
  }

  const noData = {
    empty: (
      <div>
        <Box textAlign="center" color="inherit">
          There is no data available.
        </Box>
      </div>
    ),
  };

  return (
    <SpaceBetween size="l">
      {TASK_PROGRESS_STATES.has(scenario_definition.status) && (
        <Container header={<Header variant="h3">Task Status</Header>}>
          {taskStatusData.length > 0 ? (
            <RegionProgressIndicator items={taskStatusData} />
          ) : (
            <Box textAlign="center" color="inherit">There is no data available.</Box>
          )}
        </Container>
      )}

      <Container header={<Header variant="h3">Real Time Metrics</Header>}>
        <ColumnLayout columns={2}>
          <Box>
            <Container header={<Header variant="h3">Average Response Time</Header>}>
              {hasChartData() ? <canvas ref={avgRtChartRef} style={{ maxHeight: "400px" }}></canvas> : noData.empty}
            </Container>
          </Box>
          <Box>
            <Container header={<Header variant="h3">Virtual Users</Header>}>
              {hasChartData() ? <canvas ref={vuChartRef} style={{ maxHeight: "400px" }}></canvas> : noData.empty}
            </Container>
          </Box>
          <Box>
            <Container header={<Header variant="h3">Successful Requests</Header>}>
              {hasChartData() ? <canvas ref={succChartRef} style={{ maxHeight: "400px" }}></canvas> : noData.empty}
            </Container>
          </Box>
          <Box>
            <Container header={<Header variant="h3">Failed Requests</Header>}>
              {hasChartData() ? <canvas ref={failChartRef} style={{ maxHeight: "400px" }}></canvas> : noData.empty}
            </Container>
          </Box>
        </ColumnLayout>
      </Container>
    </SpaceBetween>
  );
}

/** Type guard for PubSub chart data points. */
function isChartDataPoint(value: unknown): value is { readonly avgRt: number; readonly timestamp: number; readonly vu?: number; readonly succ?: number; readonly fail?: number } {
  if (typeof value !== "object" || value === null) return false;
  if (!("avgRt" in value) || !("timestamp" in value)) return false;
  // After `in` narrows, TS allows property access on the intersection type
  return typeof value.avgRt === "number" && typeof value.timestamp === "number";
}
