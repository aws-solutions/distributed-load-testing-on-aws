// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Alert,
  Box,
  Button,
  FormField,
  Input,
  Modal,
  SpaceBetween,
  StatusIndicator,
} from "@cloudscape-design/components";
import { useEffect, useState } from "react";
import type { AgentSpace } from "../../../models/agentSpace";
import {
  useListAgentSpacesQuery,
  useRegisterAgentSpaceMutation,
  useTestConnectionMutation,
  useUpdateAgentSpaceMutation,
} from "../../../store/agentSpacesApiSlice";

const ARN_REGEX = /^arn:aws:aidevops:[a-z0-9-]+:\d{12}:agentspace\/[a-zA-Z0-9-]{1,64}$/;

interface AgentSpaceModalProps {
  mode: "add" | "edit";
  agentSpace?: AgentSpace;
  onDismiss: () => void;
  onSuccess?: () => void;
}

export default function AgentSpaceModal({ mode, agentSpace, onDismiss, onSuccess }: AgentSpaceModalProps) {
  const [displayName, setDisplayName] = useState(agentSpace?.displayName ?? "");
  const [arn, setArn] = useState(agentSpace?.agentSpaceArn ?? "");
  const [arnError, setArnError] = useState("");
  const [nameError, setNameError] = useState("");
  const [connectionVerified, setConnectionVerified] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const { data: existingSpaces = [] } = useListAgentSpacesQuery();
  const [testConnection, { isLoading: isTesting }] = useTestConnectionMutation();
  const [registerAgentSpace, { isLoading: isRegistering }] = useRegisterAgentSpaceMutation();
  const [updateAgentSpace, { isLoading: isUpdating }] = useUpdateAgentSpaceMutation();

  const isSaving = isRegistering || isUpdating;
  const isDirty = displayName !== (agentSpace?.displayName ?? "") || (mode === "add" && arn !== "") || connectionVerified;

  const canTestConnection = mode === "add" && arn.trim().length > 0 && !connectionVerified;
  const canSave = mode === "edit"
    ? displayName.trim().length > 0 && displayName !== agentSpace?.displayName
    : displayName.trim().length > 0 && connectionVerified;

  useEffect(() => {
    setConnectionVerified(false);
    setArnError("");
  }, [arn]);

  const handleTestConnection = async () => {
    if (!ARN_REGEX.test(arn.trim())) {
      setArnError("Invalid ARN format. Example: arn:aws:aidevops:us-east-1:123456789012:agentspace/my-space");
      return;
    }

    const duplicate = existingSpaces.find((s) => s.agentSpaceArn === arn.trim() && s.id !== agentSpace?.id);
    if (duplicate) {
      setArnError("An Agent Space with this ARN is already registered");
      return;
    }

    setArnError("");

    try {
      const results = await testConnection({ agentSpaceArns: [arn.trim()] }).unwrap();
      if (results[0]?.status === "connected") {
        setConnectionVerified(true);
      } else {
        setArnError(results[0]?.message ?? "Connection failed");
      }
    } catch (err: unknown) {
      const message = typeof err === "object" && err !== null && "data" in err
        ? String((err as { data: unknown }).data)
        : err instanceof Error ? err.message : "Connection test failed";
      setArnError(message);
    }
  };

  const handleSave = async () => {
    setSaveError("");

    if (displayName.trim().length === 0) {
      setNameError("Display name is required");
      return;
    }
    if (displayName.trim().length > 64) {
      setNameError("Display name must be 64 characters or fewer");
      return;
    }

    try {
      if (mode === "add") {
        await registerAgentSpace({ displayName: displayName.trim(), agentSpaceArn: arn.trim() }).unwrap();
      } else if (agentSpace) {
        await updateAgentSpace({ id: agentSpace.id, displayName: displayName.trim() }).unwrap();
      }
      (onSuccess ?? onDismiss)();
    } catch (err: unknown) {
      const message = typeof err === "object" && err !== null && "data" in err
        ? String((err as { data: unknown }).data)
        : err instanceof Error ? err.message : "Failed to save";
      setSaveError(message);
    }
  };

  const handleDismiss = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onDismiss();
    }
  };

  if (showDiscardConfirm) {
    return (
      <Modal
        visible
        header="Discard changes?"
        onDismiss={() => setShowDiscardConfirm(false)}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setShowDiscardConfirm(false)}>Keep editing</Button>
              <Button variant="primary" onClick={onDismiss}>Discard</Button>
            </SpaceBetween>
          </Box>
        }
      >
        You have unsaved changes. Are you sure you want to discard them?
      </Modal>
    );
  }

  return (
    <Modal
      visible
      header={mode === "add" ? "Register Agent Space" : "Edit Agent Space"}
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={handleDismiss}>Cancel</Button>
            <Button variant="primary" disabled={!canSave || isSaving} loading={isSaving} onClick={handleSave}>
              Save
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="l">
        {saveError && <Alert type="error">{saveError}</Alert>}

        {mode === "add" && (
          <Alert type="info">
            Your Agent Space must be tagged with <strong>dlt-integration: allowed</strong> before it can be registered.
          </Alert>
        )}

        <FormField
          label="Display name"
          errorText={nameError}
        >
          <Input
            value={displayName}
            onChange={({ detail }) => { setDisplayName(detail.value); setNameError(""); }}
            placeholder="My Agent Space"
          />
        </FormField>

        {mode === "add" ? (
          <FormField
            label="Agent Space ARN"
            errorText={arnError}
            description="The ARN of the Agent Space in your AWS account"
          >
            <SpaceBetween direction="horizontal" size="xs">
              <Box display="block" padding={{ right: "xs" }}>
                <Input
                  value={arn}
                  onChange={({ detail }) => setArn(detail.value)}
                  placeholder="arn:aws:aidevops:us-east-1:123456789012:agentspace/my-space"
                />
              </Box>
              <Button
                disabled={!canTestConnection || isTesting}
                loading={isTesting}
                onClick={handleTestConnection}
              >
                Test Connection
              </Button>
            </SpaceBetween>
          </FormField>
        ) : (
          <FormField label="Agent Space ARN">
            <Input value={agentSpace?.agentSpaceArn ?? ""} disabled />
          </FormField>
        )}

        {connectionVerified && (
          <StatusIndicator type="success">Connection verified</StatusIndicator>
        )}
      </SpaceBetween>
    </Modal>
  );
}
