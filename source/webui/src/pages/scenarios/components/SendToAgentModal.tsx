// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Alert,
  Box,
  Button,
  ExpandableSection,
  FormField,
  Grid,
  Modal,
  Select,
  SpaceBetween,
  Textarea,
  Toggle,
} from "@cloudscape-design/components";
import { colorBorderDividerDefault } from "@cloudscape-design/design-tokens";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AgentSpace } from "../../../models/agentSpace";
import type { InvestigationPriority } from "../../../models/investigation";
import type { TestRunDetails, TestResults, BaselineResponse } from "../types/testResults";

export interface SendToAgentModalProps {
  readonly visible: boolean;
  readonly onDismiss: () => void;
  readonly onSubmit: (agentSpaceId: string, additionalContext: string, priority: InvestigationPriority) => void;
  readonly isSubmitting: boolean;
  readonly testRun: TestRunDetails;
  readonly agentSpaces: AgentSpace[];
  readonly baseline?: BaselineResponse | null;
  readonly errorMessage?: string;
}

const PRIORITY_OPTIONS: { label: string; value: InvestigationPriority }[] = [
  { label: "Critical", value: "CRITICAL" },
  { label: "High", value: "HIGH" },
  { label: "Medium", value: "MEDIUM" },
  { label: "Low", value: "LOW" },
  { label: "Minimal", value: "MINIMAL" },
];

export function SendToAgentModal({
  visible,
  onDismiss,
  onSubmit,
  isSubmitting,
  testRun,
  agentSpaces,
  baseline,
  errorMessage,
}: SendToAgentModalProps) {
  const [selectedAgentSpace, setSelectedAgentSpace] = useState<string>(agentSpaces[0]?.id ?? "");
  const [additionalContext, setAdditionalContext] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
  const [priority, setPriority] = useState<InvestigationPriority>("MEDIUM");
  const errorRef = useRef<HTMLDivElement>(null);

  // The Start investigation button lives in the Modal footer, so on short
  // screens the user may be scrolled to the bottom when a submit fails. Bring
  // the error Alert into view so the feedback is never missed. Mirrors the
  // scroll-into-view convention in scrollToFirstError.ts.
  useEffect(() => {
    if (errorMessage) {
      requestAnimationFrame(() =>
        errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }, [errorMessage]);

  // Keep the selection valid as the agent spaces list loads or changes.
  // Defaults to the first space when nothing is selected or the current
  // selection no longer exists in the list.
  useEffect(() => {
    const stillExists = agentSpaces.some((space) => space.id === selectedAgentSpace);
    if (!stillExists) {
      setSelectedAgentSpace(agentSpaces[0]?.id ?? "");
    }
  }, [agentSpaces, selectedAgentSpace]);

  const agentSpaceOptions = agentSpaces.map((space) => ({
    label: space.displayName,
    value: space.id,
    description: space.agentSpaceArn,
  }));

  const handleSubmit = () => {
    if (!selectedAgentSpace) return;
    // With the toggle off the typed context is withheld rather than cleared, so
    // toggling back on does not cost the user what they wrote.
    onSubmit(selectedAgentSpace, includeContext ? additionalContext : "", priority);
  };

  const descriptionPreview = useMemo(
    () => (visible ? buildDescriptionPreview(testRun, baseline) : ""),
    [visible, testRun, baseline],
  );

  const runSummary = useMemo(() => (visible ? buildRunSummary(testRun) : null), [visible, testRun]);

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header={
        <Box variant="span" fontSize="heading-l" fontWeight="bold">
          Investigate with DevOps Agent
        </Box>
      }
      // x-large (1024px), not large (820px), so the two-column body fits without the
      // Duration row wrapping. Not "max", which stretches to the whole viewport.
      size="x-large"
      footer={
        <Box float="right">
          <SpaceBetween size="xs" direction="horizontal">
            <Button variant="link" onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              iconName="gen-ai"
              onClick={handleSubmit}
              loading={isSubmitting}
              disabled={!selectedAgentSpace}
            >
              Start investigation
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="l">
        {errorMessage && (
          <div ref={errorRef}>
            <Alert type="error">{errorMessage}</Alert>
          </div>
        )}

        {/* Run context left, choices right. Keyed off "xs" (688px) rather than "s"
            (912px) because Grid measures its own container, not the viewport, and this
            modal is narrower than 912px — an "s" rule would never apply. */}
        <Grid
          gridDefinition={[
            { colspan: { default: 12, xs: 7 } },
            { colspan: { default: 12, xs: 5 } },
          ]}
        >
          {runSummary ? (
            <SpaceBetween size="m">
              <Box variant="h3" padding={{ top: "n", bottom: "n" }}>
                {runSummary.title}
              </Box>
              <SummaryGrid groups={[runSummary.configRows, runSummary.metricRows].filter((g) => g.length > 0)} />
            </SpaceBetween>
          ) : (
            <div />
          )}

          <SpaceBetween size="l">
            <FormField label="Agent space">
              <Select
                selectedOption={agentSpaceOptions.find((o) => o.value === selectedAgentSpace) ?? null}
                onChange={({ detail }) => setSelectedAgentSpace(detail.selectedOption.value ?? "")}
                options={agentSpaceOptions}
                placeholder="Select an Agent Space"
              />
            </FormField>

            <FormField
              label="What should the agent know?"
              constraintText={
                includeContext
                  ? undefined
                  : "Not sent — turn this back on to include your text. The run summary is always sent."
              }
            >
              <SpaceBetween size="xs">
                <Textarea
                  value={additionalContext}
                  onChange={({ detail }) => setAdditionalContext(detail.value)}
                  disabled={!includeContext}
                  placeholder="Add any context about your system, SLOs, recent changes, or areas to skip..."
                  rows={6}
                />
                <Toggle checked={includeContext} onChange={({ detail }) => setIncludeContext(detail.checked)}>
                  Include my context in the investigation prompt
                </Toggle>
              </SpaceBetween>
            </FormField>

            <ExpandableSection headerText="Advanced options">
              <FormField label="Priority" description="How urgently should the agent pick this up?">
                <Select
                  selectedOption={PRIORITY_OPTIONS.find((o) => o.value === priority) ?? null}
                  onChange={({ detail }) =>
                    setPriority((detail.selectedOption.value as InvestigationPriority) ?? "MEDIUM")
                  }
                  options={PRIORITY_OPTIONS}
                />
              </FormField>
            </ExpandableSection>
          </SpaceBetween>
        </Grid>

        {/* Full width below a rule: the payload is a wide preformatted block that would
            wrap badly in a 7/12 column. Rule and section share a div so the parent
            list's gap does not stack on top of the section header's own padding. */}
        <div>
          <hr style={{ border: 0, borderTop: `1px solid ${colorBorderDividerDefault}`, margin: 0 }} />
          <ExpandableSection headerText="Payload preview">
            <Box variant="code">
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: "12px" }}>
                {descriptionPreview}
              </pre>
            </Box>
          </ExpandableSection>
        </div>
      </SpaceBetween>
    </Modal>
  );
}

interface SummaryRow {
  readonly label: string;
  readonly value: ReactNode;
}

interface RunSummary {
  readonly title: string;
  readonly configRows: SummaryRow[];
  /** Empty when the run produced no measurements. */
  readonly metricRows: SummaryRow[];
}

/**
 * Label/value list for the run context. One grid across all groups so every value
 * lines up on the same column, with a blank row between groups.
 */
function SummaryGrid({ groups }: { readonly groups: SummaryRow[][] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: "24px", rowGap: "4px" }}>
      {groups.map((rows, groupIndex) => (
        <Fragment key={rows[0].label}>
          {groupIndex > 0 && <div style={{ gridColumn: "1 / -1", height: "12px" }} />}
          {rows.map(({ label, value }) => (
            <Fragment key={label}>
              <Box variant="awsui-key-label">{label}</Box>
              <Box>{value}</Box>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Condenses the run into what a user needs to decide whether it is worth
 * investigating. Reuses buildDescriptionPreview's helpers, so the screen and the
 * payload cannot disagree.
 */
function buildRunSummary(testRun: TestRunDetails): RunSummary {
  const results = testRun.results?.["total"] ?? testRun.results?.[Object.keys(testRun.results ?? {})[0]];
  const scenarioName = testRun.testScenario?.execution?.[0]?.scenario ?? "Unknown";
  const title = buildPreviewTitle(scenarioName, testRun.status, results);

  const totalTasks = testRun.testTaskConfigs?.reduce((sum, c) => sum + c.taskCount, 0) ?? 0;
  const totalConcurrency = testRun.testTaskConfigs?.reduce((sum, c) => sum + c.concurrency, 0) ?? 0;
  const configRows: SummaryRow[] = [
    { label: "Framework", value: testRun.testType },
    { label: "Tasks / Concurrency", value: `${totalTasks} tasks, ${totalConcurrency} concurrent users` },
    { label: "Duration", value: `${testRun.startTime} to ${testRun.endTime}` },
    { label: "Regions", value: testRun.testTaskConfigs?.map((c) => c.region).join(", ") ?? "" },
  ];

  const targetUrls = extractTargetUrlsFromScenarios(testRun.testScenario?.scenarios);
  if (targetUrls.length === 0 && results?.labels) {
    extractTargetUrlsFromLabels(targetUrls, results.labels);
  }
  if (targetUrls.length > 0) {
    configRows.push({ label: "Target", value: targetUrls.join(", ") });
  }

  if (!results) {
    return { title, configRows, metricRows: [] };
  }

  const failures = Number(results.fail) || 0;
  const succ = Number(results.succ) || 0;
  const totalRequests = failures + succ;
  const metricRows: SummaryRow[] = [
    {
      label: "Total requests",
      value: `${totalRequests.toLocaleString()} (${succ.toLocaleString()} success, ${failures.toLocaleString()} failures)`,
    },
    { label: "Error rate", value: totalRequests > 0 ? `${((failures / totalRequests) * 100).toFixed(1)}%` : "N/A" },
    { label: "Avg response time", value: `${results.avg_rt}ms` },
    { label: "p99", value: `${results.p99_0}ms` },
    { label: "p99.9", value: `${results.p99_9}ms` },
  ];

  const httpErrors = rollUpHttpErrors(results);
  if (httpErrors.length > 0) {
    metricRows.push({
      label: "HTTP error codes",
      value: (
        <SpaceBetween size="xs" direction="horizontal">
          {httpErrors.map(({ code, count }) => (
            <Box key={code} variant="span">{`${count}x ${code}`}</Box>
          ))}
        </SpaceBetween>
      ),
    });
  }

  return { title, configRows, metricRows };
}

/**
 * Response codes summed across every endpoint, worst first. Counts live per label, so
 * a single-endpoint run falls back to the aggregate's own codes.
 */
function rollUpHttpErrors(results: TestResults): Array<{ code: string; count: number }> {
  const codeCounts = new Map<string, number>();
  const sources = results.labels?.length ? results.labels : [results];
  for (const source of sources) {
    for (const rc of source.rc ?? []) {
      codeCounts.set(rc.code, (codeCounts.get(rc.code) ?? 0) + rc.count);
    }
  }
  return [...codeCounts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
}

/**
 * Builds a neutral, data-driven preview title that mirrors the server-side
 * `buildTitle` logic. It describes the observed outcome without asserting a
 * "regression" — DLT does not compare this run against a baseline here. A
 * failed run takes precedence over request-level counts so a failed run is
 * never labeled "healthy".
 */
function buildPreviewTitle(scenarioName: string, status: string | undefined, results: TestResults | undefined): string {
  if (status === "failed") {
    return `${scenarioName} — test run failed`;
  }

  const fail = Number(results?.fail) || 0;
  const succ = Number(results?.succ) || 0;
  const totalReqs = fail + succ;

  if (totalReqs > 0) {
    const failRate = Math.round((fail / totalReqs) * 100);
    return failRate === 0
      ? `${scenarioName} — healthy (${totalReqs} req)`
      : `${scenarioName} — ${failRate}% failed (${totalReqs} req)`;
  }
  return `${scenarioName} — investigation requested`;
}

/**
 * Formats a percentage delta between current and baseline values with a directional indicator.
 */
function formatDelta(current: number, base: number, higherIsWorse: boolean): string {
  if (!base) return "";
  const pct = Math.round(((current - base) / base) * 100);
  const sign = pct > 0 ? "+" : "";
  const indicator = computeDeltaIndicator(pct, higherIsWorse);
  return ` (${sign}${pct}%${indicator})`;
}

/**
 * Returns the directional indicator emoji for a percentage delta.
 */
function computeDeltaIndicator(pct: number, higherIsWorse: boolean): string {
  if (pct === 0) return "";
  if (higherIsWorse) {
    return pct > 0 ? " ⚠️" : " ✓";
  }
  return pct < 0 ? " ⚠️" : " ✓";
}

/**
 * Builds a human-readable preview of the description payload that will be sent to DevOps Agent.
 */
function buildDescriptionPreview(testRun: TestRunDetails, baseline?: BaselineResponse | null): string {
  const results = testRun.results?.["total"] ?? testRun.results?.[Object.keys(testRun.results)[0]];
  const scenarioName = testRun.testScenario?.execution?.[0]?.scenario ?? "Unknown";
  const total = (results?.succ ?? 0) + (results?.fail ?? 0);
  const errorRate = results && total > 0 ? `${((results.fail / total) * 100).toFixed(1)}%` : "N/A";

  const lines: string[] = [];

  lines.push(`Title: ${buildPreviewTitle(scenarioName, testRun.status, results)}`);
  lines.push("");
  appendTestConfiguration(lines, testRun);
  appendTargetUrls(lines, testRun, results);
  lines.push("");

  if (results) {
    appendAggregateResults(lines, results, errorRate);
  }

  appendBaselineComparison(lines, results, baseline, testRun.testRunId);
  appendEndpointBreakdown(lines, results);

  return lines.join("\n");
}

function appendTestConfiguration(lines: string[], testRun: TestRunDetails): void {
  lines.push("Test Configuration:");
  lines.push(`  - Framework: ${testRun.testType}`);

  const totalTasks = testRun.testTaskConfigs?.reduce((sum, c) => sum + c.taskCount, 0) ?? 0;
  const totalConcurrency = testRun.testTaskConfigs?.reduce((sum, c) => sum + c.concurrency, 0) ?? 0;
  lines.push(`  - Tasks: ${totalTasks}, Concurrency: ${totalConcurrency}`);
  lines.push(`  - Duration: ${testRun.startTime} to ${testRun.endTime}`);

  const regions = testRun.testTaskConfigs?.map((c) => c.region).join(", ") ?? "";
  lines.push(`  - Regions: ${regions}`);
}

function appendTargetUrls(lines: string[], testRun: TestRunDetails, results: TestResults | undefined): void {
  const targetUrls = extractTargetUrlsFromScenarios(testRun.testScenario?.scenarios);
  if (targetUrls.length === 0 && results?.labels) {
    extractTargetUrlsFromLabels(targetUrls, results.labels);
  }
  if (targetUrls.length > 0) {
    lines.push(`  - Target: ${targetUrls.join(", ")}`);
  }
}

function extractTargetUrlsFromScenarios(
  scenariosObj: Record<string, unknown> | undefined,
): string[] {
  const urls: string[] = [];
  if (!scenariosObj || typeof scenariosObj !== "object") return urls;
  for (const name of Object.keys(scenariosObj)) {
    const requests = (scenariosObj as Record<string, { requests?: Array<{ url?: string }> }>)[name]?.requests;
    if (!Array.isArray(requests)) continue;
    for (const req of requests) {
      if (req.url) urls.push(req.url);
    }
  }
  return urls;
}

function extractTargetUrlsFromLabels(targetUrls: string[], labels: Array<{ label?: string }>): void {
  for (const label of labels) {
    const labelUrl = label.label ?? "";
    if (!labelUrl.startsWith("http://") && !labelUrl.startsWith("https://")) continue;
    try {
      const parsed = new URL(labelUrl);
      const baseUrl = `${parsed.protocol}//${parsed.host}`;
      if (!targetUrls.includes(baseUrl)) targetUrls.push(baseUrl);
    } catch { /* ignore */ }
  }
}

function appendAggregateResults(lines: string[], results: TestResults, errorRate: string): void {
  lines.push("Aggregate Results:");
  lines.push(`  - Total requests: ${results.succ + results.fail} (${results.succ} success, ${results.fail} failures)`);
  lines.push(`  - Error rate: ${errorRate}`);
  lines.push(`  - Avg response time: ${results.avg_rt}ms`);
  lines.push(`  - p99: ${results.p99_0}ms`);
  lines.push(`  - p99.9: ${results.p99_9}ms`);
  lines.push("");
}

function appendBaselineComparison(
  lines: string[],
  results: TestResults | undefined,
  baseline: BaselineResponse | null | undefined,
  testRunId: string,
): void {
  const baselineResults = baseline?.testRunDetails?.results?.["total"];
  if (!results || !baselineResults || !baseline?.baselineId || baseline.baselineId === testRunId) return;

  lines.push(`Baseline Comparison (vs run ${baseline.baselineId}):`);
  if (results.avg_rt && baselineResults.avg_rt) {
    const cur = Math.round(Number(results.avg_rt));
    const base = Math.round(Number(baselineResults.avg_rt));
    lines.push(`  - Avg RT: ${cur}ms vs ${base}ms${formatDelta(cur, base, true)}`);
  }
  if (results.p99_0 && baselineResults.p99_0) {
    const cur = Math.round(Number(results.p99_0));
    const base = Math.round(Number(baselineResults.p99_0));
    lines.push(`  - P99: ${cur}ms vs ${base}ms${formatDelta(cur, base, true)}`);
  }
  const curFail = Number(results.fail) || 0;
  const baseFail = Number(baselineResults.fail) || 0;
  if (curFail > 0 || baseFail > 0) {
    lines.push(`  - Failed: ${curFail} vs ${baseFail}${formatDelta(curFail, baseFail, true)}`);
  }
  lines.push("");
}

function appendEndpointBreakdown(lines: string[], results: TestResults | undefined): void {
  if (!results?.labels || results.labels.length === 0) return;

  lines.push("Per-Endpoint Breakdown:");
  lines.push(`  ${"Endpoint".padEnd(50)} ${"Requests".padStart(10)} ${"Failures".padStart(10)} ${"Avg RT".padStart(10)} ${"p99".padStart(10)}`);

  const sortedLabels = [...results.labels].sort((a, b) => b.fail - a.fail);
  const topLabels = sortedLabels.slice(0, 10);

  for (const label of topLabels) {
    lines.push(
      `  ${String(label.label).padEnd(50)} ${String(label.succ + label.fail).padStart(10)} ${String(label.fail).padStart(10)} ${String(label.avg_rt).padStart(10)} ${String(label.p99_0).padStart(10)}`,
    );
  }

  if (sortedLabels.length > 10) {
    lines.push(`  ... and ${sortedLabels.length - 10} more endpoints`);
  }
  lines.push("");

  appendTopFailureDetails(lines, sortedLabels);
}

function appendTopFailureDetails(lines: string[], sortedLabels: TestResults["labels"]): void {
  const topFailing = sortedLabels.find((l) => l.fail > 0);
  if (!topFailing) return;

  lines.push(`Failure Details (${topFailing.label}):`);
  if (topFailing.rc) {
    for (const rc of topFailing.rc) {
      lines.push(`  ${rc.count}x HTTP ${rc.code}`);
    }
  }
  lines.push("");

  lines.push("Note:");
  lines.push(
    `  ${topFailing.label} has the highest failure count (${topFailing.fail} of ${topFailing.succ + topFailing.fail} requests). The agent will analyze all endpoints, not just failures.`,
  );
}
