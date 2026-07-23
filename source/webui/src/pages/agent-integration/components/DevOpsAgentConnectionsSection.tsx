// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Box,
  Button,
  ButtonDropdown,
  Header,
  Link,
  SpaceBetween,
  Table,
} from "@cloudscape-design/components";
import { useState } from "react";
import type { AgentSpace } from "../../../models/agentSpace";
import { useListAgentSpacesQuery } from "../../../store/agentSpacesApiSlice";
import AgentSpaceModal from "./AgentSpaceModal";
import RemoveAgentSpaceModal from "./RemoveAgentSpaceModal";


export default function DevOpsAgentConnectionsSection() {
  const { data: agentSpaces = [], isLoading } = useListAgentSpacesQuery();
  const [selectedItems, setSelectedItems] = useState<AgentSpace[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);

  const selectedSpace = selectedItems[0] ?? null;

  return (
    <>
      <Table
        loading={isLoading}
        loadingText="Loading Agent Spaces..."
        items={agentSpaces}
        selectionType="single"
        selectedItems={selectedItems}
        onSelectionChange={({ detail }) => setSelectedItems(detail.selectedItems as AgentSpace[])}
        columnDefinitions={[
          {
            id: "displayName",
            header: "Name",
            cell: (item) => item.displayName,
            sortingField: "displayName",
          },
          {
            id: "agentSpaceArn",
            header: "ARN",
            cell: (item) => {
              const arnParts = item.agentSpaceArn.split(":");
              const region = arnParts[3];
              const agentSpaceId = item.agentSpaceArn.split("/").pop();
              const consoleUrl = `https://${region}.console.aws.amazon.com/aidevops/home?region=${region}#/agent-spaces/${agentSpaceId}`;
              return <Link href={consoleUrl} external>{item.agentSpaceArn}</Link>;
            },
          },
          {
            id: "createdAt",
            header: "Registered",
            cell: (item) => new Date(item.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
            sortingField: "createdAt",
          },
          {
            id: "updatedAt",
            header: "Last Updated",
            cell: (item) => item.updatedAt
              ? new Date(item.updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
              : "—",
            sortingField: "updatedAt",
          },
        ]}
        header={
          <Header
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <ButtonDropdown
                  disabled={!selectedSpace}
                  items={[
                    { id: "edit", text: "Edit" },
                    { id: "remove", text: "Remove" },
                  ]}
                  onItemClick={({ detail }) => {
                    if (detail.id === "edit") setShowEditModal(true);
                    if (detail.id === "remove") setShowRemoveModal(true);
                  }}
                >
                  Actions
                </ButtonDropdown>
                <Button variant="primary" onClick={() => setShowAddModal(true)}>
                  Register Agent Space
                </Button>
              </SpaceBetween>
            }
          description="AWS DevOps Agent proactively finds bottlenecks, identifies root causes for failures, and suggests modifications for your load tests. Register an Agent Space to enable automated post-test analysis."
          >
            DevOps Agent Connections
          </Header>
        }
        empty={
          <Box textAlign="center" padding={{ vertical: "l" }}>
            <SpaceBetween size="m">
              <Box variant="h3">No Agent Spaces Registered</Box>
              <Link href="https://docs.aws.amazon.com/devopsagent/latest/userguide/what-is.html" external>
                Learn more about AWS DevOps Agent
              </Link>
            </SpaceBetween>
          </Box>
        }
      />

      {showAddModal && <AgentSpaceModal mode="add" onDismiss={() => setShowAddModal(false)} />}

      {showEditModal && selectedSpace && (
        <AgentSpaceModal
          mode="edit"
          agentSpace={selectedSpace}
          onDismiss={() => setShowEditModal(false)}
          onSuccess={() => { setShowEditModal(false); setSelectedItems([]); }}
        />
      )}

      {showRemoveModal && selectedSpace && (
        <RemoveAgentSpaceModal
          agentSpace={selectedSpace}
          onDismiss={() => setShowRemoveModal(false)}
          onSuccess={() => { setShowRemoveModal(false); setSelectedItems([]); }}
        />
      )}
    </>
  );
}
