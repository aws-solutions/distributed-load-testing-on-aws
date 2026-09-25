// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Canonical names and definitions for the two traffic-shape modes, Standard and
 * Native — the single source of truth for how every surface describes them.
 *
 * v4.3.0 introduced Native and, before this module existed, each surface wrote
 * its own wording: the console create form said "Script-Defined", the detail
 * pages said "Native Mode", the CLI said "the framework's native runner", the
 * MCP schema said "native-runner configuration", and the OpenAPI spec called the
 * other mode "Taurus". Standard had no name at all on most surfaces. Every
 * surface now picks one of the two definitions below rather than paraphrasing,
 * because paraphrasing per surface is exactly how those five names accumulated.
 *
 * Each mode gets a label and exactly three definitions, one per tier. Do not add
 * a fourth tier, and do not paraphrase a tier at the call site. If a surface
 * needs different wording, change it here so every surface moves together.
 *
 * - **short** (1 to 2 sentences) for space-constrained controls: the console
 *   segmented-control helper text, CLI option help, table cells, list columns.
 * - **medium** (one paragraph) for anywhere with room to explain the choice. This
 *   is the default tier for every in-product surface and repository document.
 * - **long** (two paragraphs) for the Implementation Guide only. It is the sole
 *   consumer. Long was previously used on the info panel, in `dlt scenarios
 *   create --help`, and in the MCP tool descriptions, and it was too long for all
 *   three; medium exists because of that.
 *
 * Which surface takes which tier, for reference when adding one:
 *
 * - short: the console traffic-shape control, CLI option help, the MCP workflow
 *   guides, the CHANGELOG.
 * - medium: the console info panel, `dlt scenarios create --help`, the MCP
 *   `native_run_mode` tool description, the OpenAPI `NativeRunMode` schema, and
 *   the top-level, CLI, and MCP READMEs.
 * - long: the Implementation Guide, and nothing else.
 *
 * Only the length ordering is enforced, by tests. The surface list above is
 * guidance, and it cannot be anything stronger: the Implementation Guide lives in
 * a separate repository (`AWSSolDoc-DistributedLoadTesting`) that cannot import
 * this module at all.
 *
 * Two constraints on the strings themselves:
 *
 * - **Plain prose, no markup.** These reach markdown (the console info panel,
 *   the READMEs), plain text (`dlt scenarios create --help`), and JSON (the MCP
 *   tool schema). Backticks or bold would render literally in two of the three,
 *   so callers add their own emphasis. Paragraphs are separated by a blank line,
 *   matching how `webui/src/help/content.ts` already joins its topic bodies.
 * - **No file paths or internal identifiers.** Every tier is written for someone
 *   deciding which mode to use, not for someone reading the codebase. The source
 *   anchors backing each factual claim live in the design doc.
 *
 * Avoid describing Standard as "legacy" or "classic". Standard is the default
 * and is not deprecated; the CLI already uses "legacy" for its `--json`/`--csv`
 * flag aliases, and "classic" implies exactly the deprecation we do not mean.
 */

/** The two traffic-shape modes. Values match the stored `testMode` vocabulary. */
export type TrafficShapeMode = "standard" | "native";

/** Human-readable mode name. The only label any surface should show. */
export const TRAFFIC_SHAPE_LABELS: Record<TrafficShapeMode, string> = {
  standard: "Standard",
  native: "Native",
};

/**
 * One to two sentences, for space-constrained surfaces: the console segmented
 * control helper text, CLI option help, and any table cell or list column that
 * names the mode.
 */
export const TRAFFIC_SHAPE_SHORT_DEFINITIONS: Record<TrafficShapeMode, string> = {
  standard:
    "DLT controls the load: you set tasks, concurrent virtual users, ramp-up, and hold duration, and Taurus applies them, overriding any load shape your script defines. This is the behavior DLT has always used, and the only mode that supports testing a single URL with no script.",
  native:
    "Your script controls the load: DLT runs it under the framework's own command line and passes no load flags, setting only the task count per Region and a safety duration. Each task runs a full copy of the script, so total load is your script's own load multiplied by the task count.",
};

/**
 * One paragraph, and the default tier: the console info panel, the
 * `dlt scenarios create --help` description block, the MCP `native_run_mode` tool
 * description, the OpenAPI `NativeRunMode` schema, and all three READMEs.
 *
 * Medium keeps every fact a reader or an agent acts on and drops what only
 * illustrates: the "typical uses" examples and the per-framework rewrite detail
 * carried by {@link TRAFFIC_SHAPE_LONG_DEFINITIONS}. Native runs longer than
 * Standard deliberately. The task-multiplication arithmetic and the
 * safety-duration outcome are the two facts people get wrong, and conveying them
 * is the whole reason the MCP tool description is not on the short tier.
 */
export const TRAFFIC_SHAPE_MEDIUM_DEFINITIONS: Record<TrafficShapeMode, string> = {
  standard:
    "Standard mode puts DLT in control of the load. You set the Fargate task count per Region, the concurrent virtual users per task, a ramp-up period, and a hold duration, and DLT runs the test through the Taurus automation framework, which applies those values over whatever load your script declares. A Region's virtual users are the task count multiplied by the per-task concurrency. Standard is the only mode that lets you set an exact virtual-user count and change the ramp-up and hold shape without editing the script, and the only one that supports the Simple HTTP Endpoint type. Its limit is expressiveness: anything Taurus cannot represent, such as weighted scenarios, per-stage thresholds, or arrival-rate executors, is unavailable. This is how every DLT test ran before v4.3.0, so existing scenarios keep behaving exactly as they did.",
  native:
    "Native mode puts your script in control of the load. DLT runs the file you uploaded under the framework's own command line and passes no load flags, so your script is the sole authority on the traffic it generates. Two controls remain: how many Fargate tasks to launch per Region, and a required safety duration of up to 24 hours. The safety duration guards against a script that never exits rather than scheduling the run: if the test is still going when it elapses, DLT stops the framework, keeps the results for the portion that ran, and records the run as completed. Tasks are uncoordinated and each runs a full copy of the script, so a k6 script holding 200 virtual users on five tasks puts 1,000 virtual users on the target. Task count is therefore the only load dial; changing the ramp, the hold time, or the virtual-user count means editing the script. Native requires an uploaded script, so Simple HTTP Endpoint is unavailable, and Locust scripts must not set processes.",
};

/**
 * Two paragraphs, for the Implementation Guide only.
 *
 * Every other surface takes {@link TRAFFIC_SHAPE_MEDIUM_DEFINITIONS}. The IG is
 * the one place with room for the "typical uses" examples and the per-framework
 * detail, and it is also the only surface a reader arrives at already wanting the
 * full explanation rather than a decision.
 */
export const TRAFFIC_SHAPE_LONG_DEFINITIONS: Record<TrafficShapeMode, string> = {
  standard: [
    "Standard mode puts DLT in control of the load. You set the number of Fargate tasks per Region, the concurrent virtual users per task, a ramp-up period, and a hold duration. DLT runs your test through the Taurus automation framework, which translates those values into the underlying framework's own load controls. Taurus takes precedence over whatever load your script declares, so a k6 options block, a Locust LoadTestShape, or a JMeter thread group is rewritten or ignored. A Region's virtual users are the task count multiplied by the per-task concurrency, and the shape is the same whichever framework you chose. This is how every DLT test ran before v4.3.0, so scenarios created earlier keep behaving exactly as they did and need no changes.",
    "Choose Standard when the load shape belongs outside the script, set from the console, the CLI, or an agent. Standard is the only mode that lets you set an exact virtual-user count and change the ramp-up and hold shape without touching the script. Only Standard supports the Simple HTTP Endpoint type, where DLT generates the test plan for you. Typical uses: a capacity check stepping 500 to 5,000 virtual users, a nightly regression holding 1,000 users for ten minutes, or any comparison needing an identical ramp. Its limit is expressiveness. Anything Taurus cannot represent is unavailable here, including multiple weighted scenarios, per-stage thresholds, and arrival-rate executors.",
  ].join("\n\n"),
  native: [
    "Native mode puts your script in control of the load. DLT runs the file you uploaded under the framework's own command line: jmeter -n -t, k6 run, or locust --headless. It passes no load flags, so your script is the sole authority on the traffic it generates and DLT never rewrites it. Two controls remain: how many Fargate tasks to launch per Region, and a required safety duration of up to 24 hours. The safety duration is a guard against a script that never exits, not a schedule. If a test is still running when the duration elapses, DLT stops the framework, collects the results for the portion that ran, and records the run as completed rather than failed. Each task runs as an independent framework process with no coordination between tasks, so a Region generates one full copy of your script's declared load per task. A k6 script that holds 200 virtual users, run on five tasks, puts 1,000 virtual users on the target. Task count is therefore the only load dial Native gives you, and it moves in whole multiples of whatever the script declares. Changing the ramp, the hold time, or the virtual-user count itself means editing the script.",
    "Choose Native when you want to run a script exactly as it was written. A script that already runs locally or in CI runs unchanged on DLT, which is the main reason to reach for Native. Native preserves everything the framework can express: k6 scenarios, stages, and thresholds; Locust LoadTestShape classes and weighted task sets; JMeter timers and thread groups. Pick it when the load shape is part of what the test means, and reproducing it faithfully matters more than steering it from outside. Typical uses: reusing a k6 script from a pipeline without rewriting it, a spike-then-recover profile, or weighted scenarios that a single concurrency number cannot express. Two constraints follow from running the framework as authored. Native requires an uploaded script, so Simple HTTP Endpoint is unavailable. Locust scripts must not set processes, because DLT counts requests only when Locust runs as a single process.",
  ].join("\n\n"),
};

/** One row of {@link TRAFFIC_SHAPE_DECISION_TABLE}. */
export interface TrafficShapeDecision {
  /** What the test writer is trying to do. */
  readonly need: string;
  /** The mode that satisfies it. Render the name via {@link TRAFFIC_SHAPE_LABELS}. */
  readonly mode: TrafficShapeMode;
}

/**
 * Quick decision table for test writers, exported as data rather than prose
 * because three surfaces render it: the IG's traffic-shape section, the CLI
 * README, and the MCP workflow guides. A table retyped three times drifts the
 * same way the mode labels did.
 *
 * The Standard rows deliberately name what only Standard can do. "Change load
 * levels without editing the script" is not one of them: Native changes load
 * levels too, by task count, so the honest discriminators are the exact
 * virtual-user count and the ramp and hold shape.
 */
export const TRAFFIC_SHAPE_DECISION_TABLE: readonly TrafficShapeDecision[] = [
  { need: "An exact virtual-user count, set from outside the script", mode: "standard" },
  { need: "To change the ramp-up or hold time without editing the script", mode: "standard" },
  { need: "A single URL with no script at all", mode: "standard" },
  { need: "The same load shape regardless of framework", mode: "standard" },
  { need: "To reuse a CI or local script unchanged", mode: "native" },
  { need: "The script's own stages, thresholds, or shape honored", mode: "native" },
  { need: "k6 scenarios, thresholds, or arrival-rate executors", mode: "native" },
  { need: "A Locust LoadTestShape or weighted task set", mode: "native" },
  { need: "JMeter timers and thread groups run exactly as authored", mode: "native" },
  { need: "To scale load only in whole multiples of the script's own load", mode: "native" },
];
