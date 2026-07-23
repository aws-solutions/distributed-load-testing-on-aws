// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Alert, Box, Button, Modal, SpaceBetween } from "@cloudscape-design/components";
import { useState } from "react";
import type { AgentSpace } from "../../../models/agentSpace";
import { useDeregisterAgentSpaceMutation } from "../../../store/agentSpacesApiSlice";

interface RemoveAgentSpaceModalProps {
  agentSpace: AgentSpace;
  onDismiss: () => void;
  onSuccess?: () => void;
}

export default function RemoveAgentSpaceModal({ agentSpace, onDismiss, onSuccess }: RemoveAgentSpaceModalProps) {
  const [deregisterAgentSpace, { isLoading }] = useDeregisterAgentSpaceMutation();
  const [error, setError] = useState("");

  const handleRemove = async () => {
    try {
      await deregisterAgentSpace(agentSpace.id).unwrap();
      (onSuccess ?? onDismiss)();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to remove Agent Space";
      setError(message);
    }
  };

  return (
    <Modal
      visible
      header="Remove Agent Space"
      onDismiss={onDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={onDismiss}>Cancel</Button>
            <Button variant="primary" loading={isLoading} onClick={handleRemove}>
              Remove
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {error && <Alert type="error">{error}</Alert>}
        <Box>
          Are you sure you want to remove <strong>{agentSpace.displayName}</strong>? This removes the connection
          configuration. Existing investigations are not affected.
        </Box>
      </SpaceBetween>
    </Modal>
  );
}
