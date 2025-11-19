// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo } from "react";
import {
  Table,
  Header,
  SpaceBetween,
  Button,
  Pagination,
  Box,
} from "@cloudscape-design/components";
import { useCollection } from "@cloudscape-design/collection-hooks";
import { TestRun } from "../types";
import { TablePreferences } from "../../../components/common/TablePreferences";

const PAGE_SIZE_OPTIONS = [
  { value: 10, label: "10 test runs" },
  { value: 20, label: "20 test runs" },
  { value: 50, label: "50 test runs" },
];

const TABLE_ARIA_LABELS = {
  selectionGroupLabel: "Test runs selection",
  allItemsSelectionLabel: () => "select all",
  nextPageLabel: "Next page",
  previousPageLabel: "Previous page",
  pageLabel: (pageNumber: number) => `Page ${pageNumber}`,
};



interface TestRunsTableProps {
  testRuns: TestRun[];
  columns: any[];
  allColumns: any[];
  preferences: any;
  onPreferencesChange: (preferences: any) => void;
  onSetBaseline: (selectedItems: TestRun[]) => void;
  isSettingBaseline: boolean;
  isLoadingMore: boolean;
  isLoading: boolean;
  totalCount?: number;
  filter: React.ReactNode;
  onRowClick?: (testRun: TestRun) => void;
  downloadCSV?: () => void;
  onDeleteTestRuns?: (selectedItems: TestRun[]) => void;
  isDeletingTestRuns?: boolean;
}

export const TestRunsTable: React.FC<TestRunsTableProps> = ({
  testRuns,
  columns,
  allColumns,
  preferences,
  onPreferencesChange,
  onSetBaseline,
  isSettingBaseline,
  isLoadingMore,
  isLoading,
  totalCount,
  filter,
  onRowClick,
  downloadCSV,
  onDeleteTestRuns,
  isDeletingTestRuns,
}) => {
  const {
    items: sortedItems,
    collectionProps,
    paginationProps,
  } = useCollection(testRuns, {
    filtering: {
      empty: (
        <Box margin={{ vertical: "xs" }} textAlign="center" color="inherit">
          <b>No test runs found</b>
        </Box>
      ),
    },
    pagination: { pageSize: preferences.pageSize },
    sorting: {},
    selection: { trackBy: "testRunId" },
  });

  const tableActions = useMemo(() => (
    <SpaceBetween direction="horizontal" size="xs">
      <Button
        variant="normal"
        iconName="download"
        onClick={downloadCSV}
        disabled={testRuns.length === 0 || isLoading}
      >
        Download Table
      </Button>
      <Button
        variant="normal"
        onClick={() => onSetBaseline([...(collectionProps.selectedItems || [])])}
        disabled={(collectionProps.selectedItems?.length || 0) !== 1 || isSettingBaseline}
        loading={isSettingBaseline}
      >
        Set Baseline
      </Button>
      <Button 
        variant="normal" 
        disabled={(collectionProps.selectedItems?.length || 0) === 0 || isDeletingTestRuns}
        loading={isDeletingTestRuns}
        onClick={() => onDeleteTestRuns?.([...(collectionProps.selectedItems || [])])}
      >
        Delete
      </Button>
    </SpaceBetween>
  ), [collectionProps.selectedItems, isSettingBaseline, onSetBaseline, downloadCSV, testRuns.length, isLoading, onDeleteTestRuns, isDeletingTestRuns]);

  return (
    <Table
      {...collectionProps}
      columnDefinitions={columns}
      items={sortedItems}
      loading={isLoading}
      loadingText="Loading test runs..."
      selectionType="multi"
      wrapLines={preferences.wrapLines}
      stripedRows={preferences.stripedRows}
      contentDensity={preferences.contentDensity}
      stickyColumns={preferences.stickyColumns}
      ariaLabels={{
        ...TABLE_ARIA_LABELS,
        itemSelectionLabel: ({ selectedItems }, item) => item.testRunId,
      }}
      trackBy="testRunId"
      header={
        <Header
          counter={`(${collectionProps.selectedItems?.length || 0 ? `${collectionProps.selectedItems?.length}/` : ""}${totalCount ?? "..."})`}
          actions={tableActions}
          description={isLoadingMore ? "Loading test runs ..." : undefined}
        >
          Test Runs
        </Header>
      }
      filter={filter}
      pagination={
        <Pagination
          {...paginationProps}
          ariaLabels={{
            nextPageLabel: TABLE_ARIA_LABELS.nextPageLabel,
            previousPageLabel: TABLE_ARIA_LABELS.previousPageLabel,
            pageLabel: TABLE_ARIA_LABELS.pageLabel,
          }}
        />
      }
      preferences={
        <TablePreferences
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          columnOptions={allColumns
            .filter((col) => !col.id.endsWith("Delta"))
            .map((col) => ({
              id: col.id,
              label: col.preferenceHeader || col.header,
              alwaysVisible: col.id === "testRun",
            }))}
          preferences={preferences}
          onConfirm={onPreferencesChange}
        />
      }
      onRowClick={onRowClick ? ({ detail }) => onRowClick(detail.item) : undefined}
    />
  );
};