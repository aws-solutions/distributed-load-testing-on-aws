// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Badge, Box, Header, Link, Table } from "@cloudscape-design/components";
import { useCollection } from "@cloudscape-design/collection-hooks";
import type { Investigation } from "../../../models/investigation";
import { useListInvestigationsQuery } from "../../../store/investigationsApiSlice";

interface InvestigationsTableProps {
  testId: string;
  testRunId: string;
}

const COLUMN_DEFINITIONS = [
  {
    id: "createdAt",
    header: "Created",
    cell: (item: Investigation) => new Date(item.createdAt).toLocaleString(),
    sortingComparator: (a: Investigation, b: Investigation) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
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
    id: "executionId",
    header: "Execution ID",
    cell: (item: Investigation) => (
      <Box variant="code" fontSize="body-s">
        {item.executionId}
      </Box>
    ),
  },
  {
    id: "archived",
    header: "State",
    cell: (item: Investigation) => (item.archived ? <Badge color="grey">Archived</Badge> : <Badge color="green">Active</Badge>),
  },
];

export function InvestigationsTable({ testId, testRunId }: InvestigationsTableProps) {
  const { data: investigations = [], isLoading } = useListInvestigationsQuery({ testId, testRunId });

  const { items, collectionProps } = useCollection(investigations, {
    sorting: {
      defaultState: { sortingColumn: COLUMN_DEFINITIONS[0], isDescending: true },
    },
  });

  return (
    <Table
      {...collectionProps}
      loading={isLoading}
      loadingText="Loading investigations..."
      items={items}
      columnDefinitions={COLUMN_DEFINITIONS}
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
