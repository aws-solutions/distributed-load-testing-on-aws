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
import { fetchLatestRun, renderRun } from "../lib/results-formatter.js";
import { colorStatus } from "../lib/color.js";
import { validateOutboundRequest } from "../lib/request-validation.js";
import { parsePositiveInt } from "../lib/parse.js";
import { MAX_TEST_RUNS_PER_DELETE_REQUEST, deleteTestRunsSchema, setBaselineSchema } from "@amzn/dlt-common";
import type { SetBaselineValidation, DeleteTestRunsValidation } from "@amzn/dlt-common";
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

  const baseline = runs.command("baseline").description("Manage baseline runs for a scenario");

  baseline
    .command("get <testId>")
    .description("Get the baseline test run for a scenario")
    .addOption(formatOption())
    .action(withErrorHandler(handleBaselineRun));

  baseline
    .command("set <testId>")
    .description(
      "Set the baseline run for a scenario\n\n" + "Examples:\n" + "  dlt runs baseline set abc123 --run-id run-456"
    )
    .requiredOption("--run-id <runId>", "The test run ID to set as baseline")
    .action(withErrorHandler(handleBaselineSet));

  baseline
    .command("clear <testId>")
    .description("Clear the baseline run for a scenario\n\n" + "Examples:\n" + "  dlt runs baseline clear abc123")
    .action(withErrorHandler(handleBaselineClear));

  runs
    .command("delete <testId>")
    .description(
      "Delete test run(s) for a scenario\n\n" +
        "Examples:\n" +
        "  dlt runs delete abc123 --run-id run-1\n" +
        "  dlt runs delete abc123 --run-id run-1 --run-id run-2"
    )
    .requiredOption("--run-id <runId...>", `One to ${MAX_TEST_RUNS_PER_DELETE_REQUEST} run IDs to delete`)
    .action(withErrorHandler(handleDeleteRuns));

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

  // Validate --limit up front: a non-numeric value would otherwise parse to NaN,
  // defeating the result cap (allRuns.length >= NaN is always false) and getting
  // forwarded verbatim to the API.
  const userLimit = options.limit === undefined ? undefined : parsePositiveInt(options.limit, "--limit");

  const params = new URLSearchParams();
  if (userLimit !== undefined) params.set("limit", String(userLimit));
  if (options.startTimestamp) params.set("start_timestamp", options.startTimestamp);

  // When the user specifies --limit, honour it: fetch all pages but cap the
  // total number of results to the requested limit.
  const runs = await fetchAllTestRuns(api, testId, params, userLimit);

  // Optionally fetch baseline for comparison
  const baselineMetrics = options.baseline ? await fetchBaselineMetrics(api, testId) : null;

  renderRunsList(runs, options.format as OutputFormat, baselineMetrics);
}

/** Render the runs list in the requested format, optionally including baseline comparison. */
function renderRunsList(
  runs: TestRun[],
  format: OutputFormat,
  baselineMetrics: NonNullable<Awaited<ReturnType<typeof fetchBaselineMetrics>>> | null
): void {
  if (format === "table") {
    if (baselineMetrics) {
      const rows = runs.map((r: TestRun) =>
        colorBaselineRow(curateRunRowWithBaseline(r, baselineMetrics), baselineMetrics.baselineRunId)
      );
      printResult(rows, { format: "table" });
    } else {
      const rows = runs.map((r: TestRun) => colorRunRow(curateRunRow(r)));
      printResult(rows, { format: "table" });
    }
  } else if (format === "csv") {
    if (baselineMetrics) {
      const rows = runs.map((r: TestRun) => curateRunRowWithBaseline(r, baselineMetrics));
      printResult(rows, { format: "csv" });
    } else {
      const rows = runs.map((r: TestRun) => curateRunRow(r));
      printResult(rows, { format: "csv" });
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

  // Shared renderer keeps the metric columns identical to `runs latest` /
  // `scenarios results`; JSON emits the full raw API response.
  renderRun(data, options.format as OutputFormat, data);
}

async function handleLatestRun(testId: string, options: { format: string }): Promise<void> {
  const api = await ApiClient.create();

  const latest = await fetchLatestRun(api, testId);
  if (!latest) {
    throw new Error("No test runs found for this scenario.");
  }

  // Shared renderer; JSON emits the raw latest run for machine consumption.
  renderRun(latest, options.format as OutputFormat, latest);
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
// Delete runs
// ---------------------------------------------------------------------------

async function handleDeleteRuns(testId: string, options: { runId: string[] }): Promise<void> {
  const api = await ApiClient.create();
  // Derive the request body type from the shared DELETE /testruns schema so a
  // change to that contract (e.g. no longer a bare array of ids) fails here.
  const runIds: DeleteTestRunsValidation = Array.isArray(options.runId) ? options.runId : [options.runId];
  // Validate the run-id list against the shared DELETE /testruns schema before
  // sending so an invalid id fails locally with a clear, field-level message.
  validateOutboundRequest(deleteTestRunsSchema, runIds, "delete test runs");
  await api.delete(`/scenarios/${encodeURIComponent(testId)}/testruns`, runIds);
  console.error(`Deleted ${runIds.length} run(s) for scenario ${testId}.`);
}

// ---------------------------------------------------------------------------
// Baseline set / clear
// ---------------------------------------------------------------------------

async function handleBaselineSet(testId: string, options: { runId: string }): Promise<void> {
  const api = await ApiClient.create();
  // Derive the request body type from the shared PUT /baseline schema so a
  // renamed/removed field (e.g. `testRunId`) fails this build.
  const body: SetBaselineValidation = { testRunId: options.runId };
  // Validate against the shared PUT /baseline schema before sending so a
  // malformed run id fails locally with a clear, field-level message.
  validateOutboundRequest(setBaselineSchema, body, "set baseline");
  await api.put(`/scenarios/${encodeURIComponent(testId)}/baseline`, body);
  console.error(`Baseline set to run ${options.runId} for scenario ${testId}.`);
}

async function handleBaselineClear(testId: string): Promise<void> {
  const api = await ApiClient.create();
  await api.delete(`/scenarios/${encodeURIComponent(testId)}/baseline`);
  console.error(`Baseline cleared for scenario ${testId}.`);
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
