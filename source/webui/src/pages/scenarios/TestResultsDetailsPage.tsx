// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Alert,
  Button,
  ContentLayout,
  Header,
  SpaceBetween,
  StatusIndicator,
  Tabs
} from "@cloudscape-design/components";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useGetBaselineQuery, useGetTestRunDetailsQuery } from "../../store/scenariosApiSlice";
import { ScenarioMetadata } from "./components/ScenarioMetadata";
import { TestResultsArtifacts } from "./components/TestResultsArtifacts";
import { BaselineDisplayMode, TestResultsBaseline } from "./components/TestResultsBaseline";
import { TestRunDashboard } from "./components/TestResultsDashboard";
import { TestResultsErrors } from "./components/TestResultsErrors";
import { TestResultsTable } from "./components/TestResultsTable";
import { TableRow } from "./types/testResults";
import { ViewMode } from "./types/viewMode";

export default function TestRunDetailsPage() {
  const { testId, testRunId } = useParams<{ testId: string; testRunId: string }>();
  const navigate = useNavigate();
  const [selectedItems, setSelectedItems] = useState<TableRow[]>([]);
  const [activeTabId, setActiveTabId] = useState("results");
  const [displayMode, setDisplayMode] = useState<BaselineDisplayMode>('percentage');
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.ByEndpoint);
  const { data: testRun, isLoading, error } = useGetTestRunDetailsQuery({ 
    testId: testId!, 
    testRunId: testRunId! 
  });
  const { data: baseline } = useGetBaselineQuery({ 
    testId: testId! 
  });

  const handleBackToScenario = () => {
    navigate(`/scenarios/${testId}`);
  };

  if (isLoading) {
    return (
      <ContentLayout header={<Header variant="h1">Test Run Details</Header>}>
        <StatusIndicator type="loading">Loading test run details...</StatusIndicator>
      </ContentLayout>
    );
  }

  if (error) {
    return (
      <ContentLayout header={<Header variant="h1">Test Run Details</Header>}>
        <SpaceBetween size="m">
          <Alert type="error">Failed to load test run details</Alert>
          <Button onClick={handleBackToScenario}>Back to Scenario</Button>
        </SpaceBetween>
      </ContentLayout>
    );
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <Button onClick={handleBackToScenario}>Back to Scenario</Button>
          }
        >
          Test Run Details
        </Header>
      }
    >
      {testRun && (
        <SpaceBetween size="l">
          <ScenarioMetadata testRun={testRun} testId={testId!} testRunId={testRunId!} />

          <Tabs
            activeTabId={activeTabId}
            onChange={({ detail }) => setActiveTabId(detail.activeTabId)}
            tabs={[
              {
                label: "Test Run Results",
                id: "results",
                content: (
                  <SpaceBetween size="l">
                    <TestResultsBaseline 
                      testId={testId!} 
                      displayMode={displayMode}
                      onDisplayModeChange={setDisplayMode}
                    />

                    <TestResultsTable
                      testRun={testRun}
                      baseline={baseline}
                      selectedItems={selectedItems}
                      onSelectionChange={setSelectedItems}
                      displayMode={displayMode}
                      viewMode={viewMode}
                      onViewModeChange={setViewMode}
                    />
                    
                    <TestRunDashboard 
                      selectedRow={selectedItems.length > 0 ? selectedItems[0] : null}
                      testRunDetails={testRun}
                      baseline={baseline}
                      viewMode={viewMode}
                    />
                  </SpaceBetween>
                )
              },
              {
                label: "Errors",
                id: "errors",
                content: (
                  <TestResultsErrors testRunDetails={testRun} />
                )
              },
              {
                label: "Artifacts",
                id: "artifacts",
                content: (
                  <TestResultsArtifacts testRunDetails={testRun} testId={testId!} />
                )
              }
            ]}
          />
        </SpaceBetween>
      )}
    </ContentLayout>
  );
}
