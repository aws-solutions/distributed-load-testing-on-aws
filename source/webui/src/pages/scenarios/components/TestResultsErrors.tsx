// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Box,
  Container,
  Header,
  Multiselect,
  MultiselectProps,
  SegmentedControl,
  SpaceBetween,
  StatusIndicator,
  Table
} from "@cloudscape-design/components";
import { useMemo, useState } from 'react';
import { TestRunDetails } from "../types/testResults";

enum ViewMode {
  Overall = "overall",
  ByEndpoint = "byEndpoint"
}

enum ErrorType {
  All = "all",
  ClientErrors = "4xx",
  ServerErrors = "5xx"
}

interface TestResultsErrorsProps {
  readonly testRunDetails: TestRunDetails | null;
}

interface ErrorRow {
  id: string;
  region: string;
  testLabel: string;
  errorCode: string;
  errorCount: number;
}

const processErrorData = (testRunDetails: TestRunDetails): ErrorRow[] => {
  const errors: ErrorRow[] = [];

  // Only process results where region is "total"
  const totalResults = testRunDetails.results["total"];
  if (!totalResults) return errors;

  // Process overall total errors
  if (totalResults.rc && totalResults.rc.length > 0) {
    for (const responseCode of totalResults.rc) {
      errors.push({
        id: `total-overall-${responseCode.code}`,
        region: "total",
        testLabel: "Overall",
        errorCode: responseCode.code,
        errorCount: responseCode.count
      });
    }
  }

  // Process label-specific errors from total
  if (totalResults.labels) {
    for (const label of totalResults.labels) {
      if (label.rc && label.rc.length > 0) {
        for (const responseCode of label.rc) {
          errors.push({
            id: `total-${label.label}-${responseCode.code}`,
            region: "total",
            testLabel: label.label,
            errorCode: responseCode.code,
            errorCount: responseCode.count
          });
        }
      }
    }
  }

  return errors;
};

export function TestResultsErrors({ testRunDetails }: TestResultsErrorsProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Overall);
  const [errorType, setErrorType] = useState<ErrorType>(ErrorType.All);
  const [selectedEndpoints, setSelectedEndpoints] = useState<readonly MultiselectProps.Option[]>([]);
  const [sortingColumn, setSortingColumn] = useState<string>("errorCode");
  const [sortingDescending, setSortingDescending] = useState(false);

  const errors = useMemo(() => {
    if (!testRunDetails) return [];
    return processErrorData(testRunDetails);
  }, [testRunDetails]);

  // Extract unique endpoints (excluding "Overall")
  const endpointOptions = useMemo(() => {
    const uniqueEndpoints = new Set<string>();
    errors.forEach(error => {
      if (error.testLabel !== "Overall") {
        uniqueEndpoints.add(error.testLabel);
      }
    });
    return Array.from(uniqueEndpoints)
      .sort()
      .map(endpoint => ({
        label: endpoint,
        value: endpoint
      }));
  }, [errors]);

  const filteredErrors = useMemo(() => {
    return errors.filter(error => {
      // Filter by view mode
      if (viewMode === ViewMode.Overall && error.testLabel !== "Overall") return false;
      if (viewMode === ViewMode.ByEndpoint && error.testLabel === "Overall") return false;

      // Filter by selected endpoints (only in By Endpoint view)
      if (viewMode === ViewMode.ByEndpoint && selectedEndpoints.length > 0) {
        const selectedEndpointValues = selectedEndpoints.map(opt => opt.value);
        if (!selectedEndpointValues.includes(error.testLabel)) return false;
      }

      // Filter by error type
      const code = Number.parseInt(error.errorCode, 10);
      if (errorType === ErrorType.ClientErrors && (code < 400 || code >= 500)) return false;
      if (errorType === ErrorType.ServerErrors && (code < 500 || code >= 600)) return false;

      return true;
    });
  }, [errors, viewMode, errorType, selectedEndpoints]);

  // Update sorting when view mode changes
  useMemo(() => {
    if (viewMode === ViewMode.Overall) {
      setSortingColumn("errorCode");
      setSortingDescending(false);
    } else {
      setSortingColumn("testLabel");
      setSortingDescending(false);
    }
  }, [viewMode]);

  // Sort the filtered errors
  const sortedErrors = useMemo(() => {
    const sorted = [...filteredErrors].sort((a, b) => {
      let comparison = 0;
      
      if (sortingColumn === "testLabel") {
        comparison = a.testLabel.localeCompare(b.testLabel);
        // Secondary sort by error code for by endpoint view
        if (comparison === 0 && viewMode === ViewMode.ByEndpoint) {
          comparison = Number.parseInt(a.errorCode, 10) - Number.parseInt(b.errorCode, 10);
        }
      } else if (sortingColumn === "errorCode") {
        comparison = Number.parseInt(a.errorCode, 10) - Number.parseInt(b.errorCode, 10);
      } else if (sortingColumn === "errorCount") {
        comparison = a.errorCount - b.errorCount;
      }
      
      return sortingDescending ? -comparison : comparison;
    });
    
    return sorted;
  }, [filteredErrors, sortingColumn, sortingDescending, viewMode]);

  if (!testRunDetails) {
    return (
      <Container>
        <Box textAlign="center" padding="l">
          <StatusIndicator type="info">
            No test run data available
          </StatusIndicator>
        </Box>
      </Container>
    );
  }

  if (errors.length === 0) {
    return (
      <Container>
        <Box textAlign="center" padding="l">
          <SpaceBetween size="m">
            <StatusIndicator type="success">
              No errors found in this test run
            </StatusIndicator>
          </SpaceBetween>
        </Box>
      </Container>
    );
  }

  return (
    <SpaceBetween size="m">
      <Header
        counter={`(${sortedErrors.length})`}
        description="Total errors across all regions"
      >
        HTTP Errors
      </Header>
      <SpaceBetween direction="horizontal" size="l">
        <SegmentedControl
          selectedId={errorType}
          onChange={({ detail }) => setErrorType(detail.selectedId as ErrorType)}
          options={[
            { text: "All Errors", id: ErrorType.All },
            { text: "Client Errors (4xx)", id: ErrorType.ClientErrors },
            { text: "Server Errors (5xx)", id: ErrorType.ServerErrors }
          ]}
        />
        <SegmentedControl
          selectedId={viewMode}
          onChange={({ detail }) => setViewMode(detail.selectedId as ViewMode)}
          options={[
            { text: "Overall", id: ViewMode.Overall },
            { text: "By Endpoint", id: ViewMode.ByEndpoint }
          ]}
        />
      </SpaceBetween>
      {viewMode === ViewMode.ByEndpoint && endpointOptions.length > 0 && (
        <Multiselect
          selectedOptions={selectedEndpoints}
          onChange={({ detail }) => setSelectedEndpoints(detail.selectedOptions)}
          options={endpointOptions}
          placeholder="Filter by endpoints"
          filteringType="auto"
          tokenLimit={3}
        />
      )}
      <Table
        columnDefinitions={[
          {
            id: "testLabel",
            header: "Test Label",
            cell: (item) => item.testLabel,
            sortingField: "testLabel"
          },
          {
            id: "errorCode",
            header: "Error Code",
            cell: (item) => item.errorCode,
            sortingField: "errorCode"
          },
          {
            id: "errorCount",
            header: "Count",
            cell: (item) => item.errorCount.toLocaleString(),
            sortingField: "errorCount"
          }
        ]}
        items={sortedErrors}
        loadingText="Loading errors..."
        sortingDisabled={false}
        sortingColumn={{ sortingField: sortingColumn }}
        sortingDescending={sortingDescending}
        onSortingChange={({ detail }) => {
          setSortingColumn(detail.sortingColumn.sortingField || "errorCode");
          setSortingDescending(detail.isDescending || false);
        }}
        empty={
          <Box textAlign="center" margin={{ vertical: 'xs' }}>
            <SpaceBetween size="m">
              <StatusIndicator type="success">No errors</StatusIndicator>
            </SpaceBetween>
          </Box>
        }
      />
    </SpaceBetween>
  );
}
