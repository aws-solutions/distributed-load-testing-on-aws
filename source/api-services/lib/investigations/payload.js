// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Pure functions that build the description payload for CreateBacklogTask.
 * No side effects, no I/O — easy to test and reason about.
 */

const MAX_DESCRIPTION_LENGTH = 10000;
const TRUNCATION_NOTICE = "\n\n(truncated — full breakdown in DLT console)";
const TRUNCATION_RESERVE = TRUNCATION_NOTICE.length;

/** Max number of target URLs to list before summarizing the remainder. */
const MAX_TARGET_URLS = 5;

/**
 * Pre-configured context injected into the investigation description when
 * a test run has status "failed". Guides the DevOps Agent toward DLT
 * infrastructure as the root cause rather than the target application.
 */
const INFRA_FAILURE_GUIDANCE = [
  `## Investigation Guidance`,
  ``,
  `This test run has status "failed", which means the DLT infrastructure itself encountered a problem executing the load test. The target application under test is NOT necessarily at fault.`,
  ``,
  `**Investigate the DLT infrastructure**, not the target system. Common root causes include:`,
  `- ECS Fargate tasks failing to start, crashing mid-test, or running out of memory (OOM kills)`,
  `- ECS service stabilization failures (containers could not reach healthy state)`,
  `- Task completion timeout (tasks did not report back within the deadline)`,
  `- Task threshold breach (too many tasks failed relative to the healthy threshold)`,
  `- Step Functions execution failures or state machine errors`,
  `- Insufficient ECS capacity or vCPU service quota limits`,
  `- Network connectivity issues between DLT components (ECS tasks, S3, DynamoDB)`,
  `- Container image pull failures or ECR access issues`,
  `- Results not uploaded to S3 (no result files found after task execution)`,
  ``,
  `**Key resources to check:** ECS cluster and service events, CloudWatch Logs for the task containers, Step Functions execution history, and the S3 results bucket for missing output files.`,
].join("\n");

/**
 * Converts a response time value (in seconds, possibly a string) to milliseconds.
 * @param {string|number|null|undefined} val
 * @returns {number|null}
 */
const toMs = (val) => (val != null ? Math.round(parseFloat(val) * 1000) : null);

/**
 * Formats a duration in seconds into a human-readable string.
 * @param {number} seconds
 * @returns {string}
 */
const formatDuration = (seconds) => {
  if (seconds == null) return "N/A";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
};

/**
 * Computes duration in seconds from start and end time strings.
 * @param {string} startTime
 * @param {string} endTime
 * @returns {number|null}
 */
const computeDurationFromTimes = (startTime, endTime) => {
  if (!startTime || !endTime) return null;
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  return Math.round((end - start) / 1000);
};

/**
 * Safely parses a value that may be a JSON string, an object, or absent.
 * Returns null on absent or malformed input rather than throwing.
 * @param {unknown} value
 * @returns {object|null}
 */
const safeParse = (value) => {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/**
 * Builds a section describing per-endpoint results, sorted by error count then response time.
 * @param {Array} endpoints - Array of endpoint result objects.
 * @param {number} budget - Max character budget for this section.
 * @returns {string}
 */
const buildEndpointSection = (endpoints, budget) => {
  if (!endpoints || endpoints.length === 0) return "";

  // Sort by fail count descending, then avg response time descending
  const sorted = [...endpoints].sort((a, b) => {
    const errDiff = (b.fail || 0) - (a.fail || 0);
    if (errDiff !== 0) return errDiff;
    return (parseFloat(b.avg_rt) || 0) - (parseFloat(a.avg_rt) || 0);
  });

  let section = "\n\n## Per-Endpoint Breakdown\n";
  let truncated = false;

  for (const ep of sorted) {
    const line = `\n- **${ep.label || ep.url || ep.endpoint || "unknown"}** — ` +
      `avg ${toMs(ep.avg_rt) || 0}ms, ` +
      `p50 ${toMs(ep.p50_0) || "N/A"}ms, p90 ${toMs(ep.p90_0) || "N/A"}ms, p99 ${toMs(ep.p99_0) || "N/A"}ms, ` +
      `fail: ${ep.fail || 0}, succ: ${ep.succ || 0}`;

    if (section.length + line.length + TRUNCATION_RESERVE > budget) {
      truncated = true;
      break;
    }
    section += line;
  }

  if (truncated) {
    section += TRUNCATION_NOTICE;
  }

  return section;
};

// ─── Section Builders ────────────────────────────────────────────────────────
// Each returns an array of lines that the orchestrator joins with "\n".

/**
 * Investigation guidance shown only for infrastructure failures.
 * @param {object} testRun
 * @returns {string[]}
 */
const buildGuidanceSection = (testRun) => {
  const lines = [INFRA_FAILURE_GUIDANCE];
  if (testRun.errorReason) {
    lines.push(`\n**Error Reason (from DLT):** ${testRun.errorReason}`);
  }
  lines.push(``);
  return lines;
};

/**
 * Test configuration and time window.
 * @param {object} testRun
 * @param {boolean} isInfraFailure - When true, errorReason is shown in the guidance section instead.
 * @returns {string[]}
 */
const buildMetadataSection = (testRun, isInfraFailure) => {
  const lines = [
    `## Test Configuration\n`,
    `- **Test Name:** ${testRun.testName || testRun.testId}`,
    `- **Test ID:** ${testRun.testId}`,
    `- **Test Run ID:** ${testRun.testRunId}`,
    `- **Test Type:** ${testRun.testType || "N/A"}`,
    `- **Status:** ${testRun.status || "N/A"}`,
  ];

  if (testRun.errorReason && !isInfraFailure) {
    lines.push(`- **Error Reason:** ${testRun.errorReason}`);
  }
  if (testRun.startTime) {
    lines.push(`- **Start Time:** ${testRun.startTime}`);
  }
  if (testRun.endTime) {
    lines.push(`- **End Time:** ${testRun.endTime}`);
  }

  // Compute duration from start/end if not provided directly
  const duration = testRun.testDuration || testRun.duration || computeDurationFromTimes(testRun.startTime, testRun.endTime);
  if (duration) {
    lines.push(`- **Duration:** ${formatDuration(duration)}`);
  }

  return lines;
};

/**
 * Load profile: concurrency, ramp up, hold, and per-region task counts.
 * @param {object} testRun
 * @returns {string[]}
 */
const buildLoadProfileSection = (testRun) => {
  const lines = [`\n## Load Profile\n`];

  if (testRun.concurrency) {
    lines.push(`- **Concurrency:** ${testRun.concurrency}`);
  }
  if (testRun.rampUp) {
    lines.push(`- **Ramp Up:** ${testRun.rampUp}`);
  }
  if (testRun.holdFor) {
    lines.push(`- **Hold For:** ${testRun.holdFor}`);
  }
  if (testRun.testTaskConfigs) {
    const regions = Array.isArray(testRun.testTaskConfigs)
      ? testRun.testTaskConfigs.map((r) => `${r.region} (${r.taskCount || r.concurrency || "?"} tasks)`).join(", ")
      : JSON.stringify(testRun.testTaskConfigs);
    lines.push(`- **Regions:** ${regions}`);
  }

  return lines;
};

/**
 * Aggregate results summary (percentiles, throughput, success/failure counts).
 * @param {object|null} total - The parsed results.total (or results) object.
 * @returns {string[]}
 */
const buildResultsSection = (total) => {
  if (!total) return [];

  const lines = [`\n## Results Summary\n`];

  if (total.avg_rt) lines.push(`- **Avg Response Time:** ${toMs(total.avg_rt)}ms`);
  if (total.p50_0) lines.push(`- **P50:** ${toMs(total.p50_0)}ms`);
  if (total.p90_0) lines.push(`- **P90:** ${toMs(total.p90_0)}ms`);
  if (total.p99_0) lines.push(`- **P99:** ${toMs(total.p99_0)}ms`);
  if (total.p99_9) lines.push(`- **P99.9:** ${toMs(total.p99_9)}ms`);
  if (total.fail != null) lines.push(`- **Failed Requests:** ${total.fail}`);
  if (total.succ != null) lines.push(`- **Successful Requests:** ${total.succ}`);
  if (total.throughput != null) lines.push(`- **Throughput:** ${total.throughput} req`);
  if (total.concurrency) lines.push(`- **Concurrency:** ${total.concurrency}`);
  if (total.stdev_rt) lines.push(`- **Std Dev Response Time:** ${toMs(total.stdev_rt)}ms`);

  return lines;
};

/**
 * Extracts target URLs from the scenario definition, falling back to base URLs
 * parsed from JMeter/script endpoint labels.
 * @param {object|null} scenario - The parsed testScenario object.
 * @param {object|null} total - The parsed results.total object (for label fallback).
 * @returns {string[]}
 */
const extractTargetUrls = (scenario, total) => {
  const urls = [];

  // Extract URLs from scenarios object (simple HTTP tests)
  const scenariosObj = scenario?.scenarios;
  if (scenariosObj && typeof scenariosObj === "object") {
    for (const name of Object.keys(scenariosObj)) {
      const requests = scenariosObj[name]?.requests;
      if (Array.isArray(requests)) {
        for (const req of requests) {
          if (req.url) urls.push(req.url);
        }
      }
    }
  }

  // For JMeter/script tests, extract base URL from endpoint labels if available
  if (urls.length === 0 && total?.labels) {
    for (const label of total.labels) {
      const labelUrl = label.label || "";
      if (labelUrl.startsWith("http://") || labelUrl.startsWith("https://")) {
        try {
          const parsed = new URL(labelUrl);
          const baseUrl = `${parsed.protocol}//${parsed.host}`;
          if (!urls.includes(baseUrl)) urls.push(baseUrl);
        } catch { /* ignore malformed */ }
      }
    }
  }

  return urls;
};

/**
 * Target section listing the URL(s) under test.
 * @param {object|null} scenario
 * @param {object|null} total
 * @returns {string[]}
 */
const buildTargetSection = (scenario, total) => {
  const urls = extractTargetUrls(scenario, total);
  if (urls.length === 0) return [];

  const shown = urls.slice(0, MAX_TARGET_URLS).join(", ");
  const overflow = urls.length > MAX_TARGET_URLS ? ` (+${urls.length - MAX_TARGET_URLS} more)` : "";
  return [`\n## Target\n`, `- **URL(s):** ${shown}${overflow}`];
};

/**
 * DLT console deep link (or relative path when no console URL is configured).
 * @param {object} testRun
 * @param {string} [consoleUrl]
 * @returns {string[]}
 */
const buildConsoleSection = (testRun, consoleUrl) => {
  const deepLinkPath = `#/scenarios/${testRun.testId}/testruns/${testRun.testRunId}`;
  return consoleUrl
    ? [`\n## DLT Console\n`, `- [View test run in DLT](${consoleUrl}/${deepLinkPath})`]
    : [`\n## DLT Console\n`, `- **Path:** ${deepLinkPath}`];
};

/**
 * Operator-supplied free-text context.
 * @param {object} [userContext]
 * @param {string} [userContext.additionalContext]
 * @returns {string[]}
 */
const buildContextSection = (userContext) => {
  if (!userContext?.additionalContext) return [];
  return [`\n## Additional Context (provided by operator)\n`, userContext.additionalContext];
};

/**
 * Baseline comparison section. Shows the key metrics from both the current run
 * and the baseline side-by-side with percentage deltas so the agent can quickly
 * identify regressions.
 *
 * @param {object|null} currentTotal - Parsed results.total from the current run.
 * @param {object|null} baselineRun - The baseline test-run record (from history table), or null.
 * @returns {string[]}
 */
const buildBaselineSection = (currentTotal, baselineRun) => {
  if (!baselineRun || !currentTotal) return [];

  const baselineResults = safeParse(baselineRun.results);
  const baselineTotal = baselineResults?.total || baselineResults;
  if (!baselineTotal) return [];

  const lines = [`\n## Baseline Comparison\n`];
  lines.push(`- **Baseline Run ID:** ${baselineRun.testRunId}`);
  if (baselineRun.startTime) {
    lines.push(`- **Baseline Date:** ${baselineRun.startTime}`);
  }
  lines.push(``);

  // Build a comparison table of key metrics
  const metrics = [
    { label: "Avg Response Time", current: toMs(currentTotal.avg_rt), baseline: toMs(baselineTotal.avg_rt), unit: "ms", higherIsWorse: true },
    { label: "P50", current: toMs(currentTotal.p50_0), baseline: toMs(baselineTotal.p50_0), unit: "ms", higherIsWorse: true },
    { label: "P90", current: toMs(currentTotal.p90_0), baseline: toMs(baselineTotal.p90_0), unit: "ms", higherIsWorse: true },
    { label: "P99", current: toMs(currentTotal.p99_0), baseline: toMs(baselineTotal.p99_0), unit: "ms", higherIsWorse: true },
    { label: "Failed Requests", current: Number(currentTotal.fail) || 0, baseline: Number(baselineTotal.fail) || 0, unit: "", higherIsWorse: true },
    { label: "Successful Requests", current: Number(currentTotal.succ) || 0, baseline: Number(baselineTotal.succ) || 0, unit: "", higherIsWorse: false },
    { label: "Throughput", current: Number(currentTotal.throughput) || null, baseline: Number(baselineTotal.throughput) || null, unit: " req", higherIsWorse: false },
  ];

  lines.push(`| Metric | Current | Baseline | Delta |`);
  lines.push(`|--------|---------|----------|-------|`);

  for (const m of metrics) {
    if (m.current == null && m.baseline == null) continue;
    const cur = m.current != null ? `${m.current}${m.unit}` : "N/A";
    const base = m.baseline != null ? `${m.baseline}${m.unit}` : "N/A";
    let delta = "";
    if (m.current != null && m.baseline != null && m.baseline !== 0) {
      const pct = Math.round(((m.current - m.baseline) / m.baseline) * 100);
      const sign = pct > 0 ? "+" : "";
      const indicator = pct === 0 ? "" : m.higherIsWorse ? (pct > 0 ? " ⚠️" : " ✓") : (pct < 0 ? " ⚠️" : " ✓");
      delta = `${sign}${pct}%${indicator}`;
    }
    lines.push(`| ${m.label} | ${cur} | ${base} | ${delta} |`);
  }

  return lines;
};

/**
 * Builds the description payload for CreateBacklogTask.
 *
 * @param {object} testRun - The test-run record from DynamoDB.
 * @param {object} [userContext] - Optional user-provided context.
 * @param {string} [userContext.additionalContext] - Free-text context from the operator.
 * @param {string} [consoleUrl] - DLT console base URL for deep links.
 * @param {object} [baselineRun] - The baseline test-run record (from history), or null/undefined.
 * @returns {string} Description payload (≤ 10,000 chars).
 */
const buildDescription = (testRun, userContext, consoleUrl, baselineRun) => {
  // Parse results and scenario once up front. Both may be JSON strings, objects,
  // or malformed — safeParse never throws, so a bad record degrades gracefully
  // (sections are skipped) instead of failing investigation creation.
  const results = safeParse(testRun.results);
  const total = results?.total || results;
  const scenario = safeParse(testRun.testScenario);
  const isInfraFailure = testRun.status === "failed";

  const sections = [
    `# DLT Performance Investigation\n`,
    ...(isInfraFailure ? buildGuidanceSection(testRun) : []),
    ...buildMetadataSection(testRun, isInfraFailure),
    ...buildLoadProfileSection(testRun),
    ...buildResultsSection(total),
    ...buildBaselineSection(total, baselineRun),
    ...buildTargetSection(scenario, total),
    ...buildConsoleSection(testRun, consoleUrl),
    ...buildContextSection(userContext),
  ];

  let description = sections.join("\n");

  // Per-endpoint breakdown fills the remaining budget. Reuses the already-parsed
  // results from above rather than parsing again.
  const endpoints = total?.labels;
  if (endpoints && endpoints.length > 0) {
    const remainingBudget = MAX_DESCRIPTION_LENGTH - description.length;
    if (remainingBudget > 100) {
      description += buildEndpointSection(endpoints, remainingBudget);
    }
  }

  // Final safety truncation (should not happen with proper budgeting)
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    description = description.substring(0, MAX_DESCRIPTION_LENGTH - TRUNCATION_RESERVE) + TRUNCATION_NOTICE;
  }

  return description;
};

module.exports = {
  buildDescription,
  buildEndpointSection,
  formatDuration,
  INFRA_FAILURE_GUIDANCE,
  MAX_DESCRIPTION_LENGTH,
  TRUNCATION_NOTICE,
};
