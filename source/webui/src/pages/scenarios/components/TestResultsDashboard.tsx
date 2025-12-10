// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Box,
  ColumnLayout,
  Container,
  Header,
  SpaceBetween,
  StatusIndicator,
  Table
} from "@cloudscape-design/components";
import React, { useMemo } from 'react';
import { TableRow, TestRunDashboardProps, TestRunDetails } from "../types/testResults";
import { ViewMode } from "../types/viewMode";
import { aggregateEndpoints } from "../utils/testResultsTransformers";

interface DashboardMetrics {
  avgResponseTime: string;
  avgResponseTimeMs: number;
  avgLatency: string;
  avgLatencyMs: number;
  avgConnectionTime: string;
  avgConnectionTimeMs: number;
  avgBandwidth: string;
  avgBandwidthKbps: number;
  totalCount: number;
  successCount: number;
  errorCount: number;
  requestsPerSecond: string;
  requestsPerSecondNum: number;
  successRate: string;
  successRateNum: number;
  httpErrors: Array<{
    errorCode: string;
    errorCount: string;
    status: string;
    statusType: 'error' | 'success' | 'warning' | 'info' | 'in-progress' | 'stopped' | 'loading' | 'pending';
  }>;
  percentiles: Array<{
    percentile: string;
    responseTime: string;
  }>;
}

const sortHttpErrors = (a: { errorCode: string }, b: { errorCode: string }): number => {
  const codeA = parseInt(a.errorCode, 10);
  const codeB = parseInt(b.errorCode, 10);
  
  // Both are valid numbers - sort numerically
  if (!isNaN(codeA) && !isNaN(codeB)) {
    return codeA - codeB;
  }
  
  // If one is numeric and one isn't, numeric comes first
  if (!isNaN(codeA)) return -1;
  if (!isNaN(codeB)) return 1;
  
  // Both are non-numeric - sort alphabetically
  return a.errorCode.localeCompare(b.errorCode);
};

const formatTime = (timeInSeconds: string | number): string => {
  const time = typeof timeInSeconds === 'string' ? parseFloat(timeInSeconds) : timeInSeconds;
  if (time >= 1) {
    return `${time.toFixed(3)}s`;
  } else {
    const ms = time * 1000;
    if (ms > 0 && ms < 1) {
      return "<1ms";
    }
    return `${ms.toFixed(0)}ms`;
  }
};

const formatBandwidth = (bytes: string, duration: string): string => {
  const bytesNum = parseFloat(bytes);
  const durationNum = parseFloat(duration);
  if (durationNum > 0) {
    const kbps = (bytesNum / 1024) / durationNum;
    return `${kbps.toFixed(2)} KB/s`;
  }
  return "0 KB/s";
};

const calculateMetrics = (selectedRow: TableRow, testRunDetails: TestRunDetails, viewMode: ViewMode): DashboardMetrics => {
  const regionData = testRunDetails.results[selectedRow.region];
  
  // Handle Overall mode - aggregate all labels
  if (viewMode === ViewMode.Overall && regionData?.labels) {
    const testDuration = parseFloat(regionData.testDuration);
    const aggregated = aggregateEndpoints(regionData.labels, testDuration);
    
    // Collect all HTTP errors from all labels
    const allHttpErrors = new Map<string, number>();
    regionData.labels.forEach(label => {
      label.rc?.forEach(rc => {
        allHttpErrors.set(rc.code, (allHttpErrors.get(rc.code) || 0) + rc.count);
      });
    });
    
    const httpErrors = Array.from(allHttpErrors.entries())
      .map(([code, count]) => ({
        errorCode: code,
        errorCount: count.toString(),
        status: 'Error',
        statusType: 'error' as const
      }))
      .sort(sortHttpErrors);
    
    // Build percentiles from aggregated data
    const percentiles = [
      { percentile: '0%', responseTime: formatTime(aggregated.p0RespTime / 1000) },
      { percentile: '50%', responseTime: formatTime(aggregated.p50RespTime / 1000) },
      { percentile: '90%', responseTime: formatTime(aggregated.p90RespTime / 1000) },
      { percentile: '95%', responseTime: formatTime(aggregated.p95RespTime / 1000) },
      { percentile: '99%', responseTime: formatTime(aggregated.p99RespTime / 1000) },
      { percentile: '99.9%', responseTime: formatTime(aggregated.p99_9RespTime / 1000) },
      { percentile: '100%', responseTime: formatTime(aggregated.p100RespTime / 1000) }
    ];
    
    return {
      avgResponseTime: formatTime(aggregated.avgRespTime / 1000),
      avgResponseTimeMs: aggregated.avgRespTime,
      avgLatency: formatTime(aggregated.avgLatency / 1000),
      avgLatencyMs: aggregated.avgLatency,
      avgConnectionTime: formatTime(aggregated.avgConnectionTime / 1000),
      avgConnectionTimeMs: aggregated.avgConnectionTime,
      avgBandwidth: `${aggregated.avgBandwidth.toFixed(2)} KB/s`,
      avgBandwidthKbps: aggregated.avgBandwidth,
      totalCount: aggregated.requests,
      successCount: aggregated.success,
      errorCount: aggregated.errors,
      requestsPerSecond: aggregated.requestsPerSecond.toFixed(1),
      requestsPerSecondNum: aggregated.requestsPerSecond,
      successRate: `${aggregated.successRate.toFixed(1)}%`,
      successRateNum: aggregated.successRate,
      httpErrors,
      percentiles
    };
  }
  
  // Find the specific label data for the selected row
  const labelData = regionData.labels.find(label => label.label === selectedRow.testLabel)!;

  // Calculate HTTP errors from response codes
  const httpErrors = labelData.rc?.map(rc => ({
    errorCode: rc.code,
    errorCount: rc.count.toString(),
    status: 'Error',
    statusType: 'error' as const
  })).sort(sortHttpErrors) || [];

  // Build percentiles array
  const percentiles = [
    { percentile: '0%', responseTime: formatTime(labelData.p0_0) },
    { percentile: '50%', responseTime: formatTime(labelData.p50_0) },
    { percentile: '90%', responseTime: formatTime(labelData.p90_0) },
    { percentile: '95%', responseTime: formatTime(labelData.p95_0) },
    { percentile: '99%', responseTime: formatTime(labelData.p99_0) },
    { percentile: '99.9%', responseTime: formatTime(labelData.p99_9) },
    { percentile: '100%', responseTime: formatTime(labelData.p100_0) }
  ];

  const avgRtMs = parseFloat(labelData.avg_rt) * 1000;
  const avgLtMs = parseFloat(labelData.avg_lt) * 1000;
  const avgCtMs = parseFloat(labelData.avg_ct) * 1000;
  const bytesNum = parseFloat(labelData.bytes);
  const durationNum = parseFloat(regionData.testDuration);
  const kbps = durationNum > 0 ? (bytesNum / 1024) / durationNum : 0;
  const rps = durationNum > 0 ? labelData.throughput / durationNum : 0;
  const successRateNum = labelData.throughput > 0 ? (labelData.succ / labelData.throughput) * 100 : 0;

  return {
    avgResponseTime: formatTime(labelData.avg_rt),
    avgResponseTimeMs: avgRtMs,
    avgLatency: formatTime(labelData.avg_lt),
    avgLatencyMs: avgLtMs,
    avgConnectionTime: formatTime(labelData.avg_ct),
    avgConnectionTimeMs: avgCtMs,
    avgBandwidth: formatBandwidth(labelData.bytes, regionData.testDuration),
    avgBandwidthKbps: kbps,
    totalCount: labelData.throughput,
    successCount: labelData.succ,
    errorCount: labelData.fail,
    requestsPerSecond: rps.toFixed(1),
    requestsPerSecondNum: rps,
    successRate: `${successRateNum.toFixed(1)}%`,
    successRateNum: successRateNum,
    httpErrors,
    percentiles
  };
};

interface BaselineMetrics {
  successRateNum: number;
  avgResponseTimeMs: number;
  avgLatencyMs: number;
  avgConnectionTimeMs: number;
  requestsPerSecondNum: number;
  avgBandwidthKbps: number;
  totalCount: number;
  successCount: number;
  errorCount: number;
}

const calculateBaselineMetrics = (selectedRow: TableRow, baseline: any, viewMode: ViewMode): BaselineMetrics | null => {
  if (!baseline?.testRunDetails?.results) return null;

  const baselineRegionData = baseline.testRunDetails.results[selectedRow.region];
  
  // Handle Overall mode - aggregate all baseline labels
  if (viewMode === ViewMode.Overall && baselineRegionData?.labels) {
    const testDuration = parseFloat(baselineRegionData.testDuration);
    const aggregated = aggregateEndpoints(baselineRegionData.labels, testDuration);
    
    return {
      successRateNum: aggregated.successRate,
      avgResponseTimeMs: aggregated.avgRespTime,
      avgLatencyMs: aggregated.avgLatency,
      avgConnectionTimeMs: aggregated.avgConnectionTime,
      requestsPerSecondNum: aggregated.requestsPerSecond,
      avgBandwidthKbps: aggregated.avgBandwidth,
      totalCount: aggregated.requests,
      successCount: aggregated.success,
      errorCount: aggregated.errors
    };
  }
  
  const baselineLabelData = baselineRegionData?.labels?.find((label: any) => label.label === selectedRow.testLabel);
  
  if (!baselineLabelData) return null;

  const successRateNum = baselineLabelData.throughput > 0 ? 
    ((baselineLabelData.succ / baselineLabelData.throughput) * 100) : 0;
  const avgRtMs = parseFloat(baselineLabelData.avg_rt) * 1000;
  const avgLtMs = parseFloat(baselineLabelData.avg_lt) * 1000;
  const avgCtMs = parseFloat(baselineLabelData.avg_ct) * 1000;
  const durationNum = parseFloat(baselineRegionData.testDuration);
  const rps = durationNum > 0 ? baselineLabelData.throughput / durationNum : 0;
  const bytesNum = parseFloat(baselineLabelData.bytes);
  const kbps = durationNum > 0 ? (bytesNum / 1024) / durationNum : 0;

  return {
    successRateNum,
    avgResponseTimeMs: avgRtMs,
    avgLatencyMs: avgLtMs,
    avgConnectionTimeMs: avgCtMs,
    requestsPerSecondNum: rps,
    avgBandwidthKbps: kbps,
    totalCount: baselineLabelData.throughput,
    successCount: baselineLabelData.succ,
    errorCount: baselineLabelData.fail
  };
};

const formatPercentChange = (current: number, baseline: number, lowerIsBetter: boolean = false): React.ReactElement => {
  if (current === baseline) {
    return <StatusIndicator type="info">0.0%</StatusIndicator>;
  }
  
  const percentChange = ((current - baseline) / baseline) * 100;
  const isImproved = lowerIsBetter ? current < baseline : current > baseline;
  const statusType = isImproved ? 'success' : 'warning';
  
  return (
    <StatusIndicator type={statusType}>
      {percentChange > 0 ? '+' : ''}{percentChange.toFixed(1)}%
    </StatusIndicator>
  );
};

interface MetricDisplayProps {
  label: string;
  value: string | number;
  baselineValue?: string | number;
  percentChange?: React.ReactElement;
}

const MetricDisplay = ({ label, value, baselineValue, percentChange }: MetricDisplayProps) => (
  <div>
    <Box variant="awsui-key-label">{label}</Box>
    <Box fontSize="heading-l" fontWeight="bold">{value}</Box>
    {baselineValue !== undefined && (
      <Box variant="small" color="text-status-inactive">
        Baseline: {baselineValue}
      </Box>
    )}
    {percentChange && (
      <Box margin={{ top: 'xxs' }}>
        {percentChange}
      </Box>
    )}
  </div>
);

export function TestRunDashboard({ selectedRow, testRunDetails, baseline, viewMode }: TestRunDashboardProps) {
  const metrics = useMemo(() => {
    if (!selectedRow || !testRunDetails) return null;
    return calculateMetrics(selectedRow, testRunDetails, viewMode);
  }, [selectedRow, testRunDetails, viewMode]);

  const baselineMetrics = useMemo(() => {
    if (!selectedRow || !baseline) return null;
    return calculateBaselineMetrics(selectedRow, baseline, viewMode);
  }, [selectedRow, baseline, viewMode]);

  if (!selectedRow || !metrics) {
    return (
      <Container>
        <Box textAlign="center" padding="l">
          <SpaceBetween size="m">
            <StatusIndicator type="info">
              Select a test result row to view detailed metrics
            </StatusIndicator>
          </SpaceBetween>
        </Box>
      </Container>
    );
  }

  return (
    <SpaceBetween size="l">
      <Header
        description={
          viewMode === ViewMode.Overall
            ? "Overall performance metrics across all endpoints"
            : `Performance metrics for ${selectedRow.testLabel} in ${selectedRow.region}`
        }
        variant="h2"
      >
        Test Run Metrics Dashboard
      </Header>

      {/* Volume Metrics */}
      <Container header={<Header variant="h3">Volume Metrics</Header>}>
        <ColumnLayout columns={4} variant="text-grid">
          <MetricDisplay
            label="Total Requests"
            value={metrics.totalCount.toLocaleString()}
            baselineValue={baselineMetrics ? baselineMetrics.totalCount.toLocaleString() : undefined}
            percentChange={baselineMetrics ? formatPercentChange(metrics.totalCount, baselineMetrics.totalCount) : undefined}
          />
          <MetricDisplay
            label="Success Count"
            value={metrics.successCount.toLocaleString()}
            baselineValue={baselineMetrics ? baselineMetrics.successCount.toLocaleString() : undefined}
            percentChange={baselineMetrics ? formatPercentChange(metrics.successCount, baselineMetrics.successCount) : undefined}
          />
          <MetricDisplay
            label="Error Count"
            value={metrics.errorCount.toLocaleString()}
            baselineValue={baselineMetrics ? baselineMetrics.errorCount.toLocaleString() : undefined}
            percentChange={baselineMetrics ? formatPercentChange(metrics.errorCount, baselineMetrics.errorCount, true) : undefined}
          />
          <MetricDisplay
            label="Success Rate"
            value={metrics.successRate}
            baselineValue={baselineMetrics ? `${baselineMetrics.successRateNum.toFixed(1)}%` : undefined}
            percentChange={baselineMetrics ? formatPercentChange(metrics.successRateNum, baselineMetrics.successRateNum) : undefined}
          />
        </ColumnLayout>
      </Container>

      {/* Performance Metrics */}
      <Container header={<Header variant="h3">Performance Metrics</Header>}>
        <ColumnLayout columns={3} variant="text-grid">
          <MetricDisplay
            label="Avg Response Time"
            value={metrics.avgResponseTime}
            baselineValue={baselineMetrics ? formatTime(baselineMetrics.avgResponseTimeMs / 1000) : undefined}
            percentChange={baselineMetrics ? formatPercentChange(metrics.avgResponseTimeMs, baselineMetrics.avgResponseTimeMs, true) : undefined}
          />
          <MetricDisplay
            label="Avg Latency"
            value={metrics.avgLatency}
            baselineValue={baselineMetrics ? formatTime(baselineMetrics.avgLatencyMs / 1000) : undefined}
            percentChange={baselineMetrics ? formatPercentChange(metrics.avgLatencyMs, baselineMetrics.avgLatencyMs, true) : undefined}
          />
          <MetricDisplay
            label="Avg Connection Time"
            value={metrics.avgConnectionTime}
            baselineValue={baselineMetrics ? formatTime(baselineMetrics.avgConnectionTimeMs / 1000) : undefined}
            percentChange={baselineMetrics ? formatPercentChange(metrics.avgConnectionTimeMs, baselineMetrics.avgConnectionTimeMs, true) : undefined}
          />
        </ColumnLayout>
      </Container>

      {/* Throughput Metrics */}
      <Container header={<Header variant="h3">Throughput Metrics</Header>}>
        <ColumnLayout columns={2} variant="text-grid">
          <MetricDisplay
            label="Requests Per Second"
            value={metrics.requestsPerSecond}
            baselineValue={baselineMetrics ? baselineMetrics.requestsPerSecondNum.toFixed(1) : undefined}
            percentChange={baselineMetrics ? formatPercentChange(metrics.requestsPerSecondNum, baselineMetrics.requestsPerSecondNum) : undefined}
          />
          <MetricDisplay
            label="Avg Bandwidth"
            value={metrics.avgBandwidth}
            baselineValue={baselineMetrics ? `${baselineMetrics.avgBandwidthKbps.toFixed(2)} KB/s` : undefined}
            percentChange={baselineMetrics ? <StatusIndicator type="info">{((metrics.avgBandwidthKbps - baselineMetrics.avgBandwidthKbps) / baselineMetrics.avgBandwidthKbps * 100) > 0 ? '+' : ''}{(((metrics.avgBandwidthKbps - baselineMetrics.avgBandwidthKbps) / baselineMetrics.avgBandwidthKbps) * 100).toFixed(1)}%</StatusIndicator> : undefined}
          />
        </ColumnLayout>
      </Container>

      {/* Distribution Analysis */}
      <ColumnLayout columns={2} variant="text-grid">
        <Table
          columnDefinitions={[
            {
              cell: (item) => item.percentile,
              header: 'Percentile',
              id: 'percentile'
            },
            {
              cell: (item) => item.responseTime,
              header: 'Response Time',
              id: 'responseTime'
            }
          ]}
          empty={
            <Box textAlign="center" margin={{ vertical: 'xs' }}>
              <SpaceBetween size="m">
                <b>No percentile data available</b>
              </SpaceBetween>
            </Box>
          }
          header={<Header variant="h3" description="Response time distribution across percentiles">Percentile Response Time</Header>}
          items={metrics.percentiles}
          trackBy="percentile"
          variant="embedded"
        />

        <Table
          columnDefinitions={[
            {
              cell: (item) => item.errorCode,
              header: 'Error Code',
              id: 'errorCode'
            },
            {
              cell: (item) => item.errorCount,
              header: 'Count',
              id: 'errorCount'
            }
          ]}
          empty={
            <Box textAlign="center" margin={{ vertical: 'xs' }}>
              <SpaceBetween size="m">
                <StatusIndicator type="success">No errors</StatusIndicator>
              </SpaceBetween>
            </Box>
          }
          header={<Header variant="h3" description="Breakdown of HTTP errors by status code">HTTP Errors</Header>}
          items={metrics.httpErrors}
          trackBy="errorCode"
          variant="embedded"
        />
      </ColumnLayout>
    </SpaceBetween>
  );
}
