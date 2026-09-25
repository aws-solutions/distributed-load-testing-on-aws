// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Box, Button, SpaceBetween } from "@cloudscape-design/components";
import { ReactNode } from "react";

export interface EmptyStateProps {
  /** Primary line, e.g. "No test scenarios". */
  title: string;
  /** Secondary explanatory line. */
  message: ReactNode;
  /** Optional primary call-to-action button. */
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Empty state for content that already sits inside a page frame (e.g. a Table's
 * `empty` slot, below an existing h1). Deliberately does NOT render page chrome
 * — it is a mid-content component, unlike the page-level loading/error states.
 */
export function EmptyState({ title, message, primaryAction }: Readonly<EmptyStateProps>) {
  return (
    <Box textAlign="center" padding={{ vertical: "l" }}>
      <SpaceBetween size="s">
        <Box variant="strong">{title}</Box>
        <Box variant="p" color="text-body-secondary">
          {message}
        </Box>
        {primaryAction && (
          <Button variant="primary" onClick={primaryAction.onClick}>
            {primaryAction.label}
          </Button>
        )}
      </SpaceBetween>
    </Box>
  );
}
