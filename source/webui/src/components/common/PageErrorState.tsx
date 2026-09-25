// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Alert, Button, ContentLayout, Header, SpaceBetween } from "@cloudscape-design/components";
import { ReactNode } from "react";

export interface PageErrorAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "normal" | "link";
}

export interface PageErrorStateProps {
  /** Page title rendered as the h1 heading, present in the error state so the heading hierarchy is stable. */
  title: string;
  /** Error message body. */
  message: ReactNode;
  /** Alert severity. Defaults to "error"; "warning" for recoverable/in-progress cases. */
  alertType?: "error" | "warning";
  /** Action buttons rendered below the alert (e.g. Retry, Back). Pass an empty array for none. */
  actions?: PageErrorAction[];
}

/**
 * Full-page error state. Owns the page's ContentLayout + h1 header so the
 * heading hierarchy is present in error states, and renders an Alert with an
 * optional row of action buttons.
 */
export function PageErrorState({ title, message, alertType = "error", actions = [] }: Readonly<PageErrorStateProps>) {
  return (
    <ContentLayout header={<Header variant="h1">{title}</Header>}>
      <SpaceBetween size="m">
        <Alert type={alertType}>{message}</Alert>
        {actions.length > 0 && (
          <SpaceBetween size="xs" direction="horizontal">
            {actions.map((action, index) => (
              <Button key={index} variant={action.variant ?? "normal"} onClick={action.onClick}>
                {action.label}
              </Button>
            ))}
          </SpaceBetween>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
