// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@cloudscape-design/components";
import React, { useCallback, useMemo } from "react";
import { formatToLocalTime } from "../../../utils/dateUtils";
import { TableColumn, TestRun } from "../types";
import { createBaselineCellWithStatus, getBaselineDelta, getBaselineText } from "../utils";



const METRICS_CONFIG = [
  { id: "requests", header: "Requests", metricType: 'higher-is-better' as const },
  { id: "success", header: "Success", metricType: 'higher-is-better' as const },
  { id: "errors", header: "Errors", metricType: 'lower-is-better' as const },
  { id: "requestsPerSecond", header: "Requests per Second", metricType: 'higher-is-better' as const },
  { id: "avgResponseTime", header: "Avg Resp Time", metricType: 'lower-is-better' as const },
  { id: "avgLatency", header: "Avg Latency", metricType: 'lower-is-better' as const },
  { id: "avgConnectionTime", header: "Avg Connection time", metricType: 'lower-is-better' as const },
  { id: "avgBandwidth", header: "Avg Bandwidth", metricType: 'lower-is-better' as const },
];

const PERCENTILES_CONFIG = [
  { id: "p100", header: "100th Resp Time" },
  { id: "p99_9", header: "99.9th Resp Time" },
  { id: "p99", header: "99th Resp Time" },
  { id: "p95", header: "95th Resp Time" },
  { id: "p90", header: "90th Resp Time" },
  { id: "p50", header: "50th Resp Time" },
  { id: "p0", header: "0th Resp Time" },
];

export const useTestRunColumns = (baselineTestRun: TestRun | null, onTestRunClick?: (testRunId: string) => void) => {
  const createColumn = useCallback(
    (id: string, header: string, cellFn: (item: TestRun) => any, csvValueFn: (item: TestRun) => string, csvBaselineFn?: (item: TestRun) => string, sortingField?: string, sortingComparator?: (a: TestRun, b: TestRun) => number): TableColumn<TestRun> => ({
      id,
      header,
      cell: cellFn,
      csvValue: csvValueFn,
      csvBaselineValue: csvBaselineFn,
      preferenceHeader: header,
      ...(sortingField && { sortingField }),
      ...(sortingComparator && { sortingComparator }),
    }),
    []
  );



  const formatValue = useCallback((config: typeof METRICS_CONFIG[0], value: number | undefined) => {
    if (!value) return "--";
    if (config.id === "avgBandwidth") return `${(value / 1024).toFixed(2)} KB/s`;
    if (config.id.includes("Time") || config.id.includes("Latency")) return `${value.toFixed(2)}ms`;
    if (config.id === "requestsPerSecond") return value.toFixed(2);
    return value.toLocaleString();
  }, []);

  const allColumns = useMemo(() => {
    const columns: TableColumn<TestRun>[] = [
      createColumn(
        "testRun", 
        "Start Time", 
        (item) => formatToLocalTime(item.startTime, { hour12: false }),
        (item) => formatToLocalTime(item.startTime, { hour12: false }),
        undefined,
        "startTime"
      ),
      createColumn(
        "testRunId", 
        "Test Run ID", 
        (item) => onTestRunClick
          ? React.createElement(Link, { onFollow: () => onTestRunClick(item.testRunId) }, item.testRunId)
          : item.testRunId,
        (item) => item.testRunId,
        undefined,
        "testRunId"
      ),
    ];

    const metrics = METRICS_CONFIG.map((config) => {
      const getValue = (item: TestRun) => {
        return item[config.id as keyof TestRun] as number | undefined;
      };
      
      const baselineValue = baselineTestRun ? getValue(baselineTestRun) : undefined;
      const baselineText = getBaselineText(baselineValue, (val) => formatValue(config, val));
      
      return {
        id: config.id,
        header: `${config.header}${baselineText}`,
        preferenceHeader: config.header,
        cell: (item: TestRun) => {
          const currentValue = getValue(item);
          const formattedCurrent = formatValue(config, currentValue);
          return createBaselineCellWithStatus(formattedCurrent, currentValue, baselineValue, !!baselineTestRun, config.metricType);
        },
        csvValue: (item: TestRun) => formatValue(config, getValue(item)),
        csvBaselineValue: baselineTestRun ? (item: TestRun) => {
          const currentValue = getValue(item);
          return getBaselineDelta(currentValue, baselineValue);
        } : undefined,
        sortingField: config.id,
      };
    });

    columns.push(...metrics);

    const formatPercentile = (value: number | undefined) => (value ? `${value.toFixed(2)}ms` : "--");

    PERCENTILES_CONFIG.forEach((p) => {
      const baselineValue = baselineTestRun?.percentiles?.[p.id as keyof typeof baselineTestRun.percentiles];
      const baselineText = getBaselineText(baselineValue, (val) => `${val.toFixed(2)}ms`);
      
      columns.push({
        id: p.id,
        header: `${p.header}${baselineText}`,
        preferenceHeader: p.header,
        cell: (item: TestRun) => {
          const currentValue = item.percentiles?.[p.id as keyof typeof item.percentiles];
          const formattedCurrent = formatPercentile(currentValue);
          return createBaselineCellWithStatus(formattedCurrent, currentValue, baselineValue, !!baselineTestRun, 'lower-is-better');
        },
        csvValue: (item: TestRun) => {
          const currentValue = item.percentiles?.[p.id as keyof typeof item.percentiles];
          return formatPercentile(currentValue);
        },
        csvBaselineValue: baselineTestRun ? (item: TestRun) => {
          const currentValue = item.percentiles?.[p.id as keyof typeof item.percentiles];
          return getBaselineDelta(currentValue, baselineValue);
        } : undefined,
        sortingComparator: (a: TestRun, b: TestRun) =>
          (a.percentiles?.[p.id as keyof typeof a.percentiles] || 0) -
          (b.percentiles?.[p.id as keyof typeof b.percentiles] || 0)
      });
    });

    return columns;
  }, [baselineTestRun]);

  const getFilteredColumns = (preferences: any) => {
    const columnMap = new Map(allColumns.map((col) => [col.id, col]));
    return preferences.contentDisplay
      .filter(({ visible }: any) => visible)
      .map(({ id }: any) => columnMap.get(id))
      .filter(Boolean);
  };

  return { allColumns, getFilteredColumns };
};
