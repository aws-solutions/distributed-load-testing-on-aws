// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { StatusIndicator } from "@cloudscape-design/components";
import React from "react";
import { TableColumn } from "./types";

// Utility functions for test scenario form operations

export const getFileExtension = (testType: string): string => {
  switch (testType) {
    case "jmeter":
      return ".jmx";
    case "k6":
      return ".js";
    case "locust":
      return ".py";
    default:
      return "";
  }
};

// Baseline table utilities
// Threshold for determining neutral changes (currently 0 = exact match only)
// Future: This will be configurable per customer
const BASELINE_NEUTRAL_THRESHOLD = 0;

type MetricType = 'lower-is-better' | 'higher-is-better';
type StatusType = 'success' | 'warning' | 'info';

const calculateDelta = (
  currentValue: number | undefined,
  baselineValue: number | undefined
): { delta: number; deltaText: string } | null => {
  if (!baselineValue || !currentValue) return null;
  const delta = ((currentValue - baselineValue) / baselineValue) * 100;
  const deltaText = `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;
  return { delta, deltaText };
};

const getStatusType = (delta: number, metricType: MetricType): StatusType => {
  // Within threshold = neutral
  if (Math.abs(delta) <= BASELINE_NEUTRAL_THRESHOLD) {
    return 'info';
  }
  
  // Lower is better (response times, errors, etc.)
  if (metricType === 'lower-is-better') {
    return delta < 0 ? 'success' : 'warning';
  }
  
  // Higher is better (requests per second, success rate, etc.)
  return delta > 0 ? 'success' : 'warning';
};

// New function for baseline comparison column only (separate from value column)
export const createBaselineComparisonCell = (
  currentValue: number | undefined,
  baselineValue: number | undefined,
  metricType: MetricType,
  displayMode: 'actual' | 'percentage' = 'percentage',
  formatter?: (val: number) => string
) => {
  const deltaResult = calculateDelta(currentValue, baselineValue);
  if (!deltaResult) return '--';
  
  const statusType = getStatusType(deltaResult.delta, metricType);
  
  // Show either actual baseline value or percentage change
  if (displayMode === 'actual') {
    const formattedBaseline = baselineValue !== undefined 
      ? (formatter ? formatter(baselineValue) : baselineValue.toLocaleString())
      : '--';
    return React.createElement(StatusIndicator, { type: statusType }, formattedBaseline);
  } else {
    // Show percentage change (default)
    return React.createElement(StatusIndicator, { type: statusType }, deltaResult.deltaText);
  }
};

// Legacy function - kept for backward compatibility with combined cell display
export const createBaselineCellWithStatus = (
  formattedCurrent: string,
  currentValue: number | undefined,
  baselineValue: number | undefined,
  hasBaseline: boolean,
  metricType: MetricType,
  displayMode: 'actual' | 'percentage' = 'percentage'
) => {
  if (!hasBaseline) return formattedCurrent;
  
  const deltaResult = calculateDelta(currentValue, baselineValue);
  if (!deltaResult) return formattedCurrent;
  
  const statusType = getStatusType(deltaResult.delta, metricType);
  
  // Show either actual baseline value or percentage change
  if (displayMode === 'actual') {
    // Format baseline value the same way as current value
    const formattedBaseline = baselineValue !== undefined ? formattedCurrent.replace(/[\d,.-]+/, baselineValue.toLocaleString()) : '--';
    return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
      React.createElement("span", null, formattedCurrent),
      React.createElement(StatusIndicator, { type: statusType }, formattedBaseline)
    );
  } else {
    // Show percentage change (default)
    return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
      React.createElement("span", null, formattedCurrent),
      React.createElement(StatusIndicator, { type: statusType }, deltaResult.deltaText)
    );
  }
};

// Legacy function for backward compatibility
export const createBaselineCell = (
  formattedCurrent: string,
  currentValue: number | undefined,
  baselineValue: number | undefined,
  hasBaseline: boolean
) => {
  // Default to 'lower-is-better' for backward compatibility
  return createBaselineCellWithStatus(formattedCurrent, currentValue, baselineValue, hasBaseline, 'lower-is-better');
};

export const getBaselineDelta = (
  currentValue: number | undefined,
  baselineValue: number | undefined
): string => {
  const deltaResult = calculateDelta(currentValue, baselineValue);
  return deltaResult ? deltaResult.deltaText : "--";
};

export const getBaselineText = (baselineValue: number | undefined, formatter: (val: number) => string) => {
  return baselineValue ? "\u00A0".repeat(5) + `Baseline (${formatter(baselineValue)})` : "";
};

export const generateCSV = <T>(columns: TableColumn<T>[], data: T[], hasBaseline: boolean): string => {
  const expandedColumns = columns.flatMap(col => {
    if (!hasBaseline || !col.csvBaselineValue) {
      return [{ header: col.header.replace(/\u00A0.*$/, '').trim(), getValue: col.csvValue }];
    }
    const baseHeader = col.header.replace(/\u00A0.*$/, '').trim();
    return [
      { header: baseHeader, getValue: col.csvValue },
      { header: `${baseHeader} vs Baseline`, getValue: col.csvBaselineValue }
    ];
  });
  
  const headers = expandedColumns.map(col => `"${col.header}"`).join(',');
  const rows = data.map(item => 
    expandedColumns.map(col => `"${col.getValue(item).replace(/"/g, '""')}"`).join(',')
  );
  return [headers, ...rows].join('\n');
};

export const downloadCSV = (content: string, filename: string): void => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
};
