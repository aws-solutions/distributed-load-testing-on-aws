// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Button, Header, SegmentedControl, SpaceBetween, Table, TextFilter } from "@cloudscape-design/components";
import { useEffect, useMemo, useState } from "react";
import { TablePreferences } from "../../../components/common/TablePreferences";
import { useTestResultsData } from "../hooks/useTestResultsData";
import { TableColumn } from "../types";
import { BaselineResponse, TableRow, TestRunDetails } from "../types/testResults";
import { ViewMode } from "../types/viewMode";
import { createBaselineComparisonCell, downloadCSV, generateCSV, getBaselineDelta } from "../utils";
import { BaselineDisplayMode } from "./TestResultsBaseline";

const INITIAL_PREFERENCES = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: false,
  contentDensity: "comfortable" as const,
  stickyColumns: { first: 1, last: 0 },
  contentDisplay: [
    { id: "run", visible: true },
    { id: "region", visible: true },
    { id: "testLabel", visible: true },
    // Core volume metrics
    { id: "requests", visible: true },
    { id: "requests_baseline", visible: true },
    { id: "success", visible: true },
    { id: "success_baseline", visible: false },
    { id: "errors", visible: true },
    { id: "errors_baseline", visible: false },
    { id: "successRate", visible: true },
    { id: "successRate_baseline", visible: true },
    // Throughput metrics - hidden by default
    { id: "requestsPerSecond", visible: false },
    { id: "requestsPerSecond_baseline", visible: false },
    // Core performance metrics
    { id: "avgRespTime", visible: true },
    { id: "avgRespTime_baseline", visible: true },
    // Additional performance metrics - hidden by default
    { id: "avgLatency", visible: false },
    { id: "avgLatency_baseline", visible: false },
    { id: "avgConnectionTime", visible: false },
    { id: "avgConnectionTime_baseline", visible: false },
    { id: "avgBandwidth", visible: false },
    { id: "avgBandwidth_baseline", visible: false },
    // Percentile metrics - only p95 visible by default
    { id: "p0RespTime", visible: false },
    { id: "p0RespTime_baseline", visible: false },
    { id: "p50RespTime", visible: false },
    { id: "p50RespTime_baseline", visible: false },
    { id: "p90RespTime", visible: false },
    { id: "p90RespTime_baseline", visible: false },
    { id: "p95RespTime", visible: true },
    { id: "p95RespTime_baseline", visible: true },
    { id: "p99RespTime", visible: false },
    { id: "p99RespTime_baseline", visible: false },
    { id: "p99_9RespTime", visible: false },
    { id: "p99_9RespTime_baseline", visible: false },
    { id: "p100RespTime", visible: false },
    { id: "p100RespTime_baseline", visible: false },
  ],
};

const PREFERENCES_KEY = "testResultsTablePreferences";

const PAGE_SIZE_OPTIONS = [
  { value: 10, label: "10 results" },
  { value: 20, label: "20 results" },
  { value: 50, label: "50 results" },
];

export interface TestResultsTableProps {
  testRun: TestRunDetails | undefined;
  baseline: BaselineResponse | undefined;
  selectedItems: TableRow[];
  onSelectionChange: (items: TableRow[]) => void;
  displayMode: BaselineDisplayMode;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export function TestResultsTable({ testRun, baseline, selectedItems, onSelectionChange, displayMode, viewMode, onViewModeChange }: TestResultsTableProps) {
  const [filteringText, setFilteringText] = useState("");

  // Load preferences from localStorage
  const [preferences, setPreferences] = useState(() => {
    try {
      const saved = localStorage.getItem(PREFERENCES_KEY);
      return saved ? { ...INITIAL_PREFERENCES, ...JSON.parse(saved) } : INITIAL_PREFERENCES;
    } catch {
      return INITIAL_PREFERENCES;
    }
  });

  // Save preferences to localStorage
  useEffect(() => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }, [preferences]);

  // Gather test run data
  const { rows, baselineComparisons, aggregatedBaseline } = useTestResultsData(testRun, baseline, viewMode);

  // Apply text filter
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.testLabel.toLowerCase().includes(filteringText.toLowerCase()) ||
          row.region.toLowerCase().includes(filteringText.toLowerCase())
      ),
    [rows, filteringText]
  );

  // Build column definitions
  const allColumns: TableColumn<TableRow>[] = useMemo(() => {
    const columns: TableColumn<TableRow>[] = [];

    // Run column
    columns.push({
      id: "run",
      header: "Run",
      cell: (item) => item.run,
      csvValue: (item) => item.run,
      sortingField: "run",
      preferenceHeader: "Run",
    });

    // Region column (conditional visibility based on view mode)
    columns.push({
      id: "region",
      header: "Region",
      cell: (item) => item.region,
      csvValue: (item) => item.region,
      sortingField: "region",
      preferenceHeader: "Region",
    });

    // Endpoint column
    columns.push({
      id: "testLabel",
      header: "Endpoint",
      cell: (item) => item.testLabel,
      csvValue: (item) => item.testLabel,
      sortingField: "testLabel",
      preferenceHeader: "Endpoint",
    });

    // Requests
    columns.push({
      id: "requests",
      header: "Requests",
      cell: (item) => item.requests.toLocaleString(),
      csvValue: (item) => item.requests.toLocaleString(),
      sortingField: "requests",
      preferenceHeader: "Requests",
    });

    // Requests vs Baseline
    if (baseline) {
      columns.push({
        id: "requests_baseline",
        header: "vs Baseline",
        cell: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return createBaselineComparisonCell(
            item.requests,
            comparison?.requests,
            'higher-is-better',
            displayMode,
            (val) => val.toLocaleString()
          );
        },
        csvValue: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return getBaselineDelta(item.requests, comparison?.requests);
        },
        preferenceHeader: "Requests vs Baseline",
      });
    }

    // Success
    columns.push({
      id: "success",
      header: "Success",
      cell: (item) => item.success.toLocaleString(),
      csvValue: (item) => item.success.toLocaleString(),
      sortingField: "success",
      preferenceHeader: "Success",
    });

    // Success vs Baseline
    if (baseline) {
      columns.push({
        id: "success_baseline",
        header: "vs Baseline",
        cell: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return createBaselineComparisonCell(
            item.success,
            comparison?.success,
            'higher-is-better',
            displayMode,
            (val) => val.toLocaleString()
          );
        },
        csvValue: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return getBaselineDelta(item.success, comparison?.success);
        },
        preferenceHeader: "Success vs Baseline",
      });
    }

    // Errors
    columns.push({
      id: "errors",
      header: "Errors",
      cell: (item) => item.errors.toLocaleString(),
      csvValue: (item) => item.errors.toLocaleString(),
      sortingField: "errors",
      preferenceHeader: "Errors",
    });

    // Errors vs Baseline
    if (baseline) {
      columns.push({
        id: "errors_baseline",
        header: "vs Baseline",
        cell: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return createBaselineComparisonCell(
            item.errors,
            comparison?.errors,
            'lower-is-better',
            displayMode,
            (val) => val.toLocaleString()
          );
        },
        csvValue: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return getBaselineDelta(item.errors, comparison?.errors);
        },
        preferenceHeader: "Errors vs Baseline",
      });
    }

    // Success Rate
    columns.push({
      id: "successRate",
      header: "Success Rate",
      cell: (item) => `${item.successRate.toFixed(2)}%`,
      csvValue: (item) => `${item.successRate.toFixed(2)}%`,
      sortingField: "successRate",
      preferenceHeader: "Success Rate",
    });

    // Success Rate vs Baseline
    if (baseline) {
      columns.push({
        id: "successRate_baseline",
        header: "vs Baseline",
        cell: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return createBaselineComparisonCell(
            item.successRate,
            comparison?.successRate,
            'higher-is-better',
            displayMode,
            (val) => `${val.toFixed(2)}%`
          );
        },
        csvValue: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return getBaselineDelta(item.successRate, comparison?.successRate);
        },
        preferenceHeader: "Success Rate vs Baseline",
      });
    }

    // Requests per Second
    columns.push({
      id: "requestsPerSecond",
      header: "Requests per Second",
      cell: (item) => item.requestsPerSecond.toFixed(2),
      csvValue: (item) => item.requestsPerSecond.toFixed(2),
      sortingField: "requestsPerSecond",
      preferenceHeader: "Requests per Second",
    });

    // Requests per Second vs Baseline
    if (baseline) {
      columns.push({
        id: "requestsPerSecond_baseline",
        header: "vs Baseline",
        cell: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return createBaselineComparisonCell(
            item.requestsPerSecond,
            comparison?.requestsPerSecond,
            'higher-is-better',
            displayMode,
            (val) => val.toFixed(2)
          );
        },
        csvValue: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return getBaselineDelta(item.requestsPerSecond, comparison?.requestsPerSecond);
        },
        preferenceHeader: "Requests per Second vs Baseline",
      });
    }

    // Avg Response Time
    columns.push({
      id: "avgRespTime",
      header: "Avg Resp Time",
      cell: (item) => `${item.avgRespTime.toFixed(0)}ms`,
      csvValue: (item) => `${item.avgRespTime.toFixed(0)}ms`,
      sortingField: "avgRespTime",
      preferenceHeader: "Avg Resp Time",
    });

    // Avg Response Time vs Baseline
    if (baseline) {
      columns.push({
        id: "avgRespTime_baseline",
        header: "vs Baseline",
        cell: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return createBaselineComparisonCell(
            item.avgRespTime,
            comparison?.avgRespTime,
            'lower-is-better',
            displayMode,
            (val) => `${val.toFixed(0)}ms`
          );
        },
        csvValue: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return getBaselineDelta(item.avgRespTime, comparison?.avgRespTime);
        },
        preferenceHeader: "Avg Resp Time vs Baseline",
      });
    }

    // Avg Latency
    columns.push({
      id: "avgLatency",
      header: "Avg Latency",
      cell: (item) => `${item.avgLatency.toFixed(0)}ms`,
      csvValue: (item) => `${item.avgLatency.toFixed(0)}ms`,
      sortingField: "avgLatency",
      preferenceHeader: "Avg Latency",
    });

    // Avg Latency vs Baseline
    if (baseline) {
      columns.push({
        id: "avgLatency_baseline",
        header: "vs Baseline",
        cell: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return createBaselineComparisonCell(
            item.avgLatency,
            comparison?.avgLatency,
            'lower-is-better',
            displayMode,
            (val) => `${val.toFixed(0)}ms`
          );
        },
        csvValue: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return getBaselineDelta(item.avgLatency, comparison?.avgLatency);
        },
        preferenceHeader: "Avg Latency vs Baseline",
      });
    }

    // Avg Connection Time
    columns.push({
      id: "avgConnectionTime",
      header: "Avg Connection Time",
      cell: (item) => `${item.avgConnectionTime.toFixed(0)}ms`,
      csvValue: (item) => `${item.avgConnectionTime.toFixed(0)}ms`,
      sortingField: "avgConnectionTime",
      preferenceHeader: "Avg Connection Time",
    });

    // Avg Connection Time vs Baseline
    if (baseline) {
      columns.push({
        id: "avgConnectionTime_baseline",
        header: "vs Baseline",
        cell: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return createBaselineComparisonCell(
            item.avgConnectionTime,
            comparison?.avgConnectionTime,
            'lower-is-better',
            displayMode,
            (val) => `${val.toFixed(0)}ms`
          );
        },
        csvValue: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return getBaselineDelta(item.avgConnectionTime, comparison?.avgConnectionTime);
        },
        preferenceHeader: "Avg Connection Time vs Baseline",
      });
    }

    // Avg Bandwidth
    columns.push({
      id: "avgBandwidth",
      header: "Avg Bandwidth",
      cell: (item) => `${item.avgBandwidth.toFixed(2)} KB/s`,
      csvValue: (item) => `${item.avgBandwidth.toFixed(2)} KB/s`,
      sortingField: "avgBandwidth",
      preferenceHeader: "Avg Bandwidth",
    });

    // Avg Bandwidth vs Baseline
    if (baseline) {
      columns.push({
        id: "avgBandwidth_baseline",
        header: "vs Baseline",
        cell: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return createBaselineComparisonCell(
            item.avgBandwidth,
            comparison?.avgBandwidth,
            'higher-is-better',
            displayMode,
            (val) => `${val.toFixed(2)} KB/s`
          );
        },
        csvValue: (item) => {
          const comparison = baselineComparisons.get(item.id);
          return getBaselineDelta(item.avgBandwidth, comparison?.avgBandwidth);
        },
        preferenceHeader: "Avg Bandwidth vs Baseline",
      });
    }

    // Percentile columns
    const percentiles = [
      { id: "p0RespTime", field: "p0RespTime", label: "0th Resp Time" },
      { id: "p50RespTime", field: "p50RespTime", label: "50th Resp Time" },
      { id: "p90RespTime", field: "p90RespTime", label: "90th Resp Time" },
      { id: "p95RespTime", field: "p95RespTime", label: "95th Resp Time" },
      { id: "p99RespTime", field: "p99RespTime", label: "99th Resp Time" },
      { id: "p99_9RespTime", field: "p99_9RespTime", label: "99.9th Resp Time" },
      { id: "p100RespTime", field: "p100RespTime", label: "100th Resp Time" },
    ];

    percentiles.forEach((p) => {
      // Value column
      columns.push({
        id: p.id,
        header: p.label,
        cell: (item) => {
          const currentValue = item[p.field as keyof TableRow] as number;
          return `${currentValue.toFixed(0)}ms`;
        },
        csvValue: (item) => `${(item[p.field as keyof TableRow] as number).toFixed(0)}ms`,
        sortingField: p.field,
        preferenceHeader: p.label,
      });

      // Baseline comparison column
      if (baseline) {
        columns.push({
          id: `${p.id}_baseline`,
          header: "vs Baseline",
          cell: (item) => {
            const comparison = baselineComparisons.get(item.id);
            const currentValue = item[p.field as keyof TableRow] as number;
            const baselineVal = comparison?.[p.field as keyof typeof comparison] as number | undefined;
            return createBaselineComparisonCell(
              currentValue,
              baselineVal,
              'lower-is-better',
              displayMode,
              (val) => `${val.toFixed(0)}ms`
            );
          },
          csvValue: (item) => {
            const comparison = baselineComparisons.get(item.id);
            const currentValue = item[p.field as keyof TableRow] as number;
            const baselineVal = comparison?.[p.field as keyof typeof comparison] as number | undefined;
            return getBaselineDelta(currentValue, baselineVal);
          },
          preferenceHeader: `${p.label} vs Baseline`,
        });
      }
    });

    return columns;
  }, [baseline, aggregatedBaseline, baselineComparisons, displayMode]);

  // Filter columns based on preferences and view mode
  const visibleColumns = useMemo(() => {
    const columnMap = new Map(allColumns.map((col) => [col.id, col]));
    return preferences.contentDisplay
      .filter(({ id, visible }: { id: string; visible: boolean }) => {
        // Hide region column if not in "By Region" mode
        if (id === "region" && viewMode !== ViewMode.ByRegion) {
          return false;
        }
        // Hide baseline columns if no baseline is set
        if (id.endsWith('_baseline') && !baseline) {
          return false;
        }
        return visible;
      })
      .map(({ id }: { id: string }) => columnMap.get(id))
      .filter(Boolean) as TableColumn<TableRow>[];
  }, [allColumns, preferences.contentDisplay, viewMode, baseline]);

  // Download table data as CSV
  const handleDownload = () => {
    const csvContent = generateCSV(visibleColumns, filteredRows, !!baseline);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const filename = `test-run-results-${timestamp}.csv`;
    downloadCSV(csvContent, filename);
  };

  return (
    <Table
      header={
        <Header
          variant="h3"
          actions={
            <SpaceBetween direction="horizontal" size="s">
              <SegmentedControl
                selectedId={viewMode}
                onChange={({ detail }) => {
                  const newMode = detail.selectedId as ViewMode;
                  onViewModeChange(newMode);
                  
                  // Auto-select the single row in Overall mode
                  if (newMode === ViewMode.Overall && filteredRows.length > 0) {
                    onSelectionChange([filteredRows[0]]);
                  } else {
                    // Clear selection when switching to other modes
                    onSelectionChange([]);
                  }
                }}
                options={[
                  { text: "Overall", id: ViewMode.Overall },
                  { text: "By Endpoint", id: ViewMode.ByEndpoint },
                  { text: "By Region", id: ViewMode.ByRegion },
                ]}
              />
              <Button iconName="download" variant="icon" ariaLabel="Download test results as CSV" onClick={handleDownload} />
            </SpaceBetween>
          }
        >
          Test Run Results ({filteredRows.length})
        </Header>
      }
      columnDefinitions={visibleColumns}
      items={filteredRows}
      selectedItems={selectedItems}
      onSelectionChange={({ detail }) => onSelectionChange(detail.selectedItems)}
      selectionType="single"
      trackBy="id"
      wrapLines={preferences.wrapLines}
      stripedRows={preferences.stripedRows}
      contentDensity={preferences.contentDensity}
      stickyColumns={preferences.stickyColumns}
      ariaLabels={{
        selectionGroupLabel: "Test results selection",
        itemSelectionLabel: ({ selectedItems }, item) =>
          `${item.testLabel} in ${item.region} is ${selectedItems.indexOf(item) < 0 ? "not " : ""}selected`,
      }}
      sortingDisabled={false}
      filter={
        <TextFilter
          filteringText={filteringText}
          filteringPlaceholder="Filter results"
          filteringAriaLabel="Filter results"
          onChange={({ detail }) => setFilteringText(detail.filteringText)}
        />
      }
      preferences={
        <TablePreferences
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          columnOptions={allColumns.map((col) => ({
            id: col.id,
            label: col.preferenceHeader || col.header,
            alwaysVisible: col.id === "run" || col.id === "testLabel",
          }))}
          preferences={preferences}
          onConfirm={setPreferences}
        />
      }
      empty={
        <div style={{ textAlign: "center", padding: "20px" }}>
          {filteringText ? "No test results match your search" : "No test results available"}
        </div>
      }
    />
  );
}
