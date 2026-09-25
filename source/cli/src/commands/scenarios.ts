// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from "node:crypto";
import { Command, Option } from "commander";
import { applySpecFile, readSpecFile } from "../lib/spec-file.js";
import { ApiClient } from "../lib/api-client.js";
import { printResult, formatOption } from "../lib/output.js";
import { withErrorHandler } from "../lib/error-handler.js";
import { startScenario } from "../lib/scenario-launcher.js";
import {
  uploadTestFile,
  assertScriptFileMatchesTestType,
  copyScenarioScript,
  fileExtension,
} from "../lib/file-uploader.js";
import { buildSpecTemplate } from "../lib/spec-template.js";
import { buildNativeRunMode, type NativeModeOptions } from "../lib/native-mode.js";
import { trafficShapeHelp } from "../lib/traffic-shape.js";
import { parseThresholdFlags, evaluateThresholds, evaluateBaselineRegression } from "../lib/threshold.js";
import { isActive, curateRunRow, colorRunRow, sleep, formatTimestamp } from "../lib/run-formatters.js";
import {
  extractTotalResults,
  normalizeTotalToMs,
  fetchLatestRun,
  renderRun,
  LATENCY_KEYS_SECONDS,
} from "../lib/results-formatter.js";
import { colorStatus } from "../lib/color.js";
import { validateOutboundRequest } from "../lib/request-validation.js";
import { parsePositiveInt } from "../lib/parse.js";
import {
  buildScenarioBody,
  buildRegionalTaskDetails,
  parseTestScenario,
  renameScenario,
  assembleTestScenario,
  validateSchedulingInput,
  type CreateScenarioPayload,
  type SchedulingInput,
} from "../lib/scenario-payload.js";
import { createTestSchema, fileTypeForAssetFilename, isLoadTestFramework, isCancelableRunStatus } from "@amzn/dlt-common";
import type { NativeRunMode } from "@amzn/dlt-common";
import type {
  OutputFormat,
  Scenario,
  ScenariosListResponse,
  TestResultsData,
  BaselineResponse,
} from "../lib/types.js";

/**
 * Register the six shared `--fail-on-*` threshold options on a command.
 *
 * `scenarios start` and `scenarios results` both gate on the same metric
 * thresholds, so the flag definitions live here to guarantee the two paths stay
 * in lockstep (a single edit affects both). Returns the command to allow
 * chaining.
 */
export function addThresholdOptions(cmd: Command): Command {
  return cmd
    .option("--fail-on-error-rate <percent>", "Exit code 2 if error rate exceeds threshold (0-100)")
    .option("--fail-on-p99 <ms>", "Exit code 2 if p99 latency exceeds threshold (ms)")
    .option("--fail-on-p95 <ms>", "Exit code 2 if p95 latency exceeds threshold (ms)")
    .option("--fail-on-avg-rt <ms>", "Exit code 2 if avg response time exceeds threshold (ms)")
    .option("--fail-on-throughput-below <reqPerSec>", "Exit code 2 if throughput is below threshold (req/s)")
    .option("--fail-on-baseline-regression <percent>", "Exit code 2 if any metric regresses beyond % vs baseline");
}

/**
 * Native-mode `--max-test-duration` flag, shared by `scenarios create` and
 * `update`.
 *
 * Defining it once keeps the two commands symmetric. Native-mode tests run the
 * load their uploaded script defines, so the only native flag is the safety
 * timeout. Returns the command for chaining.
 *
 * The `--native-mode` toggle itself is intentionally NOT here: `create` exposes
 * it explicitly, while `update` infers native mode from the existing scenario.
 * That difference is also why `--max-test-duration`'s help differs — hence
 * `maxDurationRequiredNote`.
 * @param cmd The command to add the options to.
 * @param opts.maxDurationRequiredNote When true, notes that
 *   `--max-test-duration` is required (create pairs it with `--native-mode`).
 */
export function addNativeModeOptions(cmd: Command, opts: { maxDurationRequiredNote: boolean }): Command {
  const maxDurationHelp = opts.maxDurationRequiredNote
    ? "Native mode: safety timeout, e.g. 30m, 1h (max 24h). Required with --native-mode"
    : "Native mode: safety timeout, e.g. 30m, 1h (max 24h)";
  return cmd.option("--max-test-duration <duration>", maxDurationHelp);
}

/**
 * Scheduling flags shared by `scenarios create` and `update`.
 *
 * Both commands persist the same scheduling fields via `applySchedulingFields`,
 * so the flags are defined once here to keep the two commands symmetric.
 * Supports two mutually exclusive scheduled modes: recurring (`--cron`) and
 * one-time (`--schedule-date` + `--schedule-time`, the console's "Run Once").
 * Returns the command for chaining.
 * @param cmd The command to add the options to.
 */
export function addSchedulingOptions(cmd: Command): Command {
  return cmd
    .option("--cron <expression>", "Recurring schedule: 5-field cron expression (e.g. '0 8 * * *')")
    .option("--schedule-timezone <tz>", "Schedule timezone, default UTC (e.g., US/Pacific)")
    .option("--cron-expiry-date <date>", "ISO date for when schedule stops")
    .option("--schedule-date <date>", "One-time run date, YYYY-MM-DD (with --schedule-time)")
    .option("--schedule-time <time>", "One-time run time, HH:MM 24-hour (with --schedule-date)");
}

export function registerScenariosCommand(program: Command): void {
  const scenarios = program.command("scenarios").description("Manage test scenarios");

  scenarios
    .command("list")
    .description("List all test scenarios")
    .addOption(formatOption())
    .action(withErrorHandler(handleListScenarios));

  scenarios
    .command("get <testId>")
    .description("Get details for a specific test scenario")
    .addOption(formatOption())
    .action(withErrorHandler(handleGetScenario));

  scenarios
    .command("delete <testId>")
    .description(
      "Delete a test scenario\n" +
      "  Examples:\n" +
      "    dlt scenarios delete abc123\n" +
      "    dlt scenarios delete my-test-id"
    )
    .action(withErrorHandler(handleDeleteScenario));

  scenarios
    .command("cancel <testId>")
    .description(
      "Cancel a running test scenario\n" +
      "  Examples:\n" +
      "    dlt scenarios cancel abc123\n" +
      "    # Cancel a running test in a CI/CD pipeline on timeout\n" +
      "    dlt scenarios cancel $TEST_ID"
    )
    .action(withErrorHandler(handleCancelScenario));

  const createCommand = scenarios
    .command("create")
    .description(
      "Create a new test scenario\n" +
      "  Examples:\n" +
      "    # Simple HTTP test\n" +
      '    dlt scenarios create --test-name "API Test" --test-description "Load test" \\\n' +
      "      --test-type simple --http-endpoint https://example.com/api \\\n" +
      "      --concurrency 10 --task-count 2 --regions us-east-1 --hold-for 5m\n\n" +
      "    # JMeter script test\n" +
      '    dlt scenarios create --test-name "JMeter Test" --test-description "Script test" \\\n' +
      "      --test-type jmeter --file ./test.jmx \\\n" +
      "      --concurrency 5 --task-count 1 --regions us-east-1,eu-west-1 --hold-for 10m\n\n" +
      "    # Scheduled test with cron\n" +
      '    dlt scenarios create --test-name "Nightly Test" --test-description "Nightly run" \\\n' +
      "      --test-type simple --http-endpoint https://example.com \\\n" +
      "      --concurrency 10 --task-count 2 --regions us-east-1 --hold-for 5m \\\n" +
      '      --cron "0 8 * * *"\n\n' +
      "    # Native-mode Locust test (the uploaded script drives the load)\n" +
      '    dlt scenarios create --test-name "Locust Native" --test-description "Native run" \\\n' +
      "      --test-type locust --file ./locustfile.py \\\n" +
      "      --task-count 2 --regions us-east-1 \\\n" +
      "      --native-mode --max-test-duration 30m\n\n" +
      "    # Native-mode k6 test\n" +
      '    dlt scenarios create --test-name "k6 Native" --test-description "Native run" \\\n' +
      "      --test-type k6 --file ./script.js \\\n" +
      "      --task-count 1 --regions us-east-1 \\\n" +
      "      --native-mode --max-test-duration 1h\n\n" +
      trafficShapeHelp()
    )
    .option("--test-name <name>", "Name of the test scenario (required unless --from-file; auto-trimmed)")
    .option("--test-description <description>", "Description of the test scenario (required unless --from-file)")
    .addOption(
      new Option("--test-type <type>", "Test type (required unless --from-file)").choices([
        "simple",
        "jmeter",
        "k6",
        "locust",
      ])
    )
    .option("--from-file <path>", "Load field values from a JSON spec file; command-line flags override the file")
    .option("--file <path>", "Path to script file (.jmx, .js, .ts, .py, .zip)")
    .option("--http-endpoint <url>", "HTTP endpoint for simple test type")
    .option("--http-method <method>", "HTTP method for simple test type", "GET")
    .option("--body <body>", "Request body for simple test type")
    .option("--headers <json>", "JSON string of headers for simple test type")
    .option(
      "--concurrency <number>",
      "Standard mode: concurrent virtual users per region (required unless --native-mode or --from-file). Ignored in Native mode, where the script sets the virtual users"
    )
    .option("--task-count <number>", "Task count per region (required unless --from-file)")
    .option("--regions <regions>", "Comma-separated regions, e.g. us-east-1,eu-west-1 (required unless --from-file)")
    .option("--tags <tags>", "Comma-separated tags (max 5)")
    .option("--healthy-threshold <percent>", "Percent of healthy tasks required, 0-100 (default: 90)")
    .option("--ramp-up <duration>", "Standard mode: ramp-up duration (e.g., 1m, 30s). Ignored in Native mode", "0s")
    .option(
      "--hold-for <duration>",
      "Standard mode: hold-for duration (e.g., 10m, 5m); required unless --native-mode. Ignored in Native mode"
    )
    .option(
      "--native-mode",
      "Select the Native traffic shape: run the uploaded script under the framework's own runner (jmeter, k6, or locust) so the script defines the load. Omit for Standard, where DLT sets the load"
    );
  addSchedulingOptions(addNativeModeOptions(createCommand, { maxDurationRequiredNote: true }))
    .option("--save-only", "Create without starting the test")
    .option("--dry-run", "Print the request body that would be sent, without uploading or creating anything")
    .addOption(formatOption())
    .action(withErrorHandler(handleCreateScenario));

  scenarios
    .command("spec-template")
    .description(
      "Print a starter --from-file spec you can edit, then pass to `scenarios create`\n" +
      "  Examples:\n" +
      "    dlt scenarios spec-template --test-type simple > scenario.json\n" +
      "    dlt scenarios spec-template --test-type k6 --native-mode > scenario.json\n" +
      "    dlt scenarios create --from-file scenario.json"
    )
    .addOption(
      new Option("--test-type <type>", "Test type for the template")
        .choices(["simple", "jmeter", "k6", "locust"])
        .default("simple")
    )
    .option("--native-mode", "Emit Native traffic-shape fields instead of Standard ones (jmeter, k6, or locust)")
    .action(withErrorHandler(handleSpecTemplate));

  scenarios
    .command("copy <testId>")
    .description(
      "Duplicate an existing scenario into a new one (created saved, not started)\n" +
      "  Examples:\n" +
      "    dlt scenarios copy abc123\n" +
      '    dlt scenarios copy abc123 --test-name "Copy of API Test"'
    )
    .option("--test-name <name>", "Name for the copy (defaults to the source scenario's name)")
    .option("--dry-run", "Print the request body that would be sent, without copying or creating anything")
    .addOption(formatOption())
    .action(withErrorHandler(handleCopyScenario));

  const updateCommand = scenarios
    .command("update <testId>")
    .description(
      "Update an existing test scenario\n" +
      "  Examples:\n" +
      "    # Update concurrency and hold-for duration\n" +
      "    dlt scenarios update abc123 --concurrency 20 --hold-for 10m\n\n" +
      "    # Update regions and task count\n" +
      "    dlt scenarios update abc123 --regions us-east-1,eu-west-1 --task-count 4\n\n" +
      "    # Update schedule\n" +
      '    dlt scenarios update abc123 --cron "0 8 * * *"\n\n' +
      "    # Change the safety timeout of a Native-mode scenario\n" +
      "    dlt scenarios update abc123 --max-test-duration 45m\n\n" +
      trafficShapeHelp()
    )
    .option("--from-file <path>", "Load field values from a JSON spec file; command-line flags override the file")
    .option("--test-name <name>", "Name of the test scenario (test-name is auto-trimmed)")
    .option("--test-description <description>", "Description of the test scenario")
    .option("--concurrency <number>", "Standard mode: concurrent virtual users per region")
    .option("--task-count <number>", "Task count per region")
    .option("--regions <regions>", "Comma-separated regions")
    .option("--ramp-up <duration>", "Standard mode: ramp-up duration (e.g., 1m, 30s)")
    .option("--hold-for <duration>", "Standard mode: hold-for duration (e.g., 10m, 5m)")
    .option("--file <path>", "Path to script file (.jmx, .js, .ts, .py, .zip)");
  addSchedulingOptions(addNativeModeOptions(updateCommand, { maxDurationRequiredNote: false }))
    .option("--tags <tags>", "Comma-separated tags (max 5); replaces the existing tags")
    .option("--healthy-threshold <percent>", "Percent of healthy tasks required, 0-100")
    .option("--dry-run", "Print the merged request body that would be sent, without updating anything")
    .addOption(formatOption())
    .action(withErrorHandler(handleUpdateScenario));

  const resultsCommand = scenarios
    .command("results <testId>")
    .description(
      "Get results of the most recent completed run\n" +
      "  Output format is controlled by --format <table|json|csv> (default: table).\n" +
      "  --json and --csv are back-compat aliases for --format json / --format csv.\n" +
      "  Passing an alias that disagrees with an explicit --format value is an error.\n\n" +
      "  Examples:\n" +
      "    dlt scenarios results abc123\n" +
      "    dlt scenarios results abc123 --format json\n" +
      "    dlt scenarios results abc123 --format csv\n" +
      "    dlt scenarios results abc123 --json   # alias for --format json\n" +
      "    dlt scenarios results abc123 --csv    # alias for --format csv\n" +
      "    # CI/CD gate: fail if error rate > 5%\n" +
      "    dlt scenarios results abc123 --fail-on-error-rate 5\n" +
      "    # CI/CD gate: fail if p99 > 2000ms or throughput < 100 req/s\n" +
      "    dlt scenarios results abc123 --fail-on-p99 2000 --fail-on-throughput-below 100\n" +
      "    # Fail if any metric regresses > 20% vs baseline\n" +
      "    dlt scenarios results abc123 --fail-on-baseline-regression 20"
    )
    .addOption(formatOption())
    .option("--json", "Alias for --format json")
    .option("--csv", "Alias for --format csv");
  addThresholdOptions(resultsCommand).action(withErrorHandler(handleResultsScenario));

  const startCommand = scenarios
    .command("start [testId...]")
    .description("Start (re-run) one or more test scenarios")
    .option("--name <name>", "Start a scenario by name instead of testId")
    .option("--wait", "Wait for the test(s) to complete before exiting")
    .option("--poll-interval <seconds>", "Polling interval in seconds when using --wait", "15");
  addThresholdOptions(startCommand).addOption(formatOption()).action(withErrorHandler(handleStartScenarios));
}

interface CreateOptions extends NativeModeOptions {
  // Required for a normal create, but may instead come from --from-file; presence
  // is enforced in the handler after the spec file is merged.
  testName?: string;
  testDescription?: string;
  testType?: string;
  taskCount?: string;
  regions?: string;
  file?: string;
  fromFile?: string;
  httpEndpoint?: string;
  httpMethod?: string;
  body?: string;
  headers?: string;
  concurrency?: string;
  rampUp?: string;
  holdFor?: string;
  tags?: string;
  healthyThreshold?: string;
  cron?: string;
  scheduleTimezone?: string;
  cronExpiryDate?: string;
  scheduleDate?: string;
  scheduleTime?: string;
  saveOnly?: boolean;
  nativeMode?: boolean;
  dryRun?: boolean;
  format: string;
}

/** Build the scenarios object for the test payload. */
function buildScenariosObject(
  options: CreateOptions,
  testId: string,
  execution: Record<string, unknown>,
  testName: string,
  testType: string
): Record<string, unknown> {
  const scenarios: Record<string, unknown> = {};

  if (options.file) {
    const ext = fileExtension(options.file);
    const scriptFileName = `${testId}.${ext}`;
    scenarios[testName] = { script: scriptFileName };
  } else if (testType === "simple" && options.httpEndpoint) {
    execution["scenario"] = testName;
    let parsedHeaders: Record<string, string> = {};
    if (options.headers) {
      try {
        parsedHeaders = JSON.parse(options.headers) as Record<string, string>;
      } catch {
        throw new Error("--headers must be valid JSON");
      }
    }
    const request: Record<string, unknown> = {
      url: options.httpEndpoint,
      method: options.httpMethod ?? "GET",
      headers: parsedHeaders,
    };
    if (options.body?.trim()) {
      request["body"] = options.body;
    }
    scenarios[testName] = { requests: [request] };
  }

  return scenarios;
}

/** Parse a comma-separated `--tags` value into a trimmed, non-empty list. */
function parseTags(input: string | undefined): string[] | undefined {
  if (input === undefined) return undefined;
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/** Parse and validate a `--healthy-threshold` percent (integer 0-100). */
function parseHealthyThreshold(input: string | undefined): number | undefined {
  if (input === undefined) return undefined;
  if (!/^\d+$/.test(input.trim()) || Number(input) > 100) {
    throw new Error("--healthy-threshold must be an integer between 0 and 100");
  }
  return Number.parseInt(input, 10);
}

/** The always-required create fields, narrowed to non-optional after validation. */
interface RequiredCreateFields {
  testName: string;
  testDescription: string;
  testType: string;
  taskCount: string;
  regions: string;
}

/**
 * Assert every always-required create field is present (from a flag or the
 * merged spec file) and return them narrowed to non-optional strings.
 */
function requireCreateFields(options: CreateOptions): RequiredCreateFields {
  if (!options.testName) throw new Error("--test-name is required");
  if (!options.testDescription) throw new Error("--test-description is required");
  if (!options.testType) throw new Error("--test-type is required");
  if (!options.taskCount) throw new Error("--task-count is required");
  if (!options.regions) throw new Error("--regions is required");
  return {
    testName: options.testName,
    testDescription: options.testDescription,
    testType: options.testType,
    taskCount: options.taskCount,
    regions: options.regions,
  };
}

/**
 * Resolve per-region concurrency. Native runs are duration-driven, so the web
 * UI sends a placeholder concurrency of 1; mirror that. In Standard mode
 * concurrency is required and must be a positive integer.
 */
function resolveConcurrency(options: CreateOptions, nativeMode: boolean): number {
  if (nativeMode) return 1;
  if (options.concurrency === undefined) throw new Error("--concurrency is required");
  return parsePositiveInt(options.concurrency, "--concurrency");
}

/** Split, trim, and validate the comma-separated `--regions` value. */
function parseRegionList(regions: string): string[] {
  const regionList = regions
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  if (regionList.length === 0) throw new Error("--regions must contain at least one valid region");
  return regionList;
}

/** The validated, resolved inputs a create needs, sourced from flags + spec file. */
interface ResolvedCreateInputs {
  testName: string;
  testDescription: string;
  testType: string;
  nativeMode: boolean;
  concurrency: number;
  taskCount: number;
  regionList: string[];
  tags: string[];
  healthyThreshold: number;
  nativeRunMode: NativeRunMode | undefined;
}

/**
 * Validate the resolved create inputs and normalize them into the field set the
 * body builder consumes. Runs before any API client is created, so misuse fails
 * immediately without config or auth (and `--dry-run` needs no credentials).
 * @param options The create options (flags already merged with any spec file).
 */
function resolveCreateInputs(options: CreateOptions): ResolvedCreateInputs {
  const { testName, testDescription, testType, taskCount, regions } = requireCreateFields(options);
  const nativeMode = options.nativeMode === true;

  // Native mode drives load through the framework runner and is only meaningful
  // for the script frameworks; the API rejects it for simple tests, but fail
  // here first with a clearer message.
  if (nativeMode && testType === "simple") {
    throw new Error(
      "--native-mode is only supported for jmeter, k6, and locust tests. Simple HTTP Endpoint tests always use Standard mode."
    );
  }

  const concurrency = resolveConcurrency(options, nativeMode);

  if (!/^[1-9]\d*$/.test(taskCount)) {
    throw new Error("--task-count must be a positive integer");
  }

  // Hold-for is a Standard-mode traffic control. In native mode the framework
  // controls its own run time, so timings are placeholders.
  if (!nativeMode && options.holdFor === undefined) {
    throw new Error("--hold-for is required");
  }

  // Reject a script whose extension doesn't match the framework before uploading.
  if (options.file) {
    assertScriptFileMatchesTestType(testType, options.file);
  }

  return {
    testName: testName.trim(),
    testDescription,
    testType,
    nativeMode,
    concurrency,
    taskCount: Number.parseInt(taskCount, 10),
    regionList: parseRegionList(regions),
    tags: parseTags(options.tags) ?? [],
    healthyThreshold: parseHealthyThreshold(options.healthyThreshold) ?? 90,
    // Builds the native config (safety timeout only; the script drives load).
    nativeRunMode: nativeMode ? buildNativeRunMode(options) : undefined,
  };
}

async function handleCreateScenario(options: CreateOptions, command?: Command): Promise<void> {
  // Merge a --from-file spec beneath the flags (explicit flag > file > default),
  // so the file can supply any field the flags can and both compose.
  if (options.fromFile && command) {
    applySpecFile(options as unknown as Record<string, unknown>, readSpecFile(options.fromFile), command);
  }

  // Fail fast on a bad scheduling combination before any upload or API call.
  validateSchedulingInput(options);

  const dryRun = options.dryRun === true;

  const {
    testName,
    testDescription,
    testType,
    nativeMode,
    concurrency,
    taskCount,
    regionList,
    tags,
    healthyThreshold,
    nativeRunMode,
  } = resolveCreateInputs(options);

  const testId = randomBytes(5).toString("hex");

  // Build the execution block. In native mode the execution ramp-up/hold-for
  // are unused placeholders (the framework controls timing via nativeRunMode),
  // matching the web UI's native payload.
  const execution: Record<string, unknown> = nativeMode
    ? { concurrency, "ramp-up": "0s", "hold-for": "1s" }
    : { concurrency, "ramp-up": options.rampUp ?? "0s", "hold-for": options.holdFor };

  // --- File handling --------------------------------------------------------
  // A dry run derives the fileType from the extension so it stays fully offline
  // (no upload, no API client); a real run uploads and uses the reported type.
  let api: ApiClient | undefined;
  let fileType: CreateScenarioPayload["fileType"] = "none";
  if (options.file) {
    if (dryRun) {
      fileType = fileTypeForAssetFilename(options.file);
    } else {
      api = await ApiClient.create();
      const uploadResult = await uploadTestFile(api, { filePath: options.file, testId, testType });
      fileType = uploadResult.fileType;
    }
    execution["scenario"] = testName;
  }

  // Build testScenario with scenarios object (matches web UI contract).
  const scenarios = buildScenariosObject(options, testId, execution, testName, testType);
  if (testType !== "simple") {
    execution["executor"] = testType;
  }
  const testScenario: Record<string, unknown> = { execution: [execution] };
  if (Object.keys(scenarios).length > 0) {
    testScenario["scenarios"] = scenarios;
  }

  const testTaskConfigs = regionList.map((region) => ({ region, concurrency, taskCount }));

  const payload = buildScenarioBody({
    testId,
    testName,
    testDescription,
    testType,
    fileType,
    showLive: false,
    testTaskConfigs,
    testScenario,
    regionalTaskDetails: buildRegionalTaskDetails(testTaskConfigs),
    tags,
    healthyThreshold,
    nativeRunMode,
    saveOnly: options.saveOnly,
    scheduling: options,
  });

  // Validate the assembled payload against the API's own request schema before
  // sending, so a malformed field fails locally with a clear message instead of
  // as an opaque server 400.
  validateOutboundRequest(createTestSchema, payload, "create scenario");

  // --dry-run: show the exact body that would be sent and stop.
  if (dryRun) {
    printResult(payload, { format: options.format as OutputFormat });
    return;
  }

  api ??= await ApiClient.create();
  const result = await api.post<Record<string, unknown>>("/scenarios", payload);
  printResult({ testId: (result["testId"] as string) ?? testId }, { format: options.format as OutputFormat });
}

function handleSpecTemplate(options: { testType: string; nativeMode?: boolean }): Promise<void> {
  const nativeMode = options.nativeMode === true;
  if (nativeMode && options.testType === "simple") {
    throw new Error(
      "--native-mode is only supported for jmeter, k6, and locust tests. Simple HTTP Endpoint tests always use Standard mode."
    );
  }
  // Raw JSON to stdout so it can be redirected straight into a spec file.
  console.log(JSON.stringify(buildSpecTemplate(options.testType, nativeMode), null, 2));
  return Promise.resolve();
}

interface CopyOptions {
  testName?: string;
  dryRun?: boolean;
  format: string;
}

async function handleCopyScenario(testId: string, options: CopyOptions): Promise<void> {
  const dryRun = options.dryRun === true;
  const api = await ApiClient.create();

  const existing = await api.get<Scenario>(`/scenarios/${encodeURIComponent(testId)}?history=false&latest=false`);

  const newTestId = randomBytes(5).toString("hex");
  const testType = existing.testType ?? "";
  const newName = options.testName?.trim() || existing.testName;
  const fileType = existing.fileType ?? "none";

  const parsed = parseTestScenario(existing.testScenario);

  // Script/zip tests key their uploaded asset by testId, so the copy needs its
  // own object under the new testId's key; repoint the script name to match.
  if ((fileType === "script" || fileType === "zip") && isLoadTestFramework(testType) && parsed.name) {
    const scriptEntry = parsed.scenarios[parsed.name];
    const scriptFile = typeof scriptEntry?.["script"] === "string" ? scriptEntry["script"] : undefined;
    if (scriptFile) {
      const newScript = await copyScenarioScript(api, {
        testType,
        fromTestId: existing.testId,
        toTestId: newTestId,
        scriptFileName: scriptFile,
        copyObject: !dryRun,
      });
      parsed.scenarios[parsed.name] = { ...scriptEntry, script: newScript };
    }
  }

  // Re-key the scenarios map + execution.scenario when the name changes.
  renameScenario(parsed, newName);

  const taskConfigs = (existing.testTaskConfigs ?? []).map((tc) => ({
    region: tc.region,
    taskCount: tc.taskCount,
    concurrency: tc.concurrency,
  }));

  const payload = buildScenarioBody({
    testId: newTestId,
    testName: newName,
    testDescription: existing.testDescription,
    testType,
    fileType,
    showLive: existing.showLive ?? false,
    tags: existing.tags,
    healthyThreshold: existing.healthyThreshold,
    testTaskConfigs: taskConfigs,
    testScenario: assembleTestScenario(parsed),
    regionalTaskDetails: buildRegionalTaskDetails(taskConfigs),
    nativeRunMode: existing.nativeRunMode,
    // A copy is created saved, never auto-started.
    saveOnly: true,
  });

  validateOutboundRequest(createTestSchema, payload, "copy scenario");

  if (dryRun) {
    printResult(payload, { format: options.format as OutputFormat });
    return;
  }

  const result = await api.post<Record<string, unknown>>("/scenarios", payload);
  printResult(
    { testId: (result["testId"] as string) ?? newTestId, status: "created", copiedFrom: testId },
    { format: options.format as OutputFormat }
  );
}

async function handleListScenarios(options: { format: string }): Promise<void> {
  const api = await ApiClient.create();
  const data = await api.get<ScenariosListResponse>("/scenarios");
  const scenarios = data.Items ?? [];

  if (options.format === "table") {
    const rows = scenarios.map((s: Scenario) => ({
      testId: s.testId,
      testName: s.testName,
      status: colorStatus(s.status ?? ""),
      startTime: formatTimestamp(s.startTime ?? ""),
      nextRun: formatTimestamp(s.nextRun ?? ""),
    }));
    printResult(rows, { format: "table" });
  } else if (options.format === "csv") {
    const rows = scenarios.map((s: Scenario) => ({
      testId: s.testId,
      testName: s.testName,
      status: s.status ?? "",
      startTime: s.startTime ?? "",
      nextRun: s.nextRun ?? "",
    }));
    printResult(rows, { format: "csv" });
  } else {
    printResult(scenarios, { format: "json" });
  }
}

async function handleGetScenario(testId: string, options: { format: string }): Promise<void> {
  const api = await ApiClient.create();
  const data = await api.get<Scenario>(`/scenarios/${encodeURIComponent(testId)}?history=false&latest=false`);

  if (options.format === "table") {
    // Curated table view — avoids [object Object] for nested fields
    const scenario = data.testScenario;
    const exec =
      typeof scenario === "object" && scenario !== null
        ? (scenario as Record<string, unknown>)["execution"]
        : undefined;
    const execArr = Array.isArray(exec) ? exec : [];
    const firstExec = (execArr[0] ?? {}) as Record<string, unknown>;

    const rows = [
      {
        testId: data.testId,
        testName: data.testName,
        testType: data.testType ?? "",
        status: colorStatus(data.status ?? ""),
        startTime: formatTimestamp(data.startTime ?? ""),
        endTime: formatTimestamp(((data as Record<string, unknown>)["endTime"] as string) ?? ""),
        fileType: data.fileType ?? "",
        taskCount: firstExec["taskCount"] ?? "",
        concurrency: firstExec["concurrency"] ?? "",
        rampUp: firstExec["ramp-up"] ?? "",
        holdFor: firstExec["hold-for"] ?? "",
        regions: (data.testTaskConfigs ?? []).map((t) => t.region).join(", "),
        testDescription: data.testDescription ?? "",
      },
    ];
    printResult(rows, { format: "table" });
  } else {
    printResult(data, { format: "json" });
  }
}

async function handleDeleteScenario(testId: string): Promise<void> {
  const api = await ApiClient.create();
  await api.delete(`/scenarios/${encodeURIComponent(testId)}`);
  console.error(`Scenario ${testId} deleted.`);
}

async function handleCancelScenario(testId: string): Promise<void> {
  const api = await ApiClient.create();

  // Check the test is in a cancelable state before requesting cancellation.
  // Mirrors the API's own guard (CANCELABLE_RUN_STATUSES via isCancelableRunStatus):
  // the active states minus the finishing ones (cleaning up, parsing results),
  // where a cancel has little value and races the terminal write. `cancelling`
  // is included so a repeat cancel during cleanup stays idempotent. Using the
  // shared helper keeps this in sync with the API and console instead of a
  // hand-maintained list that can drift.
  const scenario = await api.get<{ status?: string }>(
    `/scenarios/${encodeURIComponent(testId)}?history=false&latest=false`
  );
  const status = (scenario.status ?? "").toLowerCase();
  if (!isCancelableRunStatus(status)) {
    throw new Error(`Cannot cancel scenario ${testId}: test is not in a cancelable state (status: ${scenario.status})`);
  }

  const result = await api.post<Record<string, unknown>>(`/scenarios/${encodeURIComponent(testId)}`, {});
  const newStatus = (result["status"] as string) ?? "cancelling";
  console.error(`Scenario ${testId} cancel requested. Status: ${newStatus}`);
}

interface UpdateOptions extends NativeModeOptions {
  testName?: string;
  testDescription?: string;
  concurrency?: string;
  taskCount?: string;
  regions?: string;
  rampUp?: string;
  holdFor?: string;
  file?: string;
  fromFile?: string;
  tags?: string;
  healthyThreshold?: string;
  cron?: string;
  scheduleTimezone?: string;
  cronExpiryDate?: string;
  scheduleDate?: string;
  scheduleTime?: string;
  dryRun?: boolean;
  format: string;
}

/**
 * Resolve the `nativeRunMode` field for an update.
 *
 * An update rebuilds the whole `POST /scenarios` body from the existing record
 * plus overrides, so a native scenario would silently become a Standard one if
 * its `nativeRunMode` were dropped. This preserves native mode and lets
 * `--max-test-duration` change the safety timeout (else the existing value is
 * kept).
 *
 * Returns `undefined` for a Standard scenario with no native flags, leaving the
 * update path unchanged.
 * @param existing The scenario record fetched from the API.
 * @param options The update command options.
 */
function resolveUpdateNativeRunMode(existing: Scenario, options: UpdateOptions): NativeRunMode | undefined {
  const existingNative = existing.nativeRunMode;
  const durationFlag = options.maxTestDuration !== undefined;

  if (!existingNative && !durationFlag) {
    return undefined;
  }

  // Default the duration to the existing value when the flag is omitted, so the
  // builder (which requires it) has a value to work with.
  const maxTestDuration =
    options.maxTestDuration ?? (existingNative ? String(existingNative.maxTestDurationSeconds) : undefined);

  return buildNativeRunMode({ maxTestDuration });
}

/**
 * Resolve the scheduling fields for an update.
 *
 * An update rebuilds the whole `POST /scenarios` body, so an existing schedule
 * would be silently dropped unless carried forward — the same hazard
 * `resolveUpdateNativeRunMode` guards against for native mode. When scheduling
 * flags are provided they replace the schedule (and switch recurring ⇄
 * one-time); otherwise an already-scheduled scenario keeps its schedule:
 *   - recurring: the existing `cronValue` (+ `cronExpiryDate`)
 *   - one-time:  reconstructed from the stored `nextRun` (`YYYY-MM-DD HH:MM:SS`)
 *
 * Preservation is gated on `status === "scheduled"` so a fired/terminal
 * scenario is not resurrected into a schedule. Returns `undefined` when there
 * is nothing to schedule, leaving the update schedule-free.
 * @param existing The scenario record fetched from the API.
 * @param options The update command options (scheduling flags already validated).
 */
function resolveUpdateScheduling(existing: Scenario, options: UpdateOptions): SchedulingInput | undefined {
  // Explicit scheduling flags win and replace whatever the scenario had.
  if (options.cron || options.scheduleDate || options.scheduleTime) {
    return options;
  }
  // No schedule-defining flags: preserve an active schedule so an unrelated
  // edit does not wipe it (leaving a "scheduled" scenario with no next run). A
  // lone --schedule-timezone / --cron-expiry-date is not enough to define a
  // schedule on its own, but it should still override the corresponding field
  // of the preserved schedule rather than be silently ignored.
  if (existing.status !== "scheduled") {
    return undefined;
  }
  // Coalesced from optional sources, so each may be absent. Under
  // exactOptionalPropertyTypes an absent field is omitted (via a conditional
  // spread) rather than set to `undefined`, keeping SchedulingInput's fields
  // `?: string` — a present key is always a real string.
  const scheduleTimezone = options.scheduleTimezone ?? existing.scheduleTimezone;
  const tz = scheduleTimezone === undefined ? {} : { scheduleTimezone };
  if (existing.cronValue) {
    const cronExpiryDate = options.cronExpiryDate ?? existing.cronExpiryDate;
    return {
      cron: existing.cronValue,
      ...(cronExpiryDate === undefined ? {} : { cronExpiryDate }),
      ...tz,
    };
  }
  // One-time: the API returns scheduleDate/scheduleTime (derived from nextRun)
  // on read, so use them directly to preserve the schedule.
  if (existing.scheduleDate && existing.scheduleTime) {
    return { scheduleDate: existing.scheduleDate, scheduleTime: existing.scheduleTime, ...tz };
  }
  return undefined;
}

/** Merge task configs with update options (new regions, concurrency, or taskCount). */
function mergeTaskConfigs(
  existing: Array<{ region: string; concurrency: number; taskCount: number }>,
  options: { regions?: string; concurrency?: string; taskCount?: string }
): Array<{ region: string; concurrency: number; taskCount: number }> {
  if (options.regions) {
    const regionList = options.regions
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    const concurrency = options.concurrency
      ? parsePositiveInt(options.concurrency, "--concurrency")
      : (existing[0]?.concurrency ?? 1);
    const taskCount = options.taskCount
      ? parsePositiveInt(options.taskCount, "--task-count")
      : (existing[0]?.taskCount ?? 1);
    return regionList.map((region) => ({ region, concurrency, taskCount }));
  }
  if (options.taskCount || options.concurrency) {
    return existing.map((tc) => ({
      ...tc,
      concurrency: options.concurrency ? parsePositiveInt(options.concurrency, "--concurrency") : tc.concurrency,
      taskCount: options.taskCount ? parsePositiveInt(options.taskCount, "--task-count") : tc.taskCount,
    }));
  }
  return existing;
}

async function handleUpdateScenario(testId: string, options: UpdateOptions, command?: Command): Promise<void> {
  // Merge a --from-file spec beneath the flags (flag > file > default). On
  // update the merged options are applied on top of the existing scenario.
  if (options.fromFile && command) {
    applySpecFile(options as unknown as Record<string, unknown>, readSpecFile(options.fromFile), command);
  }

  // Fail fast on a bad scheduling combination before any upload or API call.
  validateSchedulingInput(options);

  const dryRun = options.dryRun === true;
  const api = await ApiClient.create();

  // Auto-trim the name once when provided; omitted keeps the existing name.
  if (options.testName !== undefined) options.testName = options.testName.trim();

  // Fetch the existing scenario — update is a merge of the stored config.
  const existing = await api.get<Scenario>(`/scenarios/${encodeURIComponent(testId)}?history=false&latest=false`);

  // Merge the provided options into the existing testScenario object.
  const parsed = parseTestScenario(existing.testScenario);

  if (options.concurrency) {
    parsed.execution["concurrency"] = parsePositiveInt(options.concurrency, "--concurrency");
  }
  if (options.rampUp) {
    parsed.execution["ramp-up"] = options.rampUp;
  }
  if (options.holdFor) {
    parsed.execution["hold-for"] = options.holdFor;
  }
  // A rename must also re-key the scenarios map and execution.scenario; a no-op
  // when the name is unchanged or omitted.
  if (options.testName) {
    renameScenario(parsed, options.testName);
  }

  const testScenario = assembleTestScenario(parsed);

  // Handle regions and task configs.
  const taskConfigs = mergeTaskConfigs(existing.testTaskConfigs ?? [], options);

  // File upload — skipped on a dry run, where fileType is derived from the
  // extension so the preview stays side-effect free. Validate the extension
  // against the (unchanged) test type first.
  let fileType = existing.fileType ?? "none";
  if (options.file) {
    assertScriptFileMatchesTestType(existing.testType ?? "", options.file);
    fileType = dryRun
      ? fileTypeForAssetFilename(options.file)
      : (
          await uploadTestFile(api, {
            filePath: options.file,
            testId: existing.testId,
            testType: existing.testType ?? "simple",
          })
        ).fileType;
  }

  // Assemble the update body through the shared builder. Preserving an existing
  // nativeRunMode (an update rebuilds the whole body, so it would otherwise be
  // dropped) is handled by resolveUpdateNativeRunMode. Update always saves only.
  const scheduling = resolveUpdateScheduling(existing, options);

  const payload = buildScenarioBody({
    testId: existing.testId,
    testName: options.testName ?? existing.testName,
    testDescription: options.testDescription ?? existing.testDescription,
    testType: existing.testType ?? "",
    fileType,
    showLive: existing.showLive ?? false,
    // A provided --tags replaces the existing set; otherwise the existing tags
    // are preserved. Same pattern for --healthy-threshold.
    tags: parseTags(options.tags) ?? existing.tags ?? [],
    healthyThreshold: parseHealthyThreshold(options.healthyThreshold) ?? existing.healthyThreshold,
    testTaskConfigs: taskConfigs,
    testScenario,
    regionalTaskDetails: buildRegionalTaskDetails(taskConfigs),
    nativeRunMode: resolveUpdateNativeRunMode(existing, options),
    // A plain update must not start a run, so it is save-only. But a scheduled
    // update must NOT be save-only: the API embeds saveOnly into the scheduled
    // config, and a saveOnly scheduled run fires without ever launching. The
    // schedule never starts a run immediately (dispatch routes to the
    // scheduler), so omitting saveOnly here is safe. buildScenarioBody only
    // emits saveOnly when truthy, so the false (scheduled) case is dropped.
    saveOnly: !scheduling,
    scheduling,
  });

  // Update posts to the same `POST /scenarios` endpoint and is validated by the
  // same shared schema, so validate the merged payload locally before sending.
  validateOutboundRequest(createTestSchema, payload, "update scenario");

  if (dryRun) {
    printResult(payload, { format: options.format as OutputFormat });
    return;
  }

  const result = await api.post<Record<string, unknown>>("/scenarios", payload);
  printResult(
    { testId: (result["testId"] as string) ?? testId, status: "updated" },
    { format: options.format as OutputFormat }
  );
}

interface ResultsOptions {
  format?: string;
  json?: boolean;
  csv?: boolean;
  failOnErrorRate?: string;
  failOnP99?: string;
  failOnP95?: string;
  failOnAvgRt?: string;
  failOnThroughputBelow?: string;
  failOnBaselineRegression?: string;
}

/**
 * Resolve the effective output format for `scenarios results`.
 *
 * `--format <table|json|csv>` is the primary option (registered via the shared
 * formatOption() helper, which defaults to "table"). `--json` / `--csv` remain
 * as back-compat aliases. Precedence: an explicitly-provided `--format` value
 * wins; otherwise a `--json`/`--csv` alias is honored; otherwise the default
 * ("table").
 *
 * Conflicts rejected:
 * - `--json` + `--csv` (mutually exclusive aliases).
 * - a `--json`/`--csv` alias that disagrees with an explicitly-supplied
 *   `--format` value (e.g. `--json --format csv`).
 *
 * An explicit `--format` is distinguished from the default via Commander's
 * option value source, so `--json --format json` (agreeing) is accepted while
 * `--json --format csv` (disagreeing) errors.
 */
function resolveResultsFormat(options: ResultsOptions, command?: Command): OutputFormat {
  if (options.json && options.csv) {
    throw new Error("--json and --csv are mutually exclusive");
  }

  let alias: OutputFormat | undefined;
  if (options.json) {
    alias = "json";
  } else if (options.csv) {
    alias = "csv";
  }

  // Determine whether --format was explicitly supplied (vs. the "table" default).
  const source = command?.getOptionValueSource?.("format");
  const explicitFormat =
    source === "cli" || source === "env" ? (options.format as OutputFormat | undefined) : undefined;

  if (alias && explicitFormat && alias !== explicitFormat) {
    const aliasFlag = options.json ? "--json" : "--csv";
    throw new Error(
      `${aliasFlag} conflicts with --format ${explicitFormat}. ` +
        `Use either the ${aliasFlag} alias or --format, not both with disagreeing values.`
    );
  }

  return explicitFormat ?? alias ?? "table";
}

async function handleResultsScenario(testId: string, options: ResultsOptions, command?: Command): Promise<void> {
  // Resolve output format from --format and the --json/--csv back-compat aliases.
  const format = resolveResultsFormat(options, command);

  const api = await ApiClient.create();

  const latestRun = await fetchLatestRun(api, testId);
  if (!latestRun) {
    throw new Error(`No completed run found for scenario ${testId}`);
  }

  // Verify the run actually completed — a running or cancelled run won't have valid results
  const runStatus = (latestRun.status ?? "").toLowerCase();
  if (runStatus !== "completed" && runStatus !== "complete") {
    throw new Error(`No completed run found for scenario ${testId}. Latest run status: ${latestRun.status}`);
  }

  // Extract results from the run (used for threshold evaluation below)
  const total = extractTotalResults(latestRun);

  // Shared renderer; `scenarios results` emits the curated row for json (not the
  // raw run), so no jsonValue override is passed.
  renderRun(latestRun, format);

  // Evaluate thresholds if any are provided
  await applyThresholdGate(api, testId, total, {
    failOnErrorRate: options.failOnErrorRate,
    failOnP99: options.failOnP99,
    failOnP95: options.failOnP95,
    failOnAvgRt: options.failOnAvgRt,
    failOnThroughputBelow: options.failOnThroughputBelow,
    failOnBaselineRegression: options.failOnBaselineRegression,
  });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Unified threshold gate: parse flags, evaluate metrics + baseline regression,
 * report breaches, and set process.exitCode = 2 on any breach.
 * Returns true if thresholds were evaluated (regardless of pass/fail).
 */
async function applyThresholdGate(
  api: ApiClient,
  testId: string,
  total: TestResultsData,
  flags: Record<string, string | undefined>
): Promise<boolean> {
  const thresholdConfig = parseThresholdFlags(flags);
  if (Object.keys(thresholdConfig).length === 0) return false;

  // Normalize latency to milliseconds once. Both the direct threshold checks and
  // the baseline regression comparison depend on consistent units; nested-format
  // (results.total) data is in seconds and would otherwise silently never breach.
  const normalizedTotal = normalizeTotalToMs(total);

  let allBreaches: Array<{ metric: string; threshold: number; actual: number; unit: string }> = [];

  // Baseline regression is evaluated separately (requires API call)
  if (thresholdConfig.failOnBaselineRegression === undefined) {
    const thresholdResult = evaluateThresholds(normalizedTotal, thresholdConfig);
    allBreaches = thresholdResult.breaches;
  } else {
    const baselineBreaches = await fetchAndEvaluateBaselineRegression(
      api,
      testId,
      normalizedTotal,
      thresholdConfig.failOnBaselineRegression
    );
    const { failOnBaselineRegression: _, ...nonBaselineConfig } = thresholdConfig;
    const thresholdResult = evaluateThresholds(normalizedTotal, nonBaselineConfig);
    allBreaches = [...thresholdResult.breaches, ...baselineBreaches];
  }

  if (allBreaches.length > 0) {
    console.error("\nThreshold breaches:");
    for (const b of allBreaches) {
      console.error(`  ${b.metric}: ${b.actual}${b.unit} (threshold: ${b.threshold}${b.unit})`);
    }
    // Don't downgrade a more severe exit code (e.g. 3 = baseline fetch failed,
    // set by fetchAndEvaluateBaselineRegression) to 2 = threshold breach.
    const currentExit = Number(process.exitCode) || 0;
    if (currentExit < 3) {
      process.exitCode = 2;
    }
  }

  return true;
}

/** Parse a numeric value from an unknown baseline field. */
function parseBaselineNumeric(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") return Number.parseFloat(val);
  return 0;
}

/** Normalize baseline data from seconds to milliseconds and convert throughput to req/s. */
function normalizeBaselineToMs(baseline: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...baseline };

  for (const key of LATENCY_KEYS_SECONDS) {
    const val = normalized[key];
    if (val !== undefined && val !== null) {
      normalized[key] = parseBaselineNumeric(val) * 1000;
    }
  }

  // Baseline throughput is total requests; convert to req/s using testDuration.
  const testDuration = parseBaselineNumeric(normalized["testDuration"]);
  const totalThroughput = parseBaselineNumeric(normalized["throughput"]);
  if (testDuration > 0 && totalThroughput > 0) {
    normalized["throughput"] = totalThroughput / testDuration;
  } else if (totalThroughput > 0) {
    // Total requests can't be converted to req/s without a valid duration.
    // Drop it so the regression comparison is skipped rather than comparing
    // total-requests against the current run's req/s (a false regression).
    delete normalized["throughput"];
  }

  return normalized;
}

/**
 * Fetch baseline for a scenario and evaluate regression against current results.
 * Returns breaches array (empty if no baseline or no regression).
 */
async function fetchAndEvaluateBaselineRegression(
  api: ApiClient,
  testId: string,
  currentResults: TestResultsData,
  thresholdPercent: number
): Promise<Array<{ metric: string; threshold: number; actual: number; unit: string }>> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const baselineResp = await api.get<BaselineResponse>(`/scenarios/${encodeURIComponent(testId)}/baseline`);

      if (!baselineResp.baselineId) {
        console.error("Warning: No baseline is set for this scenario. Skipping baseline regression check.");
        return [];
      }

      const baselineTotal = baselineResp.testRunDetails?.results?.["total"];
      if (!baselineTotal) {
        console.error("Warning: Baseline run has no results data. Skipping baseline regression check.");
        return [];
      }

      // Baseline data from API is in seconds; current results may be in ms (flat format).
      const isCurrentMs = (currentResults as Record<string, unknown>)["_unitsMs"] === true;
      const normalizedBaseline = isCurrentMs ? normalizeBaselineToMs(baselineTotal) : baselineTotal;

      return evaluateBaselineRegression(currentResults, normalizedBaseline, thresholdPercent);
    } catch (err: unknown) {
      if (attempt < maxAttempts) {
        // Retry once after a short backoff (handles transient throttling)
        await sleep(2000);
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: Baseline fetch failed after ${maxAttempts} attempts (${msg}). Failing gate as closed.`);
      process.exitCode = 3;
      return [];
    }
  }

  return []; // unreachable, satisfies TypeScript
}

async function handleStartScenarios(
  testIds: string[],
  options: {
    name?: string;
    format: string;
    wait?: boolean;
    pollInterval?: string;
    failOnErrorRate?: string;
    failOnP99?: string;
    failOnP95?: string;
    failOnAvgRt?: string;
    failOnThroughputBelow?: string;
    failOnBaselineRegression?: string;
  }
): Promise<void> {
  const api = await ApiClient.create();

  // Resolve --name to testId(s)
  if (options.name && testIds.length === 0) {
    const data = await api.get<ScenariosListResponse>("/scenarios");
    const scenarios = data.Items ?? [];
    const needle = options.name.toLowerCase();
    const matches = scenarios.filter((s) => s.testName.toLowerCase() === needle);
    if (matches.length === 0) {
      const available = scenarios.map((s) => `  ${s.testId}  ${s.testName}`);
      throw new Error(`No scenario found with name "${options.name}". Available scenarios:\n${available.join("\n")}`);
    }
    if (matches.length > 1) {
      const dupes = matches.map((s) => `  ${s.testId}  ${s.testName}`);
      throw new Error(
        `Multiple scenarios match name "${options.name}":\n${dupes.join("\n")}\nUse a testId to disambiguate.`
      );
    }
    testIds = [matches[0]!.testId];
  }

  if (testIds.length === 0) {
    throw new Error("Provide at least one testId or use --name to specify a scenario by name.");
  }

  interface StartResult {
    testId: string;
    status: string;
    error?: string;
  }

  const results: StartResult[] = [];

  for (const testId of testIds) {
    try {
      const result = (await startScenario(api, testId)) as Record<string, unknown>;
      results.push({
        testId,
        status: (result["status"] as string) ?? "started",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error starting ${testId}: ${message}`);
      results.push({ testId, status: "failed", error: message });
    }
  }

  const hasFailures = results.some((r) => r.status === "failed");

  // --wait: poll until all successfully-started tests complete
  if (options.wait && !hasFailures) {
    const startedIds = results.filter((r) => r.status !== "failed").map((r) => r.testId);

    if (startedIds.length > 0) {
      const parsed = Number.parseInt(options.pollInterval ?? "15", 10);
      if (Number.isNaN(parsed)) {
        throw new Error(`Invalid --poll-interval value: "${options.pollInterval}". Must be a number (in seconds).`);
      }
      const interval = Math.max(5, parsed) * 1000;
      const startMs = Date.now();

      console.error(`\nWaiting for ${startedIds.length} test(s) to complete (polling every ${interval / 1000}s)...`);

      const pending = new Set(startedIds);

      while (pending.size > 0) {
        await sleep(interval);
        const elapsed = Math.round((Date.now() - startMs) / 1000);

        for (const tid of [...pending]) {
          const scenario = await api.get<{
            status?: string;
            testId: string;
          }>(`/scenarios/${encodeURIComponent(tid)}?history=false&latest=false`);
          if (!isActive(scenario.status)) {
            pending.delete(tid);
            console.error(`  ✓ ${tid} finished (status: ${scenario.status}, elapsed: ${elapsed}s)`);
          }
        }

        if (pending.size > 0) {
          console.error(`  Still running: ${[...pending].join(", ")} (elapsed: ${elapsed}s)`);
        }
      }

      // Fetch final run results for each started test
      const finalResults: Record<string, unknown>[] = [];
      const latestRuns = new Map<string, Record<string, unknown>>();
      for (const tid of startedIds) {
        try {
          const latest = await fetchLatestRun(api, tid);
          if (latest) {
            latestRuns.set(tid, latest);
            finalResults.push(options.format === "table" ? colorRunRow(curateRunRow(latest)) : latest);
          }
        } catch {
          // If we can't fetch the run, just skip it
        }
      }

      if (finalResults.length > 0) {
        console.error("\nFinal results:");
        printResult(finalResults, { format: options.format as OutputFormat });
      }

      // Check for errors in final results
      for (const r of finalResults) {
        const errors = r["errors"];
        if (typeof errors === "number" && errors > 0) {
          process.exitCode = 1;
        }
      }

      // Evaluate thresholds using the already-fetched run data (no redundant API call)
      for (const tid of startedIds) {
        const latestRun = latestRuns.get(tid);
        if (!latestRun) continue;
        const total = extractTotalResults(latestRun);
        try {
          await applyThresholdGate(api, tid, total, {
            failOnErrorRate: options.failOnErrorRate,
            failOnP99: options.failOnP99,
            failOnP95: options.failOnP95,
            failOnAvgRt: options.failOnAvgRt,
            failOnThroughputBelow: options.failOnThroughputBelow,
            failOnBaselineRegression: options.failOnBaselineRegression,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Warning: Unable to evaluate thresholds for ${tid}. (${msg})`);
        }
      }

      return;
    }
  }

  // Output summary
  if (testIds.length === 1 && results[0]!.status !== "failed") {
    printResult(results[0]!, { format: options.format as OutputFormat });
  } else {
    printResult(results, { format: options.format as OutputFormat });
  }

  // Fix 1: set nonzero exit code when any start failed
  if (hasFailures) {
    process.exitCode = 1;
  }
}
