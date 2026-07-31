// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Alert,
  Box,
  Button,
  Container,
  FormField,
  Header,
  Modal,
  Select,
  SpaceBetween,
  Textarea,
} from "@cloudscape-design/components";
import { useEffect, useMemo, useRef, useState } from "react";
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
    onSubmit(selectedAgentSpace, additionalContext, priority);
  };

  const descriptionPreview = useMemo(
    () => (visible ? buildDescriptionPreview(testRun, baseline) : ""),
    [visible, testRun, baseline],
  );

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header="Send to DevOps Agent"
      size="large"
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

        {/* Investigation Focus — read-only summary */}
        <Container
          header={
            <Header variant="h3" description="A summary of the test run that DLT will send to the agent.">
              Investigation Focus
            </Header>
          }
        >
          <SpaceBetween size="xs">
            <Box padding={{ top: "s" }}>
              <Box variant="code">
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: "12px" }}>
                  {descriptionPreview}
                </pre>
              </Box>
            </Box>
          </SpaceBetween>
        </Container>

        {/* Configuration */}
        <Container header={<Header variant="h3">Configuration</Header>}>
          <SpaceBetween size="m">
            <FormField
              label="DevOps Agent Instance"
              description="Which agent instance should investigate this run?"
            >
              <Select
                selectedOption={agentSpaceOptions.find((o) => o.value === selectedAgentSpace) ?? null}
                onChange={({ detail }) => setSelectedAgentSpace(detail.selectedOption.value ?? "")}
                options={agentSpaceOptions}
                placeholder="Select an Agent Space"
              />
            </FormField>

            <FormField
              label="Investigation context"
              description="Help the agent understand your system and focus the investigation."
              constraintText="Optional. Include any combination of: system architecture, SLOs or thresholds, recent changes, known issues, or areas to skip."
            >
              <Textarea
                value={additionalContext}
                onChange={({ detail }) => setAdditionalContext(detail.value)}
                placeholder="e.g., This is a payments API backed by DynamoDB and SQS. P99 target is <500ms. We deployed v2.4 thirty minutes before this test (changed connection pool from 50 to 25). Ignore DNS latency spikes — our provider has a known issue."
                rows={4}
              />
            </FormField>

            <FormField
              label="Priority"
              description="Select the investigation priority."
            >
              <Select
                selectedOption={PRIORITY_OPTIONS.find((o) => o.value === priority) ?? null}
                onChange={({ detail }) => setPriority((detail.selectedOption.value as InvestigationPriority) ?? "MEDIUM")}
                options={PRIORITY_OPTIONS}
              />
            </FormField>
          </SpaceBetween>
        </Container>
      </SpaceBetween>
    </Modal>
  );
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
