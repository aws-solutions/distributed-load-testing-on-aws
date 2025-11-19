// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useState, useMemo, useEffect } from "react";
import {
  Container,
  StatusIndicator,
  SpaceBetween,
  Button,
  Modal,
  Alert,
} from "@cloudscape-design/components";
import { useNavigate } from "react-router-dom";

import { useTestRuns } from "../hooks/useTestRuns";
import { useTestRunColumns } from "../hooks/useTestRunColumns";
import { TestRunsBaselineContainer } from "./TestRunsBaselineContainer";
import { TestRunsDateFilter } from "./TestRunsDateFilter";
import { TestRunsTable } from "./TestRunsTable";
import { TestRun } from "../types";
import { useDeleteTestRunsMutation } from "../../../store/scenariosApiSlice";
import { generateCSV, downloadCSV } from "../utils";
import { TableColumn } from "../types";

const INITIAL_PREFERENCES = {
  pageSize: 20,
  wrapLines: false,
  stripedRows: false,
  contentDensity: "comfortable" as const,
  stickyColumns: { first: 1, last: 0 },
  contentDisplay: [
    { id: "testRun", visible: true },
    { id: "testRunId", visible: true },
    { id: "requests", visible: true },
    { id: "success", visible: true },
    { id: "errors", visible: true },
    { id: "requestsPerSecond", visible: true },
    { id: "avgResponseTime", visible: true },
  ],
};

const PREFERENCES_KEY = "testRunsTablePreferences";

interface TestRunsProps {
  testId: string;
}

export function TestRuns({ testId }: TestRunsProps) {
  const navigate = useNavigate();
  const [deleteTestRuns, { isLoading: isDeletingTestRuns }] = useDeleteTestRunsMutation();

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [testRunsToDelete, setTestRunsToDelete] = useState<TestRun[]>([]);
  const {
    dateFilter,
    baselineTestRun,
    allTestRuns,
    isLoadingMore,
    isLoading,
    error,
    baselineError,
    firstPageData,
    isSettingBaseline,
    isRemovingBaseline,
    handleSetBaseline,
    handleRemoveBaseline,
    handleDateFilterChange,
    refetch,
  } = useTestRuns(testId);

  const handleTestRunClick = (testRunId: string) => {
    navigate(`/scenarios/${testId}/testruns/${testRunId}`);
  };

  const { allColumns, getFilteredColumns } = useTestRunColumns(baselineTestRun, handleTestRunClick);

  const [preferences, setPreferences] = useState(() => {
    try {
      const saved = localStorage.getItem(PREFERENCES_KEY);
      return saved ? { ...INITIAL_PREFERENCES, ...JSON.parse(saved) } : INITIAL_PREFERENCES;
    } catch {
      return INITIAL_PREFERENCES;
    }
  });

  useEffect(() => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  }, [preferences]);

  const filteredColumns = useMemo(() => getFilteredColumns(preferences), [getFilteredColumns, preferences]);

  const retryButton = useMemo(() => (
    <Button onClick={() => refetch()}>Retry</Button>
  ), [refetch]);



  const handleDeleteTestRuns = (selectedTestRuns: TestRun[]) => {
    setTestRunsToDelete(selectedTestRuns);
    setShowDeleteModal(true);
  };

  const confirmDeleteTestRuns = async () => {
    try {
      const testRunIds = testRunsToDelete.map(testRun => testRun.testRunId);
      await deleteTestRuns({ testId, testRunIds }).unwrap();
      setShowDeleteModal(false);
      setTestRunsToDelete([]);
    } catch (error) {
      console.error('Failed to delete test runs:', error);
    }
  };



  const handleDownloadCSV = () => {
    // Generate CSV content
    const csvContent = generateCSV(filteredColumns as TableColumn<TestRun>[], allTestRuns, !!baselineTestRun);
    
    // Create filename with testId and current date
    const currentDate = new Date().toISOString().split('T')[0];
    const filename = `test-runs-${testId}-${currentDate}.csv`;
    
    // Trigger download
    downloadCSV(csvContent, filename);
  };

  if (isLoading) {
    return (
      <Container>
        <StatusIndicator type="loading">Loading test runs...</StatusIndicator>
      </Container>
    );
  }

  if (error) {
    return (
      <Container>
        <SpaceBetween size="m">
          <StatusIndicator type="error">Failed to load test runs</StatusIndicator>
          {retryButton}
        </SpaceBetween>
      </Container>
    );
  }

  return (
    <>
      <SpaceBetween size="m">
        {baselineError && (
          <Alert type="warning">
            Failed to load baseline data. The baseline comparison may not be available.
          </Alert>
        )}
        <TestRunsBaselineContainer
          baselineTestRun={baselineTestRun}
          onRemoveBaseline={handleRemoveBaseline}
          isRemovingBaseline={isRemovingBaseline}
        />
        <TestRunsTable
          testRuns={allTestRuns}
          columns={filteredColumns}
          allColumns={allColumns}
          preferences={preferences}
          onPreferencesChange={setPreferences}
          onSetBaseline={handleSetBaseline}
          isSettingBaseline={isSettingBaseline}
          isLoadingMore={isLoadingMore}
          isLoading={isLoading}
          totalCount={firstPageData?.pagination?.total_count}
          filter={<TestRunsDateFilter dateFilter={dateFilter} onChange={handleDateFilterChange} />}
          downloadCSV={handleDownloadCSV}
          onDeleteTestRuns={handleDeleteTestRuns}
          isDeletingTestRuns={isDeletingTestRuns}
        />
      </SpaceBetween>
      <Modal
        visible={showDeleteModal}
        onDismiss={() => setShowDeleteModal(false)}
        header="Delete test runs"
        footer={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={() => setShowDeleteModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmDeleteTestRuns} loading={isDeletingTestRuns}>
              Delete
            </Button>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="m">
          <p>Are you sure you want to delete {testRunsToDelete.length} test run{testRunsToDelete.length !== 1 ? 's' : ''}? This action cannot be undone.</p>
          <p><strong>Note:</strong> Only database records will be deleted. Results and logs in S3 are preserved and must be manually deleted if needed. <a href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/uninstall-the-solution.html#deleting-the-amazon-s3-buckets" target="_blank" rel="noopener noreferrer">Learn more</a></p>
        </SpaceBetween>
      </Modal>
    </>
  );
}
