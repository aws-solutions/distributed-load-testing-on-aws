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
  StatusIndicator,
} from "@cloudscape-design/components";
import { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import {
  useDeleteScenarioMutation,
  useGetScenarioDetailsQuery,
  useRunScenarioMutation,
  useStopScenarioMutation,
} from "../../store/scenariosApiSlice";
import { addNotification } from "../../store/notificationsSlice";
import { ScenarioDetailsContent } from "./components/ScenarioDetailsContent";
import { DeleteScenarioModal } from "./components/DeleteScenarioModal";
import { ACTIVE_TEST_STATES, TestStatus, getPollingInterval, isTerminalState } from "./constants";
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
  const [currentInterval, setCurrentInterval] = useState(5000);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks whether the user explicitly turned off auto-refresh via the dropdown.
  // Prevents the auto-enable effect from overriding the user's choice.
  const userDisabledRefresh = useRef(false);
  // Holds the latest status so the timer callback can read it without
  // the effect needing scenario?.status in its dependency array.
  const latestStatusRef = useRef<string>("");

  // Keep latestStatusRef in sync with the scenario status
  useEffect(() => {
    latestStatusRef.current = scenario?.status ?? "";
  }, [scenario?.status]);

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

  // Auto-enable refresh for active states, disable for terminal states.
  // Respects the user's explicit "Off" choice via userDisabledRefresh.
  useEffect(() => {
    const status = scenario?.status;
    if (status === undefined) return;
    if (ACTIVE_TEST_STATES.has(status) && !isAutoRefreshEnabled && !userDisabledRefresh.current) {
      setIsAutoRefreshEnabled(true);
    } else if (isTerminalState(status) && isAutoRefreshEnabled) {
      userDisabledRefresh.current = false;
      setIsAutoRefreshEnabled(false);
    }
  }, [scenario?.status]);

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
          refetch().finally(() => {
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
  }, [isAutoRefreshEnabled, currentInterval, refetch, refreshTrigger]);


  const handleManualRefresh = async () => {
    // Prevent overlapping refreshes
    if (isRefreshing) return;
    
    // Clear any existing progress timer
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }
    
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
    
    // Reset progress - the main effect will restart the timer automatically
    setProgress(0);
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
      const { ...scenarioWithoutId } = scenario;
      const encodedData = encodeURIComponent(JSON.stringify(scenarioWithoutId));
      navigate(`/create-scenario?step=0&copyData=${encodedData}`);
    }
  };

  const handleEdit = () => {
    if (scenario) {
      sendConsoleMetric("ButtonClick", { Page: "ScenarioDetails", Action: "EditScenario", TestId: testId });
      const encodedData = encodeURIComponent(JSON.stringify(scenario));
      navigate(`/create-scenario?step=0&editData=${encodedData}`);
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
    if (scenario) {
      sendConsoleMetric("ButtonClick", { Page: "ScenarioDetails", Action: "RunScenario", TestId: testId });
      try {
        await runScenario(scenario).unwrap();
      } catch (error: any) {
        if (scenario.testId && error?.status === 400 && error?.data?.message?.includes('INVALID_REQUEST_BODY: testName')) {
          // Handle legacy test scenarios with invalid test names - prompt user to update the test name
          const msg = 'Test Name contains invalid characters (only letters, numbers, spaces, hyphens, underscores, and parentheses are allowed). Please edit the scenario and change the name. This will not impact the test scenario or test history.'
          setRunError(msg);
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
    return (
      <ContentLayout>
        <StatusIndicator type={isLoading ? "loading" : "error"}>Loading</StatusIndicator>
      </ContentLayout>
    );
  }

  if (error) {
    // Check for 504 Gateway Timeout
    const isTimeoutError = 'status' in error && error.status === 504;
    
    if (isTimeoutError) {
      return (
        <ContentLayout>
          <Alert type="warning">
            Unable to load live test data. This can happen when tests are running a large number of tasks. The test is still running normally. Please wait until the test completes to view full details.
          </Alert>
        </ContentLayout>
      );
    }
    
    // Generic error handling for other error types
    return (
      <ContentLayout>
        <Alert type="error">Failed to load scenario details</Alert>
      </ContentLayout>
    );
  }

  if (!scenario) {
    return (
      <ContentLayout>
        <Alert type="error">Scenario not found</Alert>
      </ContentLayout>
    );
  }

  return (
    <ContentLayout
      header={
        <Header
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <SpaceBetween direction="horizontal" size="xs">
                <Box>
                  <SpaceBetween direction="vertical" size="xxs">
                    <ButtonDropdown 
                      mainAction={
                        {
                          iconName: "refresh",
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
                    {isAutoRefreshEnabled && (
                      <ProgressBar 
                        status="in-progress"
                        value={progress}
                        data-hide-percentage="true"
                      />
                    )}
                  </SpaceBetween>
                </Box>
              </SpaceBetween>
              {scenario.status === TestStatus.CANCELLING ? (
                <Button disabled>Cancelling…</Button>
              ) : ACTIVE_TEST_STATES.has(scenario.status) ? (
                <Button data-cy="cancel-scenario-btn" onClick={handleCancel} loading={isStoppingScenario}>Cancel</Button>
              ) : (
                <Button onClick={handleEdit}>Edit Scenario</Button>
              )}
              <Button onClick={handleCopy}>Copy Scenario</Button>
              <Button
                data-cy="details-delete-scenario-btn"
                onClick={() => setShowDeleteModal(true)}
                disabled={!isTerminalState(scenario.status)}
              >
                Delete Scenario
              </Button>
              <Button 
                variant="primary" 
                onClick={handleRun} 
                loading={isRunningScenario}
                disabled={ACTIVE_TEST_STATES.has(scenario.status)}
              >
                Run Scenario
              </Button>
            </SpaceBetween>
          }
        />
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
      <ScenarioDetailsContent scenario_definition={scenario} />

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
