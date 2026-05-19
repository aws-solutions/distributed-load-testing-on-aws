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
import { TablePreferences } from "../../components/common/TablePreferences";
import { addNotification } from "../../store/notificationsSlice";
import { sendConsoleMetric } from "../../utils/consoleMetrics";
import { formatToLocalTime } from "../../utils/dateUtils";
import { getStatusConfig, isTerminalState } from "./constants";
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
    { id: "tags", visible: true },
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
  { id: "tags", label: "Tags" },
  { id: "testDescription", label: "Scenario Description" },
  { id: "totalTestRuns", label: "Total Test Runs" },
  { id: "lastRun", label: "Last Run" },
  { id: "lastRunStatus", label: "Last Run Status" },
  { id: "nextRun", label: "Next Run" },
];

export default function ScenariosContent({ scenarios, refetch, isFetching }: { scenarios: ScenarioDefinition[]; refetch: () => void; isFetching: boolean }) {
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

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } = useCollection(scenarios, {
    filtering: {
      empty: "No scenarios found",
      noMatch: "No scenarios match the filter",
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
      cell: (item: ScenarioDefinition) => formatToLocalTime(item.nextRun, { timeZoneName: "short" }, item.scheduleTimezone),
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
        columnDefinitions={columnDefinitions}
        visibleColumns={preferences.contentDisplay.filter((col) => col.visible).map((col) => col.id)}
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
            data-cy="scenarios-search"
            filteringPlaceholder="Search by name, ID, or tags"
            countText={`${filteredItemsCount} ${filteredItemsCount === 1 ? "match" : "matches"}`}
          />
        }
        header={
          <Header
            counter={`(${filteredItemsCount})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" loading={isFetching} onClick={refetch} />
                <ButtonDropdown
                  loading={isActionLoading}
                  items={[
                    {
                      text: "Edit Scenario",
                      id: "edit",
                      disabled: !selectedItems.length || selectedItems[0]?.status === "running",
                    },
                    { text: "Copy Scenario", id: "copy", disabled: !selectedItems.length },
                    {
                      text: "Cancel Test Run",
                      id: "cancel",
                      disabled: !selectedItems.length || selectedItems[0]?.status !== "running",
                    },
                    {
                      text: "Delete Scenario",
                      id: "delete",
                      disabled: !selectedItems.length || !isTerminalState(selectedItems[0]?.status),
                    },
                  ]}
                  onItemClick={(event) => {
                    const selectedScenario = selectedItems[0];
                    const { id } = event.detail;

                    if (!selectedScenario) return;

                    switch (id) {
                      case "edit":
                        sendConsoleMetric("ButtonClick", { Page: "Scenarios", Action: "EditScenario", TestId: selectedScenario.testId });
                        handleAction(() => editScenario(selectedScenario.testId));
                        break;
                      case "copy":
                        sendConsoleMetric("ButtonClick", { Page: "Scenarios", Action: "CopyScenario", TestId: selectedScenario.testId });
                        handleAction(() => copyScenario(selectedScenario.testId));
                        break;
                      case "cancel":
                        sendConsoleMetric("ButtonClick", { Page: "Scenarios", Action: "CancelTestRun", TestId: selectedScenario.testId });
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
                <Button variant="primary" onClick={() => {
                  sendConsoleMetric("ButtonClick", { Page: "Scenarios", Action: "NewScenario" });
                  navigate("/create-scenario");
                }}>
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
        scenarioName={selectedItems[0]?.testName ?? ""}
        loading={isActionLoading}
        onDismiss={() => setShowDeleteModal(false)}
        onConfirm={async () => {
          if (selectedItems[0]) {
            setIsActionLoading(true);
            try {
              await deleteScenario(selectedItems[0].testId).unwrap();
              setShowDeleteModal(false);
              sendConsoleMetric("ButtonClick", {
                Page: "Scenarios",
                Action: "DeleteScenario",
                TestId: selectedItems[0].testId,
              });
            } catch (error: any) {
              dispatch(
                addNotification({
                  id: `delete-error-${Date.now()}`,
                  type: "error",
                  content: `Failed to delete scenario: ${error?.data?.message || error?.message || "Unknown error"}`,
                }),
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
