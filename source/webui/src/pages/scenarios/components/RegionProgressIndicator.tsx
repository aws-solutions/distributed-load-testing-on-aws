// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import MixedLineBarChart from "@cloudscape-design/components/mixed-line-bar-chart";
import type { MixedLineBarChartProps } from "@cloudscape-design/components/mixed-line-bar-chart";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import type { TaskStatusItem } from "../types";

interface RegionProgressIndicatorProps {
  readonly items: readonly TaskStatusItem[];
}

const STATES = [
  { key: "running", label: "Running", color: "#1d8102", status: "success" },
  { key: "pending", label: "Pending", color: "#0073bb", status: "pending" },
  { key: "provisioning", label: "Provisioning", color: "#e07b12", status: "in-progress" },
  { key: "stopped", label: "Stopped", color: "#d13212", status: "stopped" },
] as const;

function pct(count: number, desired: number): number {
  return desired > 0 ? Math.min(100, (count / desired) * 100) : 0;
}

/** Builds stacked bar series from task status items, normalized to percentages of desired. */
export function buildPercentageSeries(items: readonly TaskStatusItem[]) {
  return STATES.map((s) => ({
    title: s.label,
    type: "bar" as const,
    color: s.color,
    data: items.map((i) => ({ x: i.region, y: pct(i[s.key], i.desired) })),
  }));
}

function absoluteCount(items: readonly TaskStatusItem[], region: string, title: string): { count: number; desired: number } {
  const item = items.find((i) => i.region === region);
  if (!item) return { count: 0, desired: 0 };
  const key = STATES.find((s) => s.label === title)?.key;
  return { count: key ? item[key] : 0, desired: item.desired };
}

const TABLE_COLUMNS = [
  {
    id: "region",
    header: "Region",
    cell: (item: TaskStatusItem) => item.region,
    minWidth: 120,
  },
  ...STATES.map((s) => ({
    id: s.key,
    header: s.label,
    cell: (item: TaskStatusItem) => (
      <StatusIndicator type={s.status}>{item[s.key].toLocaleString()}</StatusIndicator>
    ),
    minWidth: 90,
  })),
  {
    id: "desired",
    header: "Desired",
    cell: (item: TaskStatusItem) => item.desired.toLocaleString(),
    minWidth: 80,
  },
];

const EMPTY = (
  <Box color="inherit" textAlign="center">
    No task data available.
  </Box>
);

/** Renders a percentage-based horizontal stacked bar chart above a compact counts table. */
export function RegionProgressIndicator({ items }: RegionProgressIndicatorProps) {
  if (items.length === 0) return null;

  const series = buildPercentageSeries(items);

  const detailPopoverSeriesContent: MixedLineBarChartProps.DetailPopoverSeriesContent<string> = ({ series: s, x }) => {
    const { count, desired } = absoluteCount(items, x, s.title);
    return { key: s.title, value: `${count.toLocaleString()} / ${desired.toLocaleString()}` };
  };

  return (
    <SpaceBetween size="l">
      <MixedLineBarChart
        series={series}
        horizontalBars
        stackedBars
        xScaleType="categorical"
        xDomain={items.map((i) => i.region)}
        yDomain={[0, 100]}
        yTickFormatter={(v) => `${v}%`}
        legendTitle="Task state"
        emphasizeBaselineAxis
        hideFilter
        height={Math.max(120, items.length * 50)}
        ariaLabel="Task provisioning progress by region"
        detailPopoverSeriesContent={detailPopoverSeriesContent}
        empty={EMPTY}
      />
      <Table
        columnDefinitions={TABLE_COLUMNS}
        items={items as TaskStatusItem[]}
        trackBy="region"
        contentDensity="compact"
        stripedRows
        variant="borderless"
        header={
          <Header description="Absolute task counts per region and state." variant="h3">
            Task counts
          </Header>
        }
        empty={EMPTY}
      />
    </SpaceBetween>
  );
}
