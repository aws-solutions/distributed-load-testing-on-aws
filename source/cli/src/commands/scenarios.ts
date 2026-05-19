// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { ApiClient } from "../lib/api-client.js";
import { printResult, formatOption } from "../lib/output.js";
import { withErrorHandler } from "../lib/error-handler.js";
import { startScenario } from "../lib/scenario-launcher.js";
import { ACTIVE_STATUSES, curateRunRow, colorRunRow, sleep, formatTimestamp } from "../lib/run-formatters.js";
import { colorStatus } from "../lib/color.js";
import type { OutputFormat, Scenario, ScenariosListResponse, TestRunsResponse } from "../lib/types.js";

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
    .command("start [testId...]")
    .description("Start (re-run) one or more test scenarios")
    .option("--name <name>", "Start a scenario by name instead of testId")
    .option("--wait", "Wait for the test(s) to complete before exiting")
    .option("--poll-interval <seconds>", "Polling interval in seconds when using --wait", "15")
    .addOption(formatOption())
    .action(withErrorHandler(handleStartScenarios));
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

async function handleStartScenarios(
  testIds: string[],
  options: {
    name?: string;
    format: string;
    wait?: boolean;
    pollInterval?: string;
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
      const parsed = parseInt(options.pollInterval ?? "15", 10);
      if (isNaN(parsed)) {
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
          if (!ACTIVE_STATUSES.has(scenario.status ?? "")) {
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
      for (const tid of startedIds) {
        try {
          const runsData = await api.get<TestRunsResponse>(
            `/scenarios/${encodeURIComponent(tid)}/testruns?limit=1&latest=true`
          );
          const latest = runsData.testRuns?.[0];
          if (latest) {
            finalResults.push(
              options.format === "table" ? colorRunRow(curateRunRow(latest)) : (latest as Record<string, unknown>)
            );
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
