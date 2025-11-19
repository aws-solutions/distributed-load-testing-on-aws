// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { TableRow } from "./testResults";

export enum ViewMode {
    Overall = 'overall',
    ByEndpoint = 'byEndpoint',
    ByRegion = 'byRegion',
}

export interface AggregateMetrics {
  requests: number;
  success: number;
  successRate: number;
  avgRespTime: number;
  p95RespTime: number;
  // Additional metrics
  errors: number;
  requestsPerSecond: number;
  avgLatency: number;
  avgConnectionTime: number;
  avgBandwidth: number;
  // Additional percentiles
  p0RespTime: number;
  p50RespTime: number;
  p90RespTime: number;
  p99RespTime: number;
  p99_9RespTime: number;
  p100RespTime: number;
}

export interface BaselineComparison {
  requests: number;
  success: number;
  successRate: number;
  avgRespTime: number;
  p95RespTime: number;
  // Additional metrics
  errors: number;
  requestsPerSecond: number;
  avgLatency: number;
  avgConnectionTime: number;
  avgBandwidth: number;
  // Additional percentiles
  p0RespTime: number;
  p50RespTime: number;
  p90RespTime: number;
  p99RespTime: number;
  p99_9RespTime: number;
  p100RespTime: number;
}

export interface ProcessedTableData {
  rows: TableRow[];
  baselineComparisons: Map<string, BaselineComparison | undefined>;
  aggregatedBaseline: AggregateMetrics | null;
}
