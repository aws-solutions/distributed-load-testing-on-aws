// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Spinner, StatusIndicator } from "@cloudscape-design/components";
import { useListInvestigationsQuery } from "../../../store/investigationsApiSlice";

interface InvestigationCellProps {
  testId: string;
  testRunId: string;
}

/**
 * Renders investigation indicator for a test run in the TestRunsTable.
 * Shows the state of the latest investigation only:
 * - "Active" (green) — latest investigation is not archived (in-progress or completed)
 * - "Archived" (grey) — latest investigation is archived (completed+archived or canceled)
 * - "—" — no investigations exist
 */
export function InvestigationCell({ testId, testRunId }: InvestigationCellProps) {
  const { data: investigations, isLoading } = useListInvestigationsQuery({ testId, testRunId });

  if (isLoading) {
    return <Spinner size="normal" />;
  }

  if (!investigations || investigations.length === 0) {
    return <span>—</span>;
  }

  // Pick the latest investigation by creation time
  const latest = [...investigations].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0]!;

  if (!latest.archived) {
    return <StatusIndicator type="success">Active</StatusIndicator>;
  }

  return <StatusIndicator type="stopped">Archived</StatusIndicator>;
}

