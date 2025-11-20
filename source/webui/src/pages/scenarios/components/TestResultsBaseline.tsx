// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Alert,
  Button,
  ColumnLayout,
  Container,
  Header,
  KeyValuePairs,
  Link,
  SegmentedControl,
  SpaceBetween,
  StatusIndicator
} from "@cloudscape-design/components";
import { useNavigate } from "react-router-dom";
import { useGetBaselineQuery, useRemoveTestRunBaselineMutation } from "../../../store/scenariosApiSlice";

export type BaselineDisplayMode = 'actual' | 'percentage';

interface TestResultsBaselineProps {
  testId: string;
  displayMode: BaselineDisplayMode;
  onDisplayModeChange: (mode: BaselineDisplayMode) => void;
}

export function TestResultsBaseline({ testId, displayMode, onDisplayModeChange }: TestResultsBaselineProps) {
  const navigate = useNavigate();
  const { data: baseline, isLoading, error } = useGetBaselineQuery({ testId });
  const [removeBaseline, { isLoading: isRemoving }] = useRemoveTestRunBaselineMutation();

  const handleRemoveBaseline = async () => {
    try {
      await removeBaseline({ testId }).unwrap();
    } catch (error) {
      console.error('Failed to remove baseline:', error);
    }
  };

  const handleViewTestRun = () => {
    if (baseline?.baselineId) {
      navigate(`/scenarios/${testId}/testruns/${baseline.baselineId}`);
    }
  };

  const formatMetrics = (results: any) => {
    if (!results?.total) return null;

    const total = results.total;
    const requests = parseInt(total.throughput) || 0;
    const success = parseInt(total.succ) || 0;
    const errors = parseInt(total.fail) || 0;
    const successRate = requests > 0 ? ((success / requests) * 100).toFixed(1) : '0.0';
    const avgResponseTime = parseFloat(total.avg_rt) ? (parseFloat(total.avg_rt) * 1000).toFixed(0) : '0';
    const p95ResponseTime = parseFloat(total.p95_0) ? (parseFloat(total.p95_0) * 1000).toFixed(0) : '0';

    return {
      requests,
      success,
      errors,
      successRate,
      avgResponseTime,
      p95ResponseTime
    };
  };

  if (isLoading) {
    return (
      <Container
        header={
          <Header variant="h2" description="Baseline test run for performance comparison">
            Baseline
          </Header>
        }
      >
        <StatusIndicator type="loading">Loading baseline information...</StatusIndicator>
      </Container>
    );
  }

  if (error) {
    return (
      <Container
        header={
          <Header variant="h2" description="Baseline test run for performance comparison">
            Baseline
          </Header>
        }
      >
        <Alert type="error">Failed to load baseline information</Alert>
      </Container>
    );
  }

  // No baseline set
  if (!baseline?.baselineId) {
    return (
      <Container
        header={
          <Header 
            variant="h2"
            description="Set a baseline test run to compare performance against future test runs"
          >
            Baseline
          </Header>
        }
      >
        <SpaceBetween size="m">
          <Alert type="info">
            No baseline has been set for this test scenario. Select a test run from the history to set as your performance baseline.
          </Alert>
        </SpaceBetween>
      </Container>
    );
  }

  // Baseline exists
  const testRunDetails = baseline.testRunDetails;
  const metrics = testRunDetails?.results ? formatMetrics(testRunDetails.results) : null;

  return (
    <Container
      header={
        <Header 
          variant="h2"
          description="Baseline test run for performance comparison"
          actions={
            <SpaceBetween direction="horizontal" size="s">
              <SegmentedControl
                selectedId={displayMode}
                onChange={({ detail }) => onDisplayModeChange(detail.selectedId as BaselineDisplayMode)}
                options={[
                  { text: "Show Actual", id: "actual" },
                  { text: "Show Percentage", id: "percentage" },
                ]}
              />
              <Button 
                variant="normal" 
                onClick={handleRemoveBaseline}
                loading={isRemoving}
              >
                Remove Baseline
              </Button>
            </SpaceBetween>
          }
        >
          Baseline
        </Header>
      }
    >
      <SpaceBetween size="l">
        {baseline.warning && (
          <Alert type="warning">{baseline.warning}</Alert>
        )}
        
        <ColumnLayout borders="vertical" columns={2}>
          <KeyValuePairs
            items={[
              {
                label: "Test Run",
                type: "pair",
                value: (
                  <Link 
                    onFollow={handleViewTestRun}
                    external={false}
                  >
                    {baseline.baselineId}
                  </Link>
                )
              },
              {
                label: "Date",
                type: "pair",
                value: testRunDetails?.startTime 
                  ? new Date(testRunDetails.startTime).toLocaleString()
                  : 'Unknown'
              },
              {
                label: "Status",
                type: "pair",
                value: testRunDetails?.status || 'Unknown'
              }
            ]}
          />
          
          {metrics && (
            <KeyValuePairs
              items={[
                {
                  label: "Total Requests",
                  type: "pair",
                  value: metrics.requests.toLocaleString()
                },
                {
                  label: "Success Rate",
                  type: "pair",
                  value: `${metrics.successRate}%`
                },
                {
                  label: "Avg Response Time",
                  type: "pair",
                  value: `${metrics.avgResponseTime}ms`
                }
              ]}
            />
          )}
        </ColumnLayout>
      </SpaceBetween>
    </Container>
  );
}
