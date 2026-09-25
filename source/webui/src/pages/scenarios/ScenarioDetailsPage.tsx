// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Alert,
  Box,
  Button,
  ButtonDropdown,
  ContentLayout,
  Header,
  ProgressBar,
  SpaceBetween,
} from "@cloudscape-design/components";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import {
  useDeleteScenarioMutation,
  useGetScenarioDetailsQuery,
  useLazyGetTestRunsQuery,
  useRunScenarioMutation,
  useStopScenarioMutation,
} from "../../store/scenariosApiSlice";
import { addNotification } from "../../store/notificationsSlice";
import { ScenarioDetailsContent } from "./components/ScenarioDetailsContent";
import { DeleteScenarioModal } from "./components/DeleteScenarioModal";
import { PageLoadingState, PageErrorState } from "../../components/common";
import { getPollingInterval } from "./constants";
import {
  ACTIVE_RUN_STATUSES,
  isCancelableRunStatus,
  isTerminalRunStatus,
  TestStatus,
} from "@amzn/dlt-common/validation";
import "./ScenarioDetailsPage.css";
import { usePageLoadMetric } from "../../hooks/usePageLoadMetric";
import { sendConsoleMetric } from "../../utils/consoleMetrics";

export default function ScenarioDetailsPage() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteScenario] = useDeleteScenarioMutation();
  const { data: scenario, isLoading, error, refetch } = useGetScenarioDetailsQuery({ testId: testId! });
  usePageLoadMetric("ScenarioDetails", { dataReady: !isLoading && !error, testId });
  const [stopScenario, { isLoading: isStoppingScenario }] = useStopScenarioMutation();
  const [runScenario, { isLoading: isRunningScenario }] = useRunScenarioMutation();
  const [progress, setProgress] = useState(0);
  const [isAutoRefreshEnabled, setIsAutoRefreshEnabled] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [getLatestTestRun, { data: latestTestRunData }] = useLazyGetTestRunsQuery();
  const latestTestRun = latestTestRunData?.testRuns[0];
  const isLatestTestRunTerminal = isTerminalRunStatus(latestTestRun?.status ?? "");
  const [currentInterval, setCurrentInterval] = useState(5000);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks whether the user explicitly turned off auto-refresh via the dropdown.
  // Prevents the auto-enable effect from overriding the user's choice.
  const userDisabledRefresh = useRef(false);
  // Holds the latest status so the timer callback can read it without
  // the effect needing scenario?.status in its dependency array.
  const latestStatusRef = useRef<string>("");
  const latestRefreshSucceeded = useRef(true);

  // Keep latestStatusRef in sync with the scenario status
  useEffect(() => {
    latestStatusRef.current = scenario?.status ?? "";
  }, [scenario?.status]);

  // During an active test run, refresh both the scenario and its latest history row
  // so polling continues until that row reaches a terminal status.
  const refreshScenario = useCallback(
    async () => {
      latestRefreshSucceeded.current = false;
      const [scenarioResult, latestTestRunResult] = await Promise.all([
        refetch(),
        getLatestTestRun({ testId: testId!, limit: 1, latest: true }),
      ]);
      latestRefreshSucceeded.current = !scenarioResult.error && !latestTestRunResult.error;
    },
    [getLatestTestRun, refetch, testId],
  );

  // Handle refresh option selection
  const handleRefreshChange = ({ detail }: { detail: { id: string } }) => {
    const { id } = detail;
    
    // Clear any existing intervals
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }
    
    // Reset progress
    setProgress(0);
    
    // Update interval time and enable/disable auto-refresh
    if (id !== 'off') {
      const intervalMap: { [key: string]: number } = {
        '5s': 5000,
        '30s': 30000,
        '60s': 60000,
        '300s': 300000
      };
      
      const intervalTime = intervalMap[id];
      if (intervalTime) {
        userDisabledRefresh.current = false;
        setCurrentInterval(intervalTime);
        setIsAutoRefreshEnabled(true);
        setRefreshTrigger(prev => prev + 1);
      }
    } else {
      userDisabledRefresh.current = true;
      setIsAutoRefreshEnabled(false);
    }
  };

  // Keep refreshing until both the scenario and its latest history row finish.
  // Respects the user's explicit "Off" choice via userDisabledRefresh.
  useEffect(() => {
    const status = scenario?.status;
    if (status === undefined || isRefreshing || !latestRefreshSucceeded.current) return;
    if (ACTIVE_RUN_STATUSES.has(status)) {
      if (!userDisabledRefresh.current) {
        setIsAutoRefreshEnabled(true);
      }
    } else if (
      isTerminalRunStatus(status) &&
      isLatestTestRunTerminal
    ) {
      setIsAutoRefreshEnabled(enabled => {
        if (!enabled) return enabled;
        userDisabledRefresh.current = false;
        return false;
      });
    }
  }, [scenario?.status, isLatestTestRunTerminal, isRefreshing]);

  // Main effect to manage auto-refresh timer.
  // Does NOT depend on scenario?.status — the timer callback reads
  // latestStatusRef to compute the effective polling interval.
  useEffect(() => {
    // Clear any existing timer
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }
    
    // Start timer if auto-refresh is enabled
    if (isAutoRefreshEnabled) {
      setProgress(0);
      
      const effectiveInterval = getPollingInterval(latestStatusRef.current, currentInterval);
      
      // Update progress every 100ms
      const step = 100 / (effectiveInterval / 100);
      let currentProgress = 0;
      
      progressRef.current = setInterval(() => {
        currentProgress += step;
        
        if (currentProgress >= 100) {
          // Clear interval before refresh to prevent race conditions
          if (progressRef.current) {
            clearInterval(progressRef.current);
            progressRef.current = null;
          }
          
          // Perform refresh
          setIsRefreshing(true);
          refreshScenario().finally(() => {
            setIsRefreshing(false);
            // Trigger the effect to restart the timer for next cycle
            setRefreshTrigger(prev => prev + 1);
          });
        } else {
          setProgress(currentProgress);
        }
      }, 100);
    } else {
      // Reset progress when auto-refresh is disabled
      setProgress(0);
    }
    
    // Cleanup on unmount or when dependencies change
    return () => {
      if (progressRef.current) {
        clearInterval(progressRef.current);
        progressRef.current = null;
      }
    };
  }, [isAutoRefreshEnabled, currentInterval, refreshScenario, refreshTrigger]);


  const handleManualRefresh = async () => {
    // Prevent overlapping refreshes
    if (isRefreshing) return;
    
    // Clear any existing progress timer
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }
    
    setIsRefreshing(true);
    await refreshScenario();
    setIsRefreshing(false);
    
    // Reset progress and re-trigger the main effect to restart the timer
    // (matching the auto-refresh cycle). The effect only restarts the timer
    // when auto-refresh is enabled, so a manual refresh while Off stays Off.
    setProgress(0);
    setRefreshTrigger(prev => prev + 1);
  };

  // Refresh options for the dropdown
  const refreshOptions = [
    { id: 'off', text: 'Off' },
    { id: '5s', text: '5 seconds' },
    { id: '30s', text: '30 seconds' },
    { id: '60s', text: '60 seconds' },
    { id: '300s', text: '5 minutes' }
  ];

  const handleCopy = () => {
    if (scenario) {
      sendConsoleMetric("ButtonClick", { Page: "ScenarioDetails", Action: "CopyScenario", TestId: testId });
      navigate(`/scenarios/create?cloneFrom=${testId}`);
    }
  };

  const handleEdit = () => {
    if (scenario) {
      sendConsoleMetric("ButtonClick", { Page: "ScenarioDetails", Action: "EditScenario", TestId: testId });
      navigate(`/scenarios/${testId}/edit`);
    }
  };

  const handleCancel = async () => {
    if (scenario) {
      sendConsoleMetric("ButtonClick", { Page: "ScenarioDetails", Action: "CancelTestRun", TestId: testId });
      try {
        await stopScenario({ testId: scenario.testId }).unwrap();
      } catch (error: any) {
        setCancelError(error?.data?.message || error?.message || 'Failed to cancel scenario');
      }
    }
  };

  const handleRun = async () => {
    // Ignore re-clicks while a start is already in flight. Combined with the
    // button's disabled/loading state below this closes the double-fire window
    // between the click and the first render that reflects the pending state.
    if (isRunningScenario || (scenario && ACTIVE_RUN_STATUSES.has(scenario.status))) {
      return;
    }
    if (scenario) {
      sendConsoleMetric("ButtonClick", { Page: "ScenarioDetails", Action: "RunScenario", TestId: testId });
      try {
        await runScenario(scenario).unwrap();
      } catch (error: any) {
        if (scenario.testId && error?.status === 400 && error?.data?.message?.includes('INVALID_REQUEST_BODY: testName')) {
          // Handle legacy test scenarios with invalid test names - surface the specific backend
          // reason (which names the offending character) and prompt the user to update the name.
          const reason = error.data.message.replace('INVALID_REQUEST_BODY:', '').trim();
          setRunError(`${reason}. Please edit the scenario and change the name.`);
        } else {
          // Generic error handler
          setRunError(error?.data?.message || error?.message || 'Failed to run scenario');
        }
      }
    }
  };

  const handleDelete = async () => {
    if (scenario) {
      setIsDeleting(true);
      try {
        await deleteScenario(scenario.testId).unwrap();
        setShowDeleteModal(false);
        sendConsoleMetric("ButtonClick", { Page: "ScenarioDetails", Action: "DeleteScenario", TestId: testId });
        navigate("/scenarios");
      } catch (error: any) {
        dispatch(
          addNotification({
            id: `delete-error-${Date.now()}`,
            type: "error",
            content: `Failed to delete scenario: ${error?.data?.message || error?.message || "Unknown error"}`,
          }),
        );
      } finally {
        setIsDeleting(false);
      }
    }
  };

  if (isLoading) {
    return <PageLoadingState title="Scenario Details" />;
  }

  if (error) {
    // Check for 504 Gateway Timeout
    const isTimeoutError = 'status' in error && error.status === 504;

    if (isTimeoutError) {
      return (
        <PageErrorState
          title="Scenario Details"
          alertType="warning"
          message="Unable to load live test data. This can happen when tests are running a large number of tasks. The test is still running normally. Please wait until the test completes to view full details."
          actions={[
            { label: "Back to Scenarios", onClick: () => navigate("/scenarios") },
            { label: "Retry", onClick: refetch },
          ]}
        />
      );
    }

    // Generic error handling for other error types
    return (
      <PageErrorState
        title="Scenario Details"
        message="Failed to load scenario details"
        actions={[
          { label: "Back to Scenarios", onClick: () => navigate("/scenarios") },
          { label: "Retry", onClick: refetch },
        ]}
      />
    );
  }

  if (!scenario) {
    return (
      <PageErrorState
        title="Scenario Details"
        message="Scenario not found"
        actions={[{ label: "Back to Scenarios", onClick: () => navigate("/scenarios") }]}
      />
    );
  }

  // Pick the single status-driven action shown next to Copy/Delete:
  //  - already stopping -> disabled "Cancelling…"
  //  - cancelable in-flight run (queued/provisioning/running) -> Cancel
  //  - finishing but no longer cancelable (cleaning up / parsing results) -> disabled Cancel,
  //    matching the API's cancel guard so the UI never offers a cancel the API would reject
  //  - terminal/idle -> Edit
  const renderStatusActionButton = () => {
    if (scenario.status === TestStatus.CANCELLING) {
      return <Button disabled>Cancelling…</Button>;
    }
    if (isCancelableRunStatus(scenario.status)) {
      return (
        <Button data-cy="cancel-scenario-btn" onClick={handleCancel} loading={isStoppingScenario}>
          Cancel
        </Button>
      );
    }
    if (ACTIVE_RUN_STATUSES.has(scenario.status)) {
      return <Button disabled>Cancel</Button>;
    }
    return <Button onClick={handleEdit}>Edit Scenario</Button>;
  };

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <SpaceBetween direction="horizontal" size="xs">
                <Box>
                  <SpaceBetween direction="vertical" size="xxs">
                    <ButtonDropdown
                      mainAction={
                        {
                          iconName: "refresh",
                          ariaLabel: "Refresh now",
                          onClick: handleManualRefresh,
                          loading: isRefreshing
                        }
                      }
                      items={refreshOptions}
                      onItemClick={handleRefreshChange}
                      variant="normal"
                    >
                      Auto Refresh
                    </ButtonDropdown>
                    {isAutoRefreshEnabled && <ProgressBar status="in-progress" value={progress} />}
                  </SpaceBetween>
                </Box>
              </SpaceBetween>
              {renderStatusActionButton()}
              <Button onClick={handleCopy}>Copy Scenario</Button>
              <Button
                data-cy="details-delete-scenario-btn"
                onClick={() => setShowDeleteModal(true)}
                disabled={!isTerminalRunStatus(scenario.status)}
              >
                Delete Scenario
              </Button>
              <Button
                variant="primary"
                onClick={handleRun}
                loading={isRunningScenario}
                loadingText="Starting…"
                disabled={isRunningScenario || ACTIVE_RUN_STATUSES.has(scenario.status)}
              >
                Run Scenario
              </Button>
            </SpaceBetween>
          }
        >
          {scenario.testName}
        </Header>
      }
    >
      {cancelError && (
        <Alert type="error" dismissible onDismiss={() => setCancelError(null)}>
          Failed to cancel scenario: {cancelError}
        </Alert>
      )}
      {runError && (
        <Alert type="error" dismissible onDismiss={() => setRunError(null)}>
          Failed to run scenario: {runError}
        </Alert>
      )}
      <ScenarioDetailsContent
        scenario_definition={scenario}
        latestTestRun={latestTestRun}
      />

      <DeleteScenarioModal
        visible={showDeleteModal}
        scenarioName={scenario.testName}
        loading={isDeleting}
        onDismiss={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
      />
    </ContentLayout>
  );
}
