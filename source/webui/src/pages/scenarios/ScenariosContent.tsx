// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Table, Header, Link, StatusIndicator, TextFilter, Pagination, Button, ButtonDropdown, SpaceBetween, Modal, Box } from "@cloudscape-design/components";
import { useCollection } from "@cloudscape-design/collection-hooks";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useDispatch } from "react-redux";
import { ScenarioDefinition } from "./types";
import { TablePreferences } from "../../components/common/TablePreferences";
import { useScenarioActions } from "./hooks/useScenarioActions";
import { addNotification } from "../../store/notificationsSlice";
import { formatToLocalTime } from "../../utils/dateUtils";


const DEFAULT_PREFERENCES = {
  pageSize: 10,
  wrapLines: false,
  stripedRows: false,
  contentDensity: 'comfortable' as const,
  contentDisplay: [
    { id: 'testName', visible: true },
    { id: 'testId', visible: true },
    { id: 'tags', visible: true },
    { id: 'testDescription', visible: true },
    { id: 'totalTestRuns', visible: true },
    { id: 'lastRun', visible: true },
    { id: 'lastRunStatus', visible: true },
    { id: 'nextRun', visible: true }
  ],
  stickyColumns: { first: 1, last: 0 }
};

const STATUS_MAP = {
  complete: { type: 'success' as const, text: 'Complete' },
  cancelled: { type: 'stopped' as const, text: 'Cancelled' },
  running: { type: 'in-progress' as const, text: 'Running' },
  failed: { type: 'error' as const, text: 'Failed' },
  default: { type: 'pending' as const, text: '-' }
};

const PAGE_SIZE_OPTIONS = [
  { value: 10, label: "10 scenarios" },
  { value: 20, label: "20 scenarios" },
  { value: 50, label: "50 scenarios" }
];

const COLUMN_OPTIONS = [
  { id: "testName", label: "Scenario Name", alwaysVisible: true },
  { id: "testId", label: "Scenario ID" },
  { id: "tags", label: "Tags" },
  { id: "testDescription", label: "Scenario Description" },
  { id: "totalTestRuns", label: "Total Test Runs" },
  { id: "lastRun", label: "Last Run" },
  { id: "lastRunStatus", label: "Last Run Status" },
  { id: "nextRun", label: "Next Run" }
];

export default function ScenariosContent({ scenarios }: { scenarios: ScenarioDefinition[] }) {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [selectedItems, setSelectedItems] = useState<ScenarioDefinition[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const { editScenario, copyScenario, cancelTestRun, deleteScenario } = useScenarioActions();
  const [isActionLoading, setIsActionLoading] = useState(false);

  const handleAction = async (action: () => Promise<any>, onSuccess?: () => void) => {
    setIsActionLoading(true);
    try {
      await action();
      onSuccess?.();
    } finally {
      setIsActionLoading(false);
    }
  };

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(
    scenarios,
    {
      filtering: {
        empty: "No scenarios found",
        noMatch: "No scenarios match the filter",
        filteringFunction: (item, filteringText) =>
          !filteringText ||
          !!item.testName?.toLowerCase().includes(filteringText.toLowerCase()) ||
          !!(item.tags?.some(tag => tag?.toLowerCase().includes(filteringText.toLowerCase()))),
      },
      pagination: { pageSize: preferences.pageSize },
      sorting: {},
    }
  );

  const getStatusIndicator = (status: string) => {
    const statusConfig = STATUS_MAP[status?.toLowerCase() as keyof typeof STATUS_MAP] || STATUS_MAP.default;
    return <StatusIndicator type={statusConfig.type}>{statusConfig.text}</StatusIndicator>;
  };

  const getLastRunStatus = (scenario: ScenarioDefinition) =>
    scenario.status === "running" ? "running" : scenario.history?.[0]?.status || scenario.status || "-";

  const allColumnDefinitions = [
    {
      id: "testName",
      header: "Scenario Name",
      cell: (item: ScenarioDefinition) => (
        <Link onFollow={() => navigate(`/scenarios/${item.testId}`)}>
          {item.testName}
        </Link>
      ),
      sortingField: "testName",
    },
    {
      id: "testId",
      header: "Scenario ID",
      cell: (item: ScenarioDefinition) => item.testId,
      sortingField: "testId",
    },
    {
      id: "tags",
      header: "Tags",
      cell: (item: ScenarioDefinition) => item.tags?.filter(Boolean).join(", ") || "-",
      sortingField: "tags",
    },
    {
      id: "testDescription",
      header: "Scenario Description",
      cell: (item: ScenarioDefinition) => item.testDescription || "-",
      sortingField: "testDescription",
    },
    {
      id: "totalTestRuns",
      header: "Total Test Runs",
      cell: (item: ScenarioDefinition) => item.totalTestRuns || 0,
      sortingField: "totalTestRuns",
      sortingComparator: (a: ScenarioDefinition, b: ScenarioDefinition) => (a.totalTestRuns || 0) - (b.totalTestRuns || 0),
    },
    {
      id: "lastRun",
      header: "Last Run",
      cell: (item: ScenarioDefinition) => formatToLocalTime(item.startTime),
      sortingField: "startTime",
    },
    {
      id: "lastRunStatus",
      header: "Last Run Status",
      cell: (item: ScenarioDefinition) => getStatusIndicator(getLastRunStatus(item)),
      sortingField: "status",
    },
    {
      id: "nextRun",
      header: "Next Run",
      cell: (item: ScenarioDefinition) => formatToLocalTime(item.nextRun),
      sortingField: "nextRun",
    },
  ];

  const columnDefinitions = preferences.contentDisplay
    .map(pref => allColumnDefinitions.find(col => col.id === pref.id))
    .filter((col): col is NonNullable<typeof col> => Boolean(col));

  return (
    <>
      <Table
        {...collectionProps}
        columnDefinitions={columnDefinitions}
        visibleColumns={preferences.contentDisplay.filter(col => col.visible).map(col => col.id)}
        items={items}
        loadingText="Loading scenarios"
        empty="No scenarios found"
        wrapLines={preferences.wrapLines}
        stripedRows={preferences.stripedRows}
        contentDensity={preferences.contentDensity}
        stickyColumns={preferences.stickyColumns}
        selectionType="single"
        selectedItems={selectedItems}
        onSelectionChange={({ detail }) => setSelectedItems(detail.selectedItems)}
        filter={
          <TextFilter
            {...filterProps}
            filteringPlaceholder="Search scenarios or tags"
            countText={`${filteredItemsCount} ${filteredItemsCount === 1 ? "match" : "matches"}`}
          />
        }
        header={
          <Header
            counter={`(${filteredItemsCount})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" onClick={() => window.location.reload()} />
                <ButtonDropdown
                  loading={isActionLoading}
                  items={[
                    { text: "Edit Scenario", id: "edit", disabled: !selectedItems.length || selectedItems[0]?.status === "running" },
                    { text: "Copy Scenario", id: "copy", disabled: !selectedItems.length },
                    { text: "Cancel Test Run", id: "cancel", disabled: !selectedItems.length || selectedItems[0]?.status !== "running" },
                    { text: "Delete Scenario", id: "delete", disabled: !selectedItems.length || selectedItems[0]?.status === "running" }
                  ]}
                  onItemClick={(event) => {
                    const selectedScenario = selectedItems[0];
                    const { id } = event.detail;

                    if (!selectedScenario) return;

                    switch (id) {
                      case "edit":
                        handleAction(() => editScenario(selectedScenario.testId));
                        break;
                      case "copy":
                        handleAction(() => copyScenario(selectedScenario.testId));
                        break;
                      case "cancel":
                        handleAction(() => cancelTestRun(selectedScenario.testId), () => window.location.reload());
                        break;
                      case "delete":
                        setShowDeleteModal(true);
                        break;
                    }
                  }}
                >
                  Actions
                </ButtonDropdown>
                <Button
                  variant="primary"
                  onClick={() => navigate('/create-scenario')}
                >
                  New Scenario
                </Button>
              </SpaceBetween>
            }
          >
            Test Scenarios
          </Header>
        }
        pagination={<Pagination {...paginationProps} />}
        preferences={
          <TablePreferences
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            columnOptions={COLUMN_OPTIONS}
            preferences={preferences}
            onConfirm={(detail) => setPreferences({
              ...DEFAULT_PREFERENCES,
              ...detail
            })}
          />
        }
      />

      <Modal
        visible={showDeleteModal}
        onDismiss={() => setShowDeleteModal(false)}
        header="Delete scenario"
        closeAriaLabel="Close modal"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setShowDeleteModal(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={isActionLoading}
                onClick={async () => {
                  if (selectedItems[0]) {
                    setIsActionLoading(true);
                    try {
                      await deleteScenario(selectedItems[0].testId).unwrap();
                      setShowDeleteModal(false);
                    } catch (error) {
                      dispatch(addNotification({
                        id: `delete-error-${Date.now()}`,
                        type: 'error',
                        content: `Failed to delete scenario: ${error instanceof Error ? error.message : 'Unknown error'}`
                      }));
                    } finally {
                      setIsActionLoading(false);
                    }
                  }
                }}
              >
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          <p>Are you sure you want to delete the scenario "{selectedItems[0]?.testName}"? This action cannot be undone.</p>
          <p><strong>Note:</strong> Only database records will be deleted. Results and logs in S3 are preserved and must be manually deleted if needed. <a href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/uninstall-the-solution.html#deleting-the-amazon-s3-buckets" target="_blank" rel="noopener noreferrer">Learn more</a></p>
        </SpaceBetween>
      </Modal>
    </>
  );
}