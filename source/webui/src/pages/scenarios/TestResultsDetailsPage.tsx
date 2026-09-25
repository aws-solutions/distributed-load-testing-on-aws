// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Alert,
  Box,
  Button,
  ContentLayout,
  Header,
  SpaceBetween,
  StatusIndicator,
  Tabs
} from "@cloudscape-design/components";
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useGetBaselineQuery,
  useGetScenarioDetailsQuery,
  useGetTestRunDetailsQuery,
} from "../../store/scenariosApiSlice";
import { useListAgentSpacesQuery } from "../../store/agentSpacesApiSlice";
import { useCreateInvestigationMutation } from "../../store/investigationsApiSlice";
import type { InvestigationPriority } from "../../models/investigation";
import { ScenarioMetadata } from "./components/ScenarioMetadata";
import { InvestigationPanel } from "./components/InvestigationPanel";
import { SendToAgentModal } from "./components/SendToAgentModal";
import { useInvestigationPolling } from "./hooks/useInvestigationPolling";
import { TestResultsArtifacts } from "./components/TestResultsArtifacts";
import { BaselineDisplayMode, TestResultsBaseline } from "./components/TestResultsBaseline";
import { PageLoadingState, PageErrorState } from "../../components/common";
import { useHelp } from "../../help";
import { TestRunDashboard } from "./components/TestResultsDashboard";
import { TestResultsErrors } from "./components/TestResultsErrors";
import { TestResultsTable } from "./components/TestResultsTable";
import { TableRow, TestRunDetails } from "./types/testResults";
import { ViewMode } from "./types/viewMode";
import { usePageLoadMetric } from "../../hooks/usePageLoadMetric";
import { InvestigationsTable } from "./components/InvestigationsTable";
import { extractErrorMessage } from "../../utils/errorUtils";
import { getStatusConfig } from "./constants";
import { formatToLocalTime } from "../../utils/dateUtils";
import { transformToTableRows } from "./utils/testResultsTransformers";

export default function TestRunDetailsPage() {
  const { testId, testRunId } = useParams<{ testId: string; testRunId: string }>();
  const navigate = useNavigate();
  const [selectedItems, setSelectedItems] = useState<TableRow[]>([]);
  const [activeTabId, setActiveTabId] = useState("results");
  const artifactsRef = useRef<HTMLDivElement>(null);
  const { openTopic } = useHelp();
  const [displayMode, setDisplayMode] = useState<BaselineDisplayMode>('percentage');
  // Overall is the default view so the dashboard has a row to chart as soon as the
  // run loads; TestResultsTable selects that single aggregate row for us.
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Overall);
  const { data: testRun, isLoading, error, refetch } = useGetTestRunDetailsQuery({
    testId: testId!,
    testRunId: testRunId!
  });
  // Only needed for the page title — the run itself does not carry the scenario name.
  const { data: scenario } = useGetScenarioDetailsQuery({ testId: testId! });
  const { data: baseline, isLoading: isBaselineLoading, error: baselineError } = useGetBaselineQuery({ 
    testId: testId! 
  });

  // Agent Spaces for the "Investigate w/ DevOps Agent" button
  const { data: agentSpaces, refetch: refetchAgentSpaces } = useListAgentSpacesQuery();
  const [createInvestigation, { isLoading: isCreatingInvestigation }] = useCreateInvestigationMutation();

  // Agent spaces are now served by the GET /agent-spaces backend endpoint
  const hasAgentSpaces = (agentSpaces ?? []).length > 0;

  // Single source of truth for the active investigation and its live status,
  // shared with InvestigationPanel through the RTK Query cache.
  const { activeInvestigation } = useInvestigationPolling(testId!, testRunId!);

  const [showSendModal, setShowSendModal] = useState(false);
  const [submitError, setSubmitError] = useState<string>("");

  const handleInvestigate = () => {
    // Refresh the agent spaces list so the dropdown reflects any spaces
    // added or removed since this page was loaded.
    refetchAgentSpaces();
    setSubmitError("");
    setShowSendModal(true);
  };

  const handleDismissSendModal = () => {
    setSubmitError("");
    setShowSendModal(false);
  };

  const handleSendToAgent = async (agentSpaceId: string, additionalContext: string, priority: InvestigationPriority) => {
    setSubmitError("");
    try {
      await createInvestigation({
        testId: testId!,
        testRunId: testRunId!,
        body: { agentSpaceId, additionalContext: additionalContext || undefined, priority },
      }).unwrap();
      setShowSendModal(false);
    } catch (err) {
      // Surface the failure to the user (e.g. sensitive-data rejection, throttling)
      // instead of silently leaving the modal open with no feedback.
      setSubmitError(extractErrorMessage(err));
    }
  };
  // extra is only emitted in PageDataReady (not PageInitialLoad), so
  // BaselineEnabled reflects the actual loaded baseline state.
  usePageLoadMetric("TestRunDetails", {
    dataReady: !isLoading && !isBaselineLoading && !error && !baselineError,
    testId,
    extra: { BaselineEnabled: baseline?.baselineId ? "true" : "false" },
  });

  const handleBackToScenario = () => {
    navigate(`/scenarios/${testId}`);
  };

  // Overall yields a single aggregate row, so treat it as selected by default rather
  // than making the user click it. Derived instead of seeded into selectedItems so it
  // survives the run data arriving after first render, and so clearing the selection
  // in Overall cannot leave the dashboard empty.
  const overallRow = useMemo(
    () => (testRun && viewMode === ViewMode.Overall ? transformToTableRows(testRun, viewMode)[0] : undefined),
    [testRun, viewMode]
  );
  const selectedRow = selectedItems[0] ?? overallRow ?? null;
  const frameworkExitSummary = testRun?.frameworkExitSummary;
  const hasUndisplayedFrameworkFailures =
    frameworkExitSummary &&
    frameworkExitSummary.top.reduce((total, entry) => total + entry.count, 0) < frameworkExitSummary.totalCount;

  if (isLoading) {
    return <PageLoadingState title="Test Run Details" message="Loading test run details..." />;
  }

  if (error) {
    return (
      <PageErrorState
        title="Test Run Details"
        message="Failed to load test run details"
        actions={[
          { label: "Back to Scenario", onClick: handleBackToScenario },
          { label: "Retry", onClick: refetch },
        ]}
      />
    );
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={<TestRunHeaderDescription testRun={testRun} />}
          actions={
            <Button
              variant="primary"
              iconName="gen-ai"
              onClick={handleInvestigate}
              disabled={!hasAgentSpaces || !!activeInvestigation}
              loading={isCreatingInvestigation}
            >
              Investigate w/ DevOps Agent
            </Button>
          }
        >
          {scenario?.testName ?? "Test Run Details"}
        </Header>
      }
    >
      {testRun && (
        <SpaceBetween size="l">
          {testRun.status === "failed" && testRun.errorReason && (
            <Alert type="error" header="This test run did not complete successfully">
              <SpaceBetween size="xs">
                <Box variant="p">{testRun.errorReason}</Box>
                <Box variant="p">
                  Partial results may still be available below if the test was running before the failure occurred.
                </Box>
              </SpaceBetween>
            </Alert>
          )}

          {(testRun.status === "complete" || testRun.status === "failed") && frameworkExitSummary && (
            <Alert
              type="warning"
              action={
                <Button
                  onClick={() => {
                    setActiveTabId("artifacts");
                    requestAnimationFrame(() =>
                      artifactsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
                    );
                  }}
                >
                  View full report
                </Button>
              }
            >
              <SpaceBetween size="xs">
                <Box fontWeight="bold">
                  {frameworkExitSummary.top[0].framework} reported errors in {frameworkExitSummary.totalCount} task
                  {frameworkExitSummary.totalCount === 1 ? "" : "s"}
                </Box>
                {hasUndisplayedFrameworkFailures && <Box>Most Common Failures</Box>}
                <SpaceBetween size="s">
                  {frameworkExitSummary.top.map((entry) => (
                    <SpaceBetween key={`${entry.exitCode}-${entry.message}`} size="xxs">
                      <Box>
                        <strong>
                          {entry.count} {entry.count === 1 ? "task" : "tasks"}
                        </strong>{" "}
                        · Exit Code <code>{entry.exitCode}</code>
                      </Box>
                      <Box variant="code">
                        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: "12px" }}>
                          {entry.message}
                        </pre>
                      </Box>
                    </SpaceBetween>
                  ))}
                </SpaceBetween>
              </SpaceBetween>
            </Alert>
          )}

          <ScenarioMetadata testRun={testRun} testId={testId!} testRunId={testRunId!} />

          <InvestigationPanel testId={testId!} testRunId={testRunId!} />

          <Tabs
            activeTabId={activeTabId}
            onChange={({ detail }) => {
              setActiveTabId(detail.activeTabId);
              // Open the help panel on the active tab's topic so switching tabs
              // surfaces the matching contextual help.
              openTopic(detail.activeTabId);
            }}
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
                      selectedItems={selectedRow ? [selectedRow] : []}
                      onSelectionChange={setSelectedItems}
                      displayMode={displayMode}
                      viewMode={viewMode}
                      onViewModeChange={setViewMode}
                    />

                    <TestRunDashboard
                      selectedRow={selectedRow}
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
                  <div ref={artifactsRef}>
                    <TestResultsArtifacts testRunDetails={testRun} testId={testId!} />
                  </div>
                )
              },
              {
                label: "Investigations",
                id: "investigations",
                content: (
                  <InvestigationsTable testId={testId!} testRunId={testRunId!} />
                )
              }
            ]}
          />
        </SpaceBetween>
      )}

      {testRun && (
        <SendToAgentModal
          visible={showSendModal}
          onDismiss={handleDismissSendModal}
          onSubmit={handleSendToAgent}
          isSubmitting={isCreatingInvestigation}
          testRun={testRun}
          agentSpaces={agentSpaces ?? []}
          baseline={baseline}
          errorMessage={submitError}
        />
      )}
    </ContentLayout>
  );
}

/**
 * Sub-title for the page header: when this run started and how it ended. Rendered
 * inline so the run's outcome is visible without scrolling to Run Overview.
 */
function TestRunHeaderDescription({ testRun }: { readonly testRun: TestRunDetails | undefined }) {
  if (!testRun) {
    return null;
  }

  const startedAt = formatToLocalTime(testRun.startTime, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
  const status = getStatusConfig(testRun.status);

  return (
    <SpaceBetween size="xs" direction="horizontal" alignItems="center">
      <Box variant="span" color="text-body-secondary">
        Started {startedAt}
      </Box>
      <StatusIndicator type={status.type}>{status.label}</StatusIndicator>
    </SpaceBetween>
  );
}
