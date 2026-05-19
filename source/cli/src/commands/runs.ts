// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { ApiClient } from "../lib/api-client.js";
import { printResult, formatOption } from "../lib/output.js";
import { withErrorHandler } from "../lib/error-handler.js";
import { getArtifactInfo, downloadRunArtifacts } from "../lib/artifact-downloader.js";
import {
  curateRunRow,
  colorRunRow,
  colorBaselineRow,
  isActive,
  extractBaselineMetrics,
  curateRunRowWithBaseline,
  enrichRunWithBaseline,
  formatTimestamp,
} from "../lib/run-formatters.js";
import { colorStatus } from "../lib/color.js";
import type { OutputFormat, TestRun, TestRunsResponse, ScenariosListResponse, BaselineResponse } from "../lib/types.js";

export function registerRunsCommand(program: Command): void {
  const runs = program.command("runs").description("Query test run results");

  runs
    .command("list <testId>")
    .description("List test runs for a scenario")
    .option("--limit <n>", "Maximum number of runs to return")
    .option("--start-timestamp <ts>", "Filter runs after this timestamp")
    .option("--baseline", "Show baseline comparison deltas for each run")
    .addOption(formatOption())
    .action(withErrorHandler(handleListRuns));

  runs
    .command("get <testId> <runId>")
    .description("Get details of a specific test run")
    .addOption(formatOption())
    .action(withErrorHandler(handleGetRun));

  runs
    .command("latest <testId>")
    .description("Get the most recent test run for a scenario")
    .addOption(formatOption())
    .action(withErrorHandler(handleLatestRun));

  runs
    .command("baseline <testId>")
    .description("Get the baseline test run for a scenario")
    .addOption(formatOption())
    .action(withErrorHandler(handleBaselineRun));

  runs
    .command("artifacts <testId> <runId>")
    .description("Get artifact info for a test run")
    .addOption(formatOption())
    .action(withErrorHandler(handleRunArtifacts));

  runs
    .command("active [testId]")
    .description("Show test runs that are in progress (running, pending, or provisioning)")
    .addOption(formatOption())
    .action(withErrorHandler(handleActiveRuns));

  runs
    .command("download <testId> <runId>")
    .description("Download test run artifacts from S3")
    .option("-o, --output-dir <dir>", "Local directory to save artifacts")
    .option("--zip", "Create a .zip file instead of extracting to a directory")
    .option("--filter <glob>", "Only download files matching pattern (e.g. '*.xml')")
    .option("--dry-run", "List files that would be downloaded without downloading")
    .option("--force", "Overwrite existing files without prompting")
    .action(withErrorHandler(handleDownloadArtifacts));
}

/**
 * Fetch all pages of test runs for a scenario, following next_token pagination.
 */
async function fetchAllTestRuns(
  api: ApiClient,
  testId: string,
  baseParams?: URLSearchParams,
  maxResults?: number
): Promise<TestRun[]> {
  const allRuns: TestRun[] = [];
  let nextToken: string | null = null;

  do {
    const params = new URLSearchParams(baseParams?.toString() ?? "");
    // API requires a limit param; default to max (100) for efficient pagination
    if (!params.has("limit")) {
      params.set("limit", "100");
    }
    if (nextToken) {
      params.set("next_token", nextToken);
    }
    const qs = params.toString() ? `?${params.toString()}` : "";
    const data = await api.get<TestRunsResponse>(`/scenarios/${encodeURIComponent(testId)}/testruns${qs}`);

    if (data.testRuns && Array.isArray(data.testRuns)) {
      allRuns.push(...data.testRuns);
    }

    // Stop paginating if we have already reached the user-requested limit
    if (maxResults !== undefined && allRuns.length >= maxResults) {
      return allRuns.slice(0, maxResults);
    }

    nextToken = data.pagination?.next_token ?? null;
  } while (nextToken);

  return allRuns;
}

async function handleListRuns(
  testId: string,
  options: {
    limit?: string | undefined;
    startTimestamp?: string | undefined;
    baseline?: boolean | undefined;
    format: string;
  }
): Promise<void> {
  const api = await ApiClient.create();

  const params = new URLSearchParams();
  if (options.limit) params.set("limit", options.limit);
  if (options.startTimestamp) params.set("startTimestamp", options.startTimestamp);

  const userLimit = options.limit ? parseInt(options.limit, 10) : undefined;

  // When the user specifies --limit, honour it: fetch all pages but cap the
  // total number of results to the requested limit.
  const runs = await fetchAllTestRuns(api, testId, params, userLimit);

  // Optionally fetch baseline for comparison
  const baselineMetrics = options.baseline ? await fetchBaselineMetrics(api, testId) : null;

  if (options.format === "table") {
    if (baselineMetrics) {
      const rows = runs.map((r: TestRun) =>
        colorBaselineRow(curateRunRowWithBaseline(r, baselineMetrics), baselineMetrics.baselineRunId)
      );
      printResult(rows, { format: "table" });
    } else {
      const rows = runs.map((r: TestRun) => {
        const raw = r as Record<string, unknown>;
        return colorRunRow({
          runId: r.testRunId,
          status: r.status,
          startTime: formatTimestamp(r.startTime ?? ""),
          endTime: formatTimestamp(r.endTime ?? ""),
          requests: raw["requests"] ?? "",
          errors: raw["errors"] ?? "",
          avgResponseTime: raw["avgResponseTime"] ?? "",
        });
      });
      printResult(rows, { format: "table" });
    }
  } else {
    if (baselineMetrics) {
      const enriched = runs.map((r: TestRun) => enrichRunWithBaseline(r, baselineMetrics));
      printResult(enriched, { format: "json" });
    } else {
      printResult(runs, { format: "json" });
    }
  }
}

/**
 * Fetch baseline data for a scenario and extract aggregate metrics.
 * Returns null (with a warning to stderr) if no baseline is set or data is unavailable.
 */
async function fetchBaselineMetrics(api: ApiClient, testId: string) {
  try {
    const baselineResp = await api.get<BaselineResponse>(`/scenarios/${encodeURIComponent(testId)}/baseline`);
    const metrics = extractBaselineMetrics(baselineResp);
    if (!metrics) {
      console.error("No baseline is set for this scenario. Use the web UI or API to set one.");
      return null;
    }
    if (baselineResp.warning) {
      console.error(`Baseline warning: ${baselineResp.warning}`);
    }
    console.error(`Comparing against baseline run ${metrics.baselineRunId}`);
    return metrics;
  } catch {
    console.error("Unable to fetch baseline data. Showing results without baseline comparison.");
    return null;
  }
}

async function handleGetRun(testId: string, runId: string, options: { format: string }): Promise<void> {
  const api = await ApiClient.create();
  const data = await api.get<TestRun>(`/scenarios/${encodeURIComponent(testId)}/testruns/${encodeURIComponent(runId)}`);

  if (options.format === "table") {
    printResult(colorRunRow(curateRunRow(data)), { format: "table" });
  } else {
    printResult(data, { format: "json" });
  }
}

async function handleLatestRun(testId: string, options: { format: string }): Promise<void> {
  const api = await ApiClient.create();

  // limit=1 + latest=true returns just the most recent run — no pagination needed
  const data = await api.get<TestRunsResponse>(`/scenarios/${encodeURIComponent(testId)}/testruns?limit=1&latest=true`);

  const latest = data.testRuns?.[0];
  if (!latest) {
    console.error("No test runs found for this scenario.");
    process.exit(1);
  }

  if (options.format === "table") {
    printResult(colorRunRow(curateRunRow(latest)), { format: "table" });
  } else {
    printResult(latest, { format: "json" });
  }
}

async function handleBaselineRun(testId: string, options: { format: string }): Promise<void> {
  const api = await ApiClient.create();
  const data = await api.get(`/scenarios/${encodeURIComponent(testId)}/baseline`);
  printResult(data, { format: options.format as OutputFormat });
}

async function handleRunArtifacts(testId: string, runId: string, options: { format: string }): Promise<void> {
  const api = await ApiClient.create();
  const artifacts = await getArtifactInfo(api, testId, runId);

  printResult(artifacts, { format: options.format as OutputFormat });
  console.error(`\nTip: Use "dlt runs download ${testId} ${runId}" to download these artifacts locally.`);
}

async function handleDownloadArtifacts(
  testId: string,
  runId: string,
  options: {
    outputDir?: string | undefined;
    zip?: boolean | undefined;
    filter?: string | undefined;
    dryRun?: boolean | undefined;
    force?: boolean | undefined;
  }
): Promise<void> {
  const api = await ApiClient.create();
  await downloadRunArtifacts(api, testId, runId, options);
}

// ---------------------------------------------------------------------------
// Active runs
// ---------------------------------------------------------------------------

async function handleActiveRuns(testId: string | undefined, options: { format: string }): Promise<void> {
  const api = await ApiClient.create();

  interface ActiveRow {
    testId: string;
    testName: string;
    status: string;
    startTime: string;
  }

  const activeRows: ActiveRow[] = [];

  if (testId) {
    // Single scenario — check scenario-level status (in-progress runs may not
    // appear in the runs API until complete)
    const scenario = await api.get<{ testId: string; testName: string; status?: string; startTime?: string }>(
      `/scenarios/${encodeURIComponent(testId)}?history=false&latest=false`
    );
    if (isActive(scenario.status)) {
      activeRows.push({
        testId: scenario.testId,
        testName: scenario.testName ?? "",
        status: colorStatus(scenario.status ?? ""),
        startTime: formatTimestamp(scenario.startTime ?? ""),
      });
    }
  } else {
    // All scenarios — fetch scenario list, filter to active statuses
    const data = await api.get<ScenariosListResponse>("/scenarios");
    const scenarios = data.Items ?? [];

    for (const s of scenarios) {
      if (isActive(s.status)) {
        activeRows.push({
          testId: s.testId,
          testName: s.testName,
          status: colorStatus(s.status ?? ""),
          startTime: formatTimestamp(s.startTime ?? ""),
        });
      }
    }
  }

  printResult(activeRows, { format: options.format as OutputFormat });
}
