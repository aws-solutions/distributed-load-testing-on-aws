// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { PubSub } from "@aws-amplify/pubsub";
import { Box, ColumnLayout, Container, Header, SpaceBetween, Table } from "@cloudscape-design/components";
import Chart from "chart.js/auto";
import "chartjs-adapter-date-fns";
import { useEffect, useRef, useState } from "react";
import type { Subscription } from "rxjs";
import { ChartMetric, createRegionalTimeSeriesChart, RegionalDatasets } from "../../../utils/chartHelpers";
import { createRegionColorMap } from "../../../utils/colorUtils";
import { ScenarioDefinition } from "../types";

interface TaskStatusProps {
  scenario_definition: ScenarioDefinition;
  isRefreshing?: boolean;
}

interface TaskStatusItem {
  region: string;
  running: number;
  pending: number;
  provisioning: number;
  concurrency: number;
  task_counts: number;
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

  // Helper function to get task count for a region
  const getTaskCountForRegion = (region: string): number => {
    const testTaskConfig = scenario_definition.testTaskConfigs?.find((config) => config.region === region);
    return testTaskConfig?.taskCount || 1;
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
            Object.entries(data || {}).forEach(([region, regionData]: [string, any]) => {
              if (Array.isArray(regionData)) {
                regionData.forEach((item: any) => {
                  if (item.avgRt !== undefined && item.timestamp) {
                    setChartData((prev) => {
                      const latestData = new Map(prev);
                      if (!latestData.has(region)) {
                        latestData.set(region, []);
                      }
                      latestData.get(region)!.push({
                        timestamp: item.timestamp,
                        region,
                        [ChartMetric.AverageResponseTime]: item.avgRt,
                        [ChartMetric.VirtualUsers]: (item.vu || 0) * getTaskCountForRegion(region), // Virtual Users (per task) * Number of Tasks
                        [ChartMetric.SuccessfulRequests]: item.succ || 0,
                        [ChartMetric.FailedRequests]: item.fail || 0,
                      });
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

  const calculateTaskStatusByRegion = () => {
    return (
      scenario_definition.tasksPerRegion?.map((tasks_per_region_data) => {
        let running = 0,
          pending = 0,
          provisioning = 0;

        tasks_per_region_data.tasks.forEach((task) => {
          switch (task.lastStatus) {
            case "RUNNING":
              running++;
              break;
            case "PENDING":
              pending++;
              break;
            case "PROVISIONING":
              provisioning++;
              break;
          }
        });

        const testTaskConfig = scenario_definition.testTaskConfigs?.find(
          (config) => config.region === tasks_per_region_data.region
        );

        return {
          region: tasks_per_region_data.region,
          running,
          pending,
          provisioning,
          concurrency: testTaskConfig?.concurrency || 0,
          task_counts: testTaskConfig?.taskCount || 0,
        };
      }) || []
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
        regionDatasets.get(item.region)!.push(item);
      }
    });

    // Update datasets
    chart.data.datasets = Array.from(regionDatasets.entries()).map(([region, regionData]) => ({
      label: region,
      data: regionData as any,
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
      <Container header={<Header variant="h3">Task Status</Header>}>
        <Table
          loading={isRefreshing}
          columnDefinitions={[
            { id: "region", header: "Region", cell: (item: TaskStatusItem) => item.region },
            { id: "task_counts", header: "Task Counts", cell: (item: TaskStatusItem) => item.task_counts },
            { id: "concurrency", header: "Concurrency", cell: (item: TaskStatusItem) => item.concurrency },

            { id: "running", header: "Running", cell: (item: TaskStatusItem) => item.running },
            { id: "pending", header: "Pending", cell: (item: TaskStatusItem) => item.pending },
            { id: "provisioning", header: "Provisioning", cell: (item: TaskStatusItem) => item.provisioning },
          ]}
          items={taskStatusData}
          empty="No task data available"
        />
      </Container>

      <Container header={<Header variant="h3">Real Time Metrics</Header>}>
        <ColumnLayout columns={2}>
          <Box>
            <Container header={<Header variant={"h4" as any}>Average Response Time</Header>}>
              {hasChartData() ? <canvas ref={avgRtChartRef} style={{ maxHeight: "400px" }}></canvas> : noData.empty}
            </Container>
          </Box>
          <Box>
            <Container header={<Header variant={"h4" as any}>Virtual Users</Header>}>
              {hasChartData() ? <canvas ref={vuChartRef} style={{ maxHeight: "400px" }}></canvas> : noData.empty}
            </Container>
          </Box>
          <Box>
            <Container header={<Header variant={"h4" as any}>Successful Requests</Header>}>
              {hasChartData() ? <canvas ref={succChartRef} style={{ maxHeight: "400px" }}></canvas> : noData.empty}
            </Container>
          </Box>
          <Box>
            <Container header={<Header variant={"h4" as any}>Failed Requests</Header>}>
              {hasChartData() ? <canvas ref={failChartRef} style={{ maxHeight: "400px" }}></canvas> : noData.empty}
            </Container>
          </Box>
        </ColumnLayout>
      </Container>
    </SpaceBetween>
  );
}
