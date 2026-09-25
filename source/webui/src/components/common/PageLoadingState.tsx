// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Box, ContentLayout, Header, StatusIndicator } from "@cloudscape-design/components";

export interface PageLoadingStateProps {
  /** Page title rendered as the h1 heading, present during loading so the heading hierarchy is stable. */
  title: string;
  /** Optional header description; pass the loaded header's description so it doesn't pop in on load. */
  description?: string;
  /** Text shown beside the loading indicator. Defaults to "Loading...". */
  message?: string;
}

/**
 * Full-page loading state. Owns the page's ContentLayout + h1 header so the
 * heading hierarchy is present during loading (no missing-h1 gap, no layout
 * shift when data arrives) and renders a centered loading StatusIndicator.
 */
export function PageLoadingState({ title, description, message = "Loading..." }: Readonly<PageLoadingStateProps>) {
  return (
    <ContentLayout header={<Header variant="h1" description={description}>{title}</Header>}>
      <Box padding={{ vertical: "xxl" }} textAlign="center">
        <StatusIndicator type="loading">{message}</StatusIndicator>
      </Box>
    </ContentLayout>
  );
}
