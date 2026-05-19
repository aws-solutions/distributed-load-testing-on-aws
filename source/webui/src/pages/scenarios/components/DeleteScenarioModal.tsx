// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Box, Button, Modal, SpaceBetween } from "@cloudscape-design/components";

interface DeleteScenarioModalProps {
  visible: boolean;
  scenarioName: string;
  loading: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}

export function DeleteScenarioModal({ visible, scenarioName, loading, onDismiss, onConfirm }: DeleteScenarioModalProps) {
  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Delete scenario"
      closeAriaLabel="Close modal"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              data-testid="confirm-delete-btn"
              data-cy="confirm-delete-btn"
              variant="primary"
              loading={loading}
              onClick={onConfirm}
            >
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <p>
          Are you sure you want to delete the scenario &quot;{scenarioName}&quot;? This action cannot be undone.
        </p>
        <p>
          <strong>Note:</strong> Only database records will be deleted. Results and logs in S3 are preserved and must be
          manually deleted if needed.{" "}
          <a
            href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/uninstall-the-solution.html#deleting-the-amazon-s3-buckets"
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn more
          </a>
        </p>
      </SpaceBetween>
    </Modal>
  );
}
