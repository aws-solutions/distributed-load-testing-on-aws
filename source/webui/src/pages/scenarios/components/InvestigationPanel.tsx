// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Alert,
  Box,
  Button,
  ColumnLayout,
  ExpandableSection,
  Link,
  Modal,
  SpaceBetween,
  Spinner,
  StatusIndicator,
} from "@cloudscape-design/components";
import type React from "react";
import { useState } from "react";
import {
  useArchiveInvestigationMutation,
  useCancelInvestigationMutation,
  useGetInvestigationFindingsQuery,
} from "../../../store/investigationsApiSlice";
import { TERMINAL_STATES } from "../../../models/investigation";
import type { InvestigationStatus, InvestigationStructuredFindings } from "../../../models/investigation";
import { useInvestigationPolling } from "../hooks/useInvestigationPolling";
import { parseStructuredFindings } from "../../../utils/parseInvestigationFindings";

export interface InvestigationPanelProps {
  readonly testId: string;
  readonly testRunId: string;
}

/**
 * The Investigation Panel renders on the test-run detail page when a non-archived
 * investigation exists for the test run. It shows status, timeline, and findings
 * inside a collapsible section.
 */
export function InvestigationPanel({ testId, testRunId }: InvestigationPanelProps) {
  const [showArchiveModal, setShowArchiveModal] = useState(false);

  const { activeInvestigation, status, isStatusLoading, isStatusError, isPollingExpired } = useInvestigationPolling(
    testId,
    testRunId,
  );

  const [cancelInvestigation, { isLoading: isCanceling }] = useCancelInvestigationMutation();
  const [archiveInvestigation, { isLoading: isArchiving }] = useArchiveInvestigationMutation();

  const investigationId = activeInvestigation?.investigationId ?? "";
  const currentStatus = status?.status;
  const statusMatchesInvestigation = status?.investigationId === investigationId;
  const isCompleted = statusMatchesInvestigation && currentStatus === "COMPLETED";
  const { currentData: findingsData, isFetching: isFindingsLoading } = useGetInvestigationFindingsQuery(
    { testId, testRunId, investigationId, type: "investigation", format: "structured" },
    { skip: !isCompleted || !investigationId },
  );

  if (!activeInvestigation) {
    return null;
  }

  const { createdAt } = activeInvestigation;
  const deepLink = buildDeepLink(activeInvestigation.agentSpaceApiId, investigationId);
  const isTerminal = statusMatchesInvestigation && currentStatus ? TERMINAL_STATES.includes(currentStatus) : false;
  const structuredFindings = parseStructuredFindings(findingsData);

  const handleCancel = async () => {
    await cancelInvestigation({ testId, testRunId, investigationId });
  };

  const handleArchive = async () => {
    await archiveInvestigation({ testId, testRunId, investigationId });
    setShowArchiveModal(false);
  };

  const headerTitle = computeHeaderTitle(isCompleted, currentStatus, structuredFindings);
  const headerActions = computeHeaderActions({
    isTerminal,
    currentStatus,
    deepLink,
    handleCancel,
    isCanceling,
    isArchiving,
    onShowArchiveModal: () => setShowArchiveModal(true),
  });

  return (
    <>
      <ExpandableSection
        variant="container"
        defaultExpanded={true}
        headerText={headerTitle}
        headerActions={headerActions}
      >
        <InvestigationPanelBody
          isStatusLoading={isStatusLoading}
          status={status}
          isStatusError={isStatusError}
          isCompleted={isCompleted}
          structuredFindings={structuredFindings}
          isFindingsLoading={isFindingsLoading}
          createdAt={createdAt}
          deepLink={deepLink}
          currentStatus={currentStatus}
          isPollingExpired={isPollingExpired}
          isTerminal={isTerminal}
        />
      </ExpandableSection>

      <Modal
        visible={showArchiveModal}
        onDismiss={() => setShowArchiveModal(false)}
        header="Archive investigation"
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" onClick={() => setShowArchiveModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleArchive} loading={isArchiving}>
                Archive
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Box variant="p">
          This will archive the investigation. Findings remain accessible in the DevOps Agent console. You can start a
          new investigation afterward.
        </Box>
      </Modal>
    </>
  );
}

// ─── Header Helpers ──────────────────────────────────────────────────────────

function computeHeaderTitle(
  isCompleted: boolean,
  currentStatus: InvestigationStatus | undefined,
  structuredFindings: InvestigationStructuredFindings | null,
): string {
  if (isCompleted && structuredFindings?.findings.some((f) => f.type === "root_cause")) {
    return "Investigation (root cause found)";
  }
  if (isCompleted) return "Investigation (complete)";
  if (currentStatus === "FAILED") return "Investigation (failed)";
  if (currentStatus === "TIMED_OUT") return "Investigation (timed out)";
  if (currentStatus === "PENDING_CUSTOMER_APPROVAL") return "Investigation (awaiting approval)";
  return "Investigation (in progress)";
}

function computeHeaderActions({
  isTerminal,
  currentStatus,
  deepLink,
  handleCancel,
  isCanceling,
  isArchiving,
  onShowArchiveModal,
}: {
  isTerminal: boolean;
  currentStatus: InvestigationStatus | undefined;
  deepLink: string;
  handleCancel: () => void;
  isCanceling: boolean;
  isArchiving: boolean;
  onShowArchiveModal: () => void;
}): React.ReactNode | undefined {
  const openInAgentButton = (
    <Button href={deepLink} iconName="external" iconAlign="right" target="_blank" variant="primary">
      Open in DevOps Agent
    </Button>
  );

  if (!isTerminal) {
    return (
      <SpaceBetween size="xs" direction="horizontal">
        {openInAgentButton}
        <Button onClick={handleCancel} loading={isCanceling} variant="normal">
          Cancel investigation
        </Button>
      </SpaceBetween>
    );
  }
  if (currentStatus === "CANCELED") {
    return undefined;
  }
  return (
    <SpaceBetween size="xs" direction="horizontal">
      {openInAgentButton}
      <Button onClick={onShowArchiveModal} loading={isArchiving} variant="normal">
        Archive investigation
      </Button>
    </SpaceBetween>
  );
}

// ─── Panel Body ──────────────────────────────────────────────────────────────

function InvestigationPanelBody({
  isStatusLoading,
  status,
  isStatusError,
  isCompleted,
  structuredFindings,
  isFindingsLoading,
  createdAt,
  deepLink,
  currentStatus,
  isPollingExpired,
  isTerminal,
}: Readonly<{
  isStatusLoading: boolean;
  status: { status?: InvestigationStatus; statusReason?: string | null } | undefined;
  isStatusError: boolean;
  isCompleted: boolean;
  structuredFindings: InvestigationStructuredFindings | null;
  isFindingsLoading: boolean;
  createdAt: string;
  deepLink: string;
  currentStatus: InvestigationStatus | undefined;
  isPollingExpired: boolean;
  isTerminal: boolean;
}>) {
  if (isStatusLoading && !status) {
    return (
      <SpaceBetween size="xs" direction="horizontal" alignItems="center">
        <Spinner size="normal" />
        <Box variant="p">Loading investigation status…</Box>
      </SpaceBetween>
    );
  }

  if (isStatusError) {
    return <Alert type="error">Failed to load investigation status. Please try again later.</Alert>;
  }

  return (
    <SpaceBetween size="l">
      <InvestigationPanelContent
        isCompleted={isCompleted}
        structuredFindings={structuredFindings}
        isFindingsLoading={isFindingsLoading}
        createdAt={createdAt}
        deepLink={deepLink}
        currentStatus={currentStatus}
        statusReason={status?.statusReason}
      />
      {isPollingExpired && !isTerminal && (
        <Alert type="info">
          Auto-refresh stopped after 30 minutes. Refresh the page to resume polling.
        </Alert>
      )}
    </SpaceBetween>
  );
}

function InvestigationPanelContent({
  isCompleted,
  structuredFindings,
  isFindingsLoading,
  createdAt,
  deepLink,
  currentStatus,
  statusReason,
}: Readonly<{
  isCompleted: boolean;
  structuredFindings: InvestigationStructuredFindings | null;
  isFindingsLoading: boolean;
  createdAt: string;
  deepLink: string;
  currentStatus: InvestigationStatus | undefined;
  statusReason: string | null | undefined;
}>) {
  if (isCompleted && structuredFindings) {
    return <CompletedLayout findings={structuredFindings} createdAt={createdAt} deepLink={deepLink} />;
  }
  if (isCompleted && isFindingsLoading) {
    return (
      <SpaceBetween size="xs" direction="horizontal" alignItems="center">
        <Spinner size="normal" />
        <Box variant="p">Loading findings…</Box>
      </SpaceBetween>
    );
  }
  if (isCompleted) {
    return <CompletedNoFindingsLayout createdAt={createdAt} deepLink={deepLink} />;
  }
  return <InProgressLayout currentStatus={currentStatus} createdAt={createdAt} statusReason={statusReason} />;
}

// ─── In Progress Layout ──────────────────────────────────────────────────────

function InProgressLayout({
  currentStatus,
  createdAt,
  statusReason,
}: {
  currentStatus: InvestigationStatus | undefined;
  createdAt: string;
  statusReason: string | null | undefined;
}) {
  const isFailed = currentStatus === "FAILED" || currentStatus === "TIMED_OUT";

  return (
    <SpaceBetween size="s">
      <Box variant="h4">Investigation timeline</Box>

      <SpaceBetween size="xxs">
        <TimelineEntry type="pending" label="Investigation started" timestamp={formatTimestamp(createdAt)} />

        {isFailed ? (
          <TimelineEntry
            type="error"
            label={currentStatus === "TIMED_OUT" ? "Investigation timed out" : "Investigation failed"}
            detail={statusReason ?? undefined}
          />
        ) : currentStatus === "PENDING_CUSTOMER_APPROVAL" ? (
          <TimelineEntry type="pending" label="Awaiting approval in DevOps Agent console" />
        ) : (
          <TimelineEntry type="pending" label="DevOps Agent is analyzing infrastructure metrics, logs, and traces..." />
        )}
      </SpaceBetween>
    </SpaceBetween>
  );
}

// ─── Completed (No Findings) Layout ─────────────────────────────────────────

function CompletedNoFindingsLayout({ createdAt, deepLink }: { createdAt: string; deepLink: string }) {
  return (
    <SpaceBetween size="s">
      <Box variant="h4">Investigation timeline</Box>
      <SpaceBetween size="xxs">
        <TimelineEntry type="success" label="Investigation started" timestamp={formatTimestamp(createdAt)} />
        <TimelineEntry type="success" label="Investigation complete — no issues found" />
      </SpaceBetween>
      <Box variant="small" color="text-body-secondary">
        No root cause or anomalies were identified. For full details, open the{" "}
        <Link href={deepLink} external={true}>
          DevOps Agent console
        </Link>
        .
      </Box>
    </SpaceBetween>
  );
}

// ─── Completed Layout ────────────────────────────────────────────────────────

function CompletedLayout({
  findings,
  createdAt,
  deepLink,
}: {
  findings: InvestigationStructuredFindings;
  createdAt: string;
  deepLink: string;
}) {
  const rootCause = findings.findings.find((f) => f.type === "root_cause");
  const otherFindings = findings.findings.filter((f) => f.type !== "root_cause");
  const { symptoms, investigation_gaps: gaps } = findings;

  return (
    <SpaceBetween size="l">
      {rootCause ? (
        <ColumnLayout columns={2} variant="text-grid">
          {/* Left column: timeline */}
          <SpaceBetween size="s">
            <Box variant="h4">Investigation timeline</Box>
            <SpaceBetween size="xxs">
              <TimelineEntry type="success" label="Investigation started" timestamp={formatTimestamp(createdAt)} />
              <TimelineEntry type="success" label="Root cause identified" />
              <StatusIndicator type="info">Next step: Generate a mitigation plan</StatusIndicator>
              <Box variant="small" padding={{ left: "l" }}>
                To generate a mitigation plan, open the{" "}
                <Link href={deepLink} external={true}>
                  DevOps Agent console
                </Link>
                .
              </Box>
            </SpaceBetween>
          </SpaceBetween>

          {/* Right column: root cause */}
          <SpaceBetween size="xs">
            <Box variant="h4">Root cause</Box>
            <Box variant="p" fontWeight="bold">
              {rootCause.title}
            </Box>
            <Box variant="p" color="text-body-secondary">
              {rootCause.description}
            </Box>
          </SpaceBetween>
        </ColumnLayout>
      ) : (
        <SpaceBetween size="s">
          <Box variant="h4">Investigation timeline</Box>
          <SpaceBetween size="xxs">
            <TimelineEntry type="success" label="Investigation started" timestamp={formatTimestamp(createdAt)} />
            <TimelineEntry type="success" label="Investigation complete" />
          </SpaceBetween>
          <Box variant="small" color="text-body-secondary">
            No root cause was identified. For full details, open the{" "}
            <Link href={deepLink} external={true}>
              DevOps Agent console
            </Link>
            .
          </Box>
        </SpaceBetween>
      )}

      {/* Other findings (collapsed) */}
      {otherFindings.length > 0 && (
        <ExpandableSection headerText="Other findings" variant="footer" defaultExpanded={false}>
          <SpaceBetween size="s">
            {otherFindings.map((f) => (
              <Box key={f.id}>
                <Box variant="p" fontWeight="bold">
                  {f.title}
                </Box>
                <Box variant="small" color="text-body-secondary">
                  {f.description}
                </Box>
              </Box>
            ))}
          </SpaceBetween>
        </ExpandableSection>
      )}

      {/* Details (collapsed) */}
      {(symptoms.length > 0 || gaps.length > 0) && (
        <ExpandableSection headerText="Details" variant="footer" defaultExpanded={false}>
          <SpaceBetween size="s">
            {symptoms.length > 0 && (
              <Box>
                <Box variant="awsui-key-label">Symptoms</Box>
                {symptoms.map((s, i) => (
                  <Box key={i} padding={{ top: "xxs" }}>
                    <Box variant="p">{s.title}</Box>
                    <Box variant="small" color="text-body-secondary">
                      {s.description}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
            {gaps.length > 0 && (
              <Box>
                <Box variant="awsui-key-label">Investigation Gaps</Box>
                {gaps.map((g, i) => (
                  <Box key={i} padding={{ top: "xxs" }}>
                    <Box variant="p">{g.title}</Box>
                    <Box variant="small" color="text-body-secondary">
                      {g.description}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </SpaceBetween>
        </ExpandableSection>
      )}
    </SpaceBetween>
  );
}

// ─── Timeline Entry ──────────────────────────────────────────────────────────

function TimelineEntry({
  type,
  label,
  timestamp,
  detail,
}: {
  type: "success" | "pending" | "error";
  label: string;
  timestamp?: string;
  detail?: string;
}) {
  const indicatorType = type === "success" ? "success" : type === "error" ? "error" : "pending";
  return (
    <Box>
      <SpaceBetween size="xxs" direction="horizontal" alignItems="center">
        <StatusIndicator type={indicatorType}>
          {label}
        </StatusIndicator>
        {timestamp && (
          <Box variant="small" color="text-body-secondary">
            {timestamp}
          </Box>
        )}
      </SpaceBetween>
      {detail && (
        <Box variant="small" color="text-body-secondary" padding={{ left: "l" }}>
          {detail}
        </Box>
      )}
    </Box>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimestamp(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? "s" : ""} ago`;

    // Show full timestamp for older entries
    return date.toISOString().replace("T", ", ").replace(/\.\d{3}Z$/, " UTC");
  } catch {
    return isoDate;
  }
}

function buildDeepLink(agentSpaceResourceId: string, investigationId: string): string {
  return `https://${agentSpaceResourceId}.aidevops.global.app.aws/investigation/${investigationId}`;
}
