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
  StatusIndicator
} from "@cloudscape-design/components";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useGetScenarioDetailsQuery, useRunScenarioMutation, useStopScenarioMutation } from "../../store/scenariosApiSlice";
import { ScenarioDetailsContent } from "./components/ScenarioDetailsContent";
import "./ScenarioDetailsPage.css";

export default function ScenarioDetailsPage() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const { data: scenario, isLoading, error, refetch } = useGetScenarioDetailsQuery({ testId: testId! });
  const [stopScenario, { isLoading: isStoppingScenario }] = useStopScenarioMutation();
  const [runScenario, { isLoading: isRunningScenario }] = useRunScenarioMutation();
  const [progress, setProgress] = useState(0);
  const [isAutoRefreshEnabled, setIsAutoRefreshEnabled] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentInterval, setCurrentInterval] = useState(5000);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        setCurrentInterval(intervalTime);
        setIsAutoRefreshEnabled(true);
      }
    } else {
      setIsAutoRefreshEnabled(false);
    }
  };

  // Auto-enable refresh when scenario starts running
  useEffect(() => {
    if (scenario?.status === "running" && !isAutoRefreshEnabled) {
      // Automatically enable auto-refresh with default interval when test starts
      setIsAutoRefreshEnabled(true);
    } else if (scenario?.status !== "running" && isAutoRefreshEnabled) {
      // Disable auto-refresh when test stops
      setIsAutoRefreshEnabled(false);
    }
  }, [scenario?.status]);

  // Main effect to manage auto-refresh timer
  useEffect(() => {
    // Clear any existing timer
    if (progressRef.current) {
      clearInterval(progressRef.current);
      progressRef.current = null;
    }
    
    // Only start timer if auto-refresh is enabled AND scenario is running
    if (isAutoRefreshEnabled && scenario?.status === "running") {
      setProgress(0);
      
      // Update progress every 100ms
      const step = 100 / (currentInterval / 100);
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
      // Reset progress when auto-refresh is disabled or test is not running
      setProgress(0);
    }
    
    // Cleanup on unmount or when dependencies change
    return () => {
      if (progressRef.current) {
        clearInterval(progressRef.current);
        progressRef.current = null;
      }
    };
  }, [isAutoRefreshEnabled, scenario?.status, currentInterval, refetch, refreshTrigger]);


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
      const { ...scenarioWithoutId } = scenario;
      const encodedData = encodeURIComponent(JSON.stringify(scenarioWithoutId));
      navigate(`/create-scenario?step=0&copyData=${encodedData}`);
    }
  };

  const handleEdit = () => {
    if (scenario) {
      const encodedData = encodeURIComponent(JSON.stringify(scenario));
      navigate(`/create-scenario?step=0&editData=${encodedData}`);
    }
  };

  const handleCancel = async () => {
    if (scenario) {
      try {
        await stopScenario({ testId: scenario.testId }).unwrap();
      } catch (error: any) {
        setCancelError(error?.data?.message || error?.message || 'Failed to cancel scenario');
      }
    }
  };

  const handleRun = async () => {
    if (scenario) {
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
                    {isAutoRefreshEnabled && scenario?.status === "running" && (
                      <ProgressBar 
                        status="in-progress"
                        value={progress}
                        data-hide-percentage="true"
                      />
                    )}
                  </SpaceBetween>
                </Box>
              </SpaceBetween>
              {scenario?.status === "running" ? (
                <Button onClick={handleCancel} loading={isStoppingScenario}>Cancel</Button>
              ) : (
                <Button onClick={handleEdit}>Edit Scenario</Button>
              )}
              <Button onClick={handleCopy}>Copy Scenario</Button>
              <Button 
                variant="primary" 
                onClick={handleRun} 
                loading={isRunningScenario}
                disabled={scenario?.status === "running"}
              >
                {scenario?.status === "running" ? "Test Running" : "Run Scenario"}
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
      {scenario && <ScenarioDetailsContent scenario_definition={scenario} />}
    </ContentLayout>
  );
}
