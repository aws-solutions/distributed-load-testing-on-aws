// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useCollection } from "@cloudscape-design/collection-hooks";
import {
  Button,
  ButtonDropdown,
  Header,
  Link,
  Pagination,
  SpaceBetween,
  StatusIndicator,
  Table,
  TextFilter,
} from "@cloudscape-design/components";
import { useState } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { TablePreferences, EmptyState } from "../../components/common";
import { addNotification } from "../../store/notificationsSlice";
import { sendConsoleMetric } from "../../utils/consoleMetrics";
import { formatToLocalTime } from "../../utils/dateUtils";
import { getStatusConfig } from "./constants";
import { isCancelableRunStatus, isTerminalRunStatus, TestStatus } from "@amzn/dlt-common/validation";
import { useScenarioActions } from "./hooks/useScenarioActions";
import { ScenarioDefinition } from "./types";
import { DeleteScenarioModal } from "./components/DeleteScenarioModal";

const DEFAULT_PREFERENCES = {
  pageSize: 10,
  wrapLines: false,
  stripedRows: false,
  contentDensity: "comfortable" as const,
  contentDisplay: [
    { id: "testName", visible: true },
    { id: "testId", visible: true },
    { id: "keywords", visible: true },
    { id: "testDescription", visible: true },
    { id: "totalTestRuns", visible: true },
    { id: "lastRun", visible: true },
    { id: "lastRunStatus", visible: true },
    { id: "nextRun", visible: true },
  ],
  stickyColumns: { first: 1, last: 0 },
};

const PAGE_SIZE_OPTIONS = [
  { value: 10, label: "10 scenarios" },
  { value: 20, label: "20 scenarios" },
  { value: 50, label: "50 scenarios" },
];

const COLUMN_OPTIONS = [
  { id: "testName", label: "Scenario Name", alwaysVisible: true },
  { id: "testId", label: "Scenario ID" },
  { id: "keywords", label: "Keywords" },
  { id: "testDescription", label: "Scenario Description" },
  { id: "totalTestRuns", label: "Total Test Runs" },
  { id: "lastRun", label: "Last Run" },
  { id: "lastRunStatus", label: "Last Run Status" },
  { id: "nextRun", label: "Next Run" },
];

export default function ScenariosContent({
  scenarios,
  refetch,
  isFetching,
}: {
  scenarios: ScenarioDefinition[];
  refetch: () => void;
  isFetching: boolean;
}) {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [selectedItems, setSelectedItems] = useState<ScenarioDefinition[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const { editScenario, copyScenario, cancelTestRun, deleteScenario } = useScenarioActions();
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Resolve the selected row against the freshest scenarios list by id. `selectedItems`
  // captures the object at selection time; after a refetch/poll returns new objects it
  // would be stale (old status), which would gate Edit/Cancel on the previous state and
  // could let a duplicate action through. Deriving by id here (with trackBy on the table
  // keeping the row visually selected) makes actions and gating read the current status.
  const selectedScenario = scenarios.find((scenario) => scenario.testId === selectedItems[0]?.testId);

  const handleAction = async (action: () => Promise<any>, onSuccess?: () => void) => {
    setIsActionLoading(true);
    try {
      await action();
      onSuccess?.();
    } finally {
      setIsActionLoading(false);
    }
  };

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(scenarios, {
    filtering: {
      empty: (
        <EmptyState
          title="No test scenarios"
          message="Create your first test scenario to get started."
          primaryAction={{ label: "Create scenario", onClick: () => navigate("/scenarios/create") }}
        />
      ),
      noMatch: <EmptyState title="No matches" message="No scenarios match the filter." />,
      filteringFunction: (item, filteringText) =>
        !filteringText ||
        !!item.testName?.toLowerCase().includes(filteringText.toLowerCase()) ||
        !!item.testId?.toLowerCase().includes(filteringText.toLowerCase()) ||
        !!item.tags?.some((tag) => tag?.toLowerCase().includes(filteringText.toLowerCase())),
    },
    pagination: { pageSize: preferences.pageSize },
    sorting: {},
  });

  const getStatusIndicator = (status: string) => {
    const statusConfig = getStatusConfig(status?.toLowerCase());
    return <StatusIndicator type={statusConfig.type}>{statusConfig.label}</StatusIndicator>;
  };

  const getLastRunStatus = (scenario: ScenarioDefinition) =>
    scenario.status === "running" ? "running" : scenario.history?.[0]?.status || scenario.status || "-";

  const allColumnDefinitions = [
    {
      id: "testName",
      header: "Scenario Name",
      cell: (item: ScenarioDefinition) => (
        <Link
          href={`/scenarios/${item.testId}`}
          onFollow={(event) => {
            event.preventDefault();
            navigate(`/scenarios/${item.testId}`);
          }}
        >
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
      id: "keywords",
      header: "Keywords",
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
      sortingComparator: (a: ScenarioDefinition, b: ScenarioDefinition) =>
        (a.totalTestRuns || 0) - (b.totalTestRuns || 0),
    },
    {
      id: "lastRun",
      header: "Last Run",
      cell: (item: ScenarioDefinition) => formatToLocalTime(item.startTime, { timeZoneName: "short" }),
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
      cell: (item: ScenarioDefinition) =>
        formatToLocalTime(item.nextRun, { timeZoneName: "short" }, item.scheduleTimezone),
      sortingField: "nextRun",
    },
  ];

  const columnDefinitions = preferences.contentDisplay
    .map((pref) => allColumnDefinitions.find((col) => col.id === pref.id))
    .filter((col): col is NonNullable<typeof col> => Boolean(col));

  return (
    <>
      <Table
        {...collectionProps}
        variant="full-page"
        columnDefinitions={columnDefinitions}
        visibleColumns={preferences.contentDisplay.filter((col) => col.visible).map((col) => col.id)}
        items={items}
        loadingText="Loading scenarios"
        wrapLines={preferences.wrapLines}
        stripedRows={preferences.stripedRows}
        contentDensity={preferences.contentDensity}
        stickyColumns={preferences.stickyColumns}
        selectionType="single"
        trackBy="testId"
        selectedItems={selectedScenario ? [selectedScenario] : []}
        onSelectionChange={({ detail }) => setSelectedItems(detail.selectedItems)}
        filter={
          <TextFilter
            {...filterProps}
            data-cy="scenarios-search"
            filteringPlaceholder="Search by name, ID, or keyword"
            countText={`${filteredItemsCount} ${filteredItemsCount === 1 ? "match" : "matches"}`}
          />
        }
        header={
          <Header
            variant="h1"
            counter={`(${filteredItemsCount})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" loading={isFetching} onClick={refetch} />
                <ButtonDropdown
                  loading={isActionLoading}
                  items={[
                    {
                      // Editing writes saveOnly, which the API rejects for any active run
                      // (409 TEST_RUNNING). Allow Edit only in terminal states, matching the
                      // details page and the API's safeToEdit set.
                      text: "Edit Scenario",
                      id: "edit",
                      disabled: !selectedScenario || !isTerminalRunStatus(selectedScenario.status),
                    },
                    { text: "Copy Scenario", id: "copy", disabled: !selectedScenario },
                    {
                      // Cancel is enabled only where the API accepts a cancel
                      // (isCancelableRunStatus: queued/provisioning/running) and hidden once the
                      // run is already stopping ("cancelling"). The finishing states (cleaning up /
                      // parsing results) are intentionally excluded — the API rejects a cancel
                      // there. Matches the details page and the API's cancel guard.
                      text: "Cancel Test Run",
                      id: "cancel",
                      disabled:
                        !selectedScenario ||
                        !isCancelableRunStatus(selectedScenario.status) ||
                        selectedScenario.status === TestStatus.CANCELLING,
                    },
                    {
                      text: "Delete Scenario",
                      id: "delete",
                      disabled: !selectedScenario || !isTerminalRunStatus(selectedScenario.status),
                    },
                  ]}
                  onItemClick={(event) => {
                    const { id } = event.detail;

                    if (!selectedScenario) return;

                    switch (id) {
                      case "edit":
                        sendConsoleMetric("ButtonClick", {
                          Page: "Scenarios",
                          Action: "EditScenario",
                          TestId: selectedScenario.testId,
                        });
                        editScenario(selectedScenario.testId);
                        break;
                      case "copy":
                        sendConsoleMetric("ButtonClick", {
                          Page: "Scenarios",
                          Action: "CopyScenario",
                          TestId: selectedScenario.testId,
                        });
                        copyScenario(selectedScenario.testId);
                        break;
                      case "cancel":
                        sendConsoleMetric("ButtonClick", {
                          Page: "Scenarios",
                          Action: "CancelTestRun",
                          TestId: selectedScenario.testId,
                        });
                        handleAction(
                          () => cancelTestRun(selectedScenario.testId),
                          () => refetch()
                        );
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
                  onClick={() => {
                    sendConsoleMetric("ButtonClick", { Page: "Scenarios", Action: "NewScenario" });
                    navigate("/scenarios/create");
                  }}
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
            onConfirm={(detail) =>
              setPreferences({
                ...DEFAULT_PREFERENCES,
                ...detail,
              })
            }
          />
        }
      />

      <DeleteScenarioModal
        visible={showDeleteModal}
        scenarioName={selectedScenario?.testName ?? ""}
        loading={isActionLoading}
        onDismiss={() => setShowDeleteModal(false)}
        onConfirm={async () => {
          if (selectedScenario) {
            setIsActionLoading(true);
            try {
              await deleteScenario(selectedScenario.testId).unwrap();
              setShowDeleteModal(false);
              sendConsoleMetric("ButtonClick", {
                Page: "Scenarios",
                Action: "DeleteScenario",
                TestId: selectedScenario.testId,
              });
            } catch (error: any) {
              dispatch(
                addNotification({
                  id: `delete-error-${Date.now()}`,
                  type: "error",
                  content: `Failed to delete scenario: ${error?.data?.message || error?.message || "Unknown error"}`,
                })
              );
            } finally {
              setIsActionLoading(false);
            }
          }
        }}
      />
    </>
  );
}
