// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Badge, Box, Header, Link, Spinner, StatusIndicator, Table } from "@cloudscape-design/components";
import { useCollection } from "@cloudscape-design/collection-hooks";
import { useEffect, useState } from "react";
import type { Investigation } from "../../../models/investigation";
import { InvestigationStatus, TERMINAL_STATES } from "../../../models/investigation";
import { useGetInvestigationStatusQuery, useListInvestigationsQuery } from "../../../store/investigationsApiSlice";
import { StatusIndicatorType, type StatusConfig } from "../constants";

interface InvestigationsTableProps {
  testId: string;
  testRunId: string;
}

/** How often to re-check a row whose investigation is still running. */
const STATUS_POLLING_INTERVAL_MS = 10_000;

/**
 * Maps each DevOps Agent investigation status onto a Cloudscape indicator and a
 * human-readable label. CANCELED is STOPPED rather than ERROR because
 * cancellation is a deliberate user action, not a failure.
 */
export const INVESTIGATION_STATUS_INDICATOR_MAP: Record<InvestigationStatus, StatusConfig> = {
  [InvestigationStatus.PENDING_TRIAGE]: { type: StatusIndicatorType.PENDING, label: "Pending triage" },
  [InvestigationStatus.LINKED]: { type: StatusIndicatorType.PENDING, label: "Linked" },
  [InvestigationStatus.PENDING_START]: { type: StatusIndicatorType.PENDING, label: "Pending start" },
  [InvestigationStatus.IN_PROGRESS]: { type: StatusIndicatorType.IN_PROGRESS, label: "In progress" },
  [InvestigationStatus.PENDING_CUSTOMER_APPROVAL]: { type: StatusIndicatorType.PENDING, label: "Awaiting approval" },
  [InvestigationStatus.COMPLETED]: { type: StatusIndicatorType.SUCCESS, label: "Completed" },
  [InvestigationStatus.FAILED]: { type: StatusIndicatorType.ERROR, label: "Failed" },
  [InvestigationStatus.TIMED_OUT]: { type: StatusIndicatorType.ERROR, label: "Timed out" },
  [InvestigationStatus.CANCELED]: { type: StatusIndicatorType.STOPPED, label: "Canceled" },
};

/**
 * The API forwards whatever status DevOps Agent reports, including values this UI
 * has never heard of, so an unmapped status must render rather than throw. Mirrors
 * getStatusConfig's fallback for test statuses.
 */
export const getInvestigationStatusConfig = (status: InvestigationStatus): StatusConfig =>
  INVESTIGATION_STATUS_INDICATOR_MAP[status] ?? { type: StatusIndicatorType.INFO, label: status };

/**
 * Status cell for one investigation row.
 *
 * The list endpoint does not return a status, so each row reads its own live
 * status. Polling is limited to rows that can still change — an archived row,
 * or one already in a terminal state, is fetched once and left alone.
 */
export function InvestigationStatusCell({
  testId,
  testRunId,
  investigation,
}: {
  readonly testId: string;
  readonly testRunId: string;
  readonly investigation: Investigation;
}) {
  // Once a row has been seen in a terminal state it can never change again, so
  // latch that and drop the polling interval. Kept in state (not a ref) so the
  // latch triggers the re-render that actually stops the poll.
  const [reachedTerminal, setReachedTerminal] = useState(false);
  const shouldPoll = !investigation.archived && !reachedTerminal;

  const { data, isLoading, isError } = useGetInvestigationStatusQuery(
    { testId, testRunId, investigationId: investigation.investigationId },
    { pollingInterval: shouldPoll ? STATUS_POLLING_INTERVAL_MS : undefined }
  );

  useEffect(() => {
    if (data?.status && TERMINAL_STATES.includes(data.status)) {
      setReachedTerminal(true);
    }
  }, [data?.status]);

  if (isLoading) {
    return <Spinner size="normal" />;
  }

  if (isError || !data?.status) {
    return <StatusIndicator type="warning">Unavailable</StatusIndicator>;
  }

  const { type, label } = getInvestigationStatusConfig(data.status);
  return <StatusIndicator type={type}>{label}</StatusIndicator>;
}

/**
 * Takes the ids because the Status cell fetches its own status; everything else
 * about the list is static.
 */
const COLUMN_DEFINITIONS = (testId: string, testRunId: string) => [
  {
    id: "createdAt",
    header: "Created",
    cell: (item: Investigation) => new Date(item.createdAt).toLocaleString(),
    sortingComparator: (a: Investigation, b: Investigation) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  },
  {
    id: "agentSpaceName",
    header: "Agent Space",
    cell: (item: Investigation) => item.agentSpaceName,
    sortingField: "agentSpaceName",
  },
  {
    id: "investigationId",
    header: "Investigation ID",
    cell: (item: Investigation) => {
      const url = `https://${item.agentSpaceApiId}.aidevops.global.app.aws/investigation/${item.investigationId}`;
      return (
        <Link href={url} external>
          <Box variant="code" fontSize="body-s">
            {item.investigationId}
          </Box>
        </Link>
      );
    },
  },
  {
    id: "status",
    header: "Status",
    cell: (item: Investigation) => (
      <InvestigationStatusCell testId={testId} testRunId={testRunId} investigation={item} />
    ),
  },
  {
    id: "archived",
    header: "State",
    cell: (item: Investigation) =>
      item.archived ? <Badge color="grey">Archived</Badge> : <Badge color="green">Active</Badge>,
  },
];

export function InvestigationsTable({ testId, testRunId }: InvestigationsTableProps) {
  const { data: investigations = [], isLoading } = useListInvestigationsQuery({ testId, testRunId });
  const columnDefinitions = COLUMN_DEFINITIONS(testId, testRunId);

  const { items, collectionProps } = useCollection(investigations, {
    sorting: {
      defaultState: { sortingColumn: columnDefinitions[0], isDescending: true },
    },
  });

  return (
    <Table
      {...collectionProps}
      loading={isLoading}
      loadingText="Loading investigations..."
      items={items}
      columnDefinitions={columnDefinitions}
      header={
        <Header
          counter={`(${investigations.length})`}
          description="Investigations triggered from this test run via AWS DevOps Agent"
        >
          Investigations
        </Header>
      }
      empty={
        <Box textAlign="center" padding={{ vertical: "s" }}>
          <Box color="text-body-secondary">No investigations for this test run</Box>
        </Box>
      }
    />
  );
}
