// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Single source of truth for the `POST /scenarios` request body.
 *
 * `create`, `update`, and `start` all send the same contract, but each sources
 * its data differently (fresh flags, a merged existing record, a re-run of a
 * stored scenario). Historically each assembled the body inline, which is how
 * `start` silently dropped `nativeRunMode`: a field added to one path was
 * forgotten by the others. Routing all three through `buildScenarioBody` means
 * the set of fields the body carries — and how optional ones are included — is
 * defined in exactly one place.
 */

import type { CreateTestValidation, NativeRunMode } from "@amzn/dlt-common";
import { scheduleDateSchema, scheduleTimeSchema, parseISODate, timezoneAwareNow } from "@amzn/dlt-common";

/**
 * Request payload types for `POST /scenarios`, derived from the shared zod
 * schema (`createTestSchema`) exported by `@amzn/dlt-common`. Deriving the
 * types here means a field that is renamed or removed in the shared schema
 * breaks this build at compile time instead of silently sending a stale
 * contract to the API.
 *
 * `KnownKeys` strips the catch-all index signature that `createTestSchema`'s
 * `.passthrough()` adds to the inferred type. Without stripping it, a removed
 * field would be silently absorbed by the index signature; with it stripped,
 * drift in any named field fails compilation.
 */
type KnownKeys<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/** Full `POST /scenarios` create body, keyed by the shared schema's fields. */
export type CreateScenarioPayload = KnownKeys<CreateTestValidation>;

/**
 * A partial `POST /scenarios` body. Keys are constrained to the shared schema's
 * field names (so a rename/removal breaks the build) while values stay
 * `unknown` because callers merge heterogeneous existing data into it.
 */
export type PartialScenarioPayload = Partial<Record<keyof CreateScenarioPayload, unknown>>;

/**
 * Scheduling fields shared by create and update.
 *
 * Two mutually exclusive scheduled modes are supported, mirroring the web
 * console: a recurring schedule (`cron`, optionally with `cronExpiryDate`) and
 * a one-time run (`scheduleDate` + `scheduleTime`, the console's "Run Once").
 * Providing neither is a plain "Run Now". The cadence lives entirely in the
 * cron expression — there is no separate `recurrence` knob (the console
 * hardcodes it and the API ignores it when a cron value is present).
 */
export interface SchedulingInput {
  cron?: string;
  cronExpiryDate?: string;
  scheduleTimezone?: string;
  /** One-time run date, `YYYY-MM-DD` (paired with `scheduleTime`). */
  scheduleDate?: string;
  /** One-time run time, `HH:MM` 24-hour (paired with `scheduleDate`). */
  scheduleTime?: string;
}

/**
 * Validate a scheduling flag combination, throwing a clear, actionable error.
 *
 * The two scheduled modes are mutually exclusive, and a one-time run needs both
 * a date and a time. Format is checked against the shared schemas so the CLI's
 * rule cannot drift from the API's. Runs before any API call or upload, so a
 * bad combination fails fast (and needs no credentials for `--dry-run`).
 * @param scheduling The resolved scheduling flags.
 */
/**
 * Reject an explicit `--schedule-timezone` that is not a valid IANA zone, so a
 * bad zone is reported as such rather than surfacing later as a misleading
 * "not a valid date/time" when it makes the one-time date parse fail. A blank/
 * omitted value is left to the downstream default.
 */
function assertValidTimezone(scheduleTimezone: string | undefined): void {
  if (scheduleTimezone && !timezoneAwareNow(scheduleTimezone).isValid) {
    throw new Error(
      `--schedule-timezone '${scheduleTimezone}' is not a valid IANA timezone (e.g. UTC, US/Pacific).`
    );
  }
}

/**
 * Validate a one-time run's date + time (both known present): format, real
 * calendar date, and that the instant is in the future.
 *
 * The format regex allows nonexistent calendar dates (e.g. 2027-02-30); luxon
 * flags those as invalid, reported distinctly from the future check so the
 * message is not misleading. The API's one-time path enforces neither, so a bad
 * or past date would otherwise silently create a schedule that never fires.
 */
function assertValidFutureInstant(scheduling: SchedulingInput): void {
  if (!scheduleDateSchema.safeParse(scheduling.scheduleDate).success) {
    throw new Error("--schedule-date must be in YYYY-MM-DD format (e.g. 2027-01-31).");
  }
  if (!scheduleTimeSchema.safeParse(scheduling.scheduleTime).success) {
    throw new Error("--schedule-time must be in HH:MM 24-hour format (e.g. 14:30).");
  }
  const zone = scheduling.scheduleTimezone ?? "UTC";
  const runAt = parseISODate(`${scheduling.scheduleDate}T${scheduling.scheduleTime}`, zone);
  if (!runAt.isValid) {
    throw new Error("--schedule-date/--schedule-time is not a valid date/time.");
  }
  if (runAt.toMillis() <= timezoneAwareNow(zone).toMillis()) {
    throw new Error("--schedule-date/--schedule-time must be a future date and time.");
  }
}

export function validateSchedulingInput(scheduling: SchedulingInput): void {
  const hasCron = Boolean(scheduling.cron);
  const hasDate = Boolean(scheduling.scheduleDate);
  const hasTime = Boolean(scheduling.scheduleTime);
  const hasOneTime = hasDate || hasTime;

  if (hasCron && hasOneTime) {
    throw new Error(
      "Use either --cron (recurring schedule) or --schedule-date/--schedule-time (one-time run), not both."
    );
  }
  if (hasDate !== hasTime) {
    throw new Error("--schedule-date and --schedule-time must be provided together for a one-time run.");
  }
  // cronExpiryDate bounds a recurring schedule; on a one-time run the API would
  // set it as the schedule's EndDate, and an expiry before the run instant makes
  // the run silently never fire.
  if (hasOneTime && scheduling.cronExpiryDate) {
    throw new Error("--cron-expiry-date applies only to a recurring --cron schedule, not a one-time run.");
  }
  assertValidTimezone(scheduling.scheduleTimezone);
  if (hasDate && hasTime) {
    assertValidFutureInstant(scheduling);
  }
}

/**
 * The normalized field set every write path resolves before assembling the
 * wire body. Required fields are always present; optional fields are emitted
 * only when provided (see `buildScenarioBody`).
 */
export interface ScenarioBodyInput {
  testId: string;
  testName: string;
  testType: string;
  testTaskConfigs: Array<{ region: string; taskCount: number; concurrency: number }>;
  testScenario: Record<string, unknown>;
  regionalTaskDetails: Record<string, unknown>;
  testDescription?: string | undefined;
  fileType?: string | undefined;
  showLive?: boolean | undefined;
  tags?: string[] | undefined;
  healthyThreshold?: number | undefined;
  nativeRunMode?: NativeRunMode | undefined;
  saveOnly?: boolean | undefined;
  scheduling?: SchedulingInput | undefined;
}

/**
 * The parsed pieces of an existing scenario's `testScenario`, used by the paths
 * that merge or duplicate a stored scenario (`update`, `copy`). All parts are
 * shallow copies, so callers mutate them freely and reassemble with
 * `assembleTestScenario`.
 */
export interface ParsedTestScenario {
  /** The full testScenario object (all original keys preserved). */
  testScenario: Record<string, unknown>;
  /** A mutable copy of the first execution entry. */
  execution: Record<string, unknown>;
  /** A shallow copy of the scenarios map (name -> config). */
  scenarios: Record<string, Record<string, unknown>>;
  /** The current scenario name (first key of the scenarios map), if any. */
  name: string | undefined;
}

/**
 * Parse a stored `testScenario` (JSON string or object) into mutable parts.
 * @param testScenario The scenario's `testScenario`, as returned by the API.
 */
export function parseTestScenario(testScenario: string | Record<string, unknown> | undefined): ParsedTestScenario {
  const parsed: Record<string, unknown> =
    typeof testScenario === "string" ? JSON.parse(testScenario) : (testScenario ?? {});
  const execArr = Array.isArray(parsed["execution"]) ? (parsed["execution"] as unknown[]) : [];
  const execution = { ...((execArr[0] ?? {}) as Record<string, unknown>) };
  const scenarios = { ...((parsed["scenarios"] ?? {}) as Record<string, Record<string, unknown>>) };
  return { testScenario: parsed, execution, scenarios, name: Object.keys(scenarios)[0] };
}

/**
 * Rename the (single) scenario in a parsed testScenario: re-key the scenarios
 * map and update `execution.scenario` so they stay consistent. A no-op when the
 * name is unchanged or absent.
 * @param parsed The parsed testScenario (mutated in place).
 * @param newName The new scenario name.
 */
export function renameScenario(parsed: ParsedTestScenario, newName: string): void {
  const { scenarios, execution, name } = parsed;
  if (name && name !== newName) {
    scenarios[newName] = scenarios[name]!;
    delete scenarios[name];
    execution["scenario"] = newName;
    parsed.name = newName;
  }
}

/**
 * Reassemble a testScenario object from its mutated parts.
 *
 * The (possibly mutated) scenarios map overwrites the original only when it has
 * entries; an empty map is left off entirely so a scenario that never carried a
 * `scenarios` key (e.g. a simple test being updated) does not gain an empty one
 * that would fail the shared schema's "at least one scenario" check.
 */
export function assembleTestScenario(parsed: ParsedTestScenario): Record<string, unknown> {
  const assembled: Record<string, unknown> = { ...parsed.testScenario, execution: [parsed.execution] };
  if (Object.keys(parsed.scenarios).length > 0) {
    assembled["scenarios"] = parsed.scenarios;
  }
  return assembled;
}

/**
 * Build the `regionalTaskDetails` map the API requires from the per-region task
 * configs: each region maps to its task count as `dltAvailableTasks`.
 * @param taskConfigs Per-region task configuration.
 */
export function buildRegionalTaskDetails(
  taskConfigs: ReadonlyArray<{ region: string; taskCount: number }>
): Record<string, { dltAvailableTasks: number }> {
  const details: Record<string, { dltAvailableTasks: number }> = {};
  for (const tc of taskConfigs) {
    details[tc.region] = { dltAvailableTasks: tc.taskCount };
  }
  return details;
}

/**
 * Apply scheduling fields to a body for whichever scheduled mode is configured.
 *
 * A `cron` value produces a recurring schedule (`scheduleStep=create`);
 * otherwise a `scheduleDate` + `scheduleTime` pair produces a one-time run
 * (`scheduleStep=start`, the console's "Run Once"). Either way a truthy
 * `scheduleStep` is how the API routes a scheduled write instead of a plain
 * immediate run. With neither, no scheduling keys are added and the create runs
 * now. Callers should `validateSchedulingInput` first.
 *
 * The body is keyed by the shared schema's field names, so referencing a
 * scheduling field that has been renamed/removed upstream fails compilation.
 */
export function applySchedulingFields(body: PartialScenarioPayload, scheduling: SchedulingInput): void {
  if (scheduling.cron) {
    body.scheduleStep = "create";
    body.cronValue = scheduling.cron;
  } else if (scheduling.scheduleDate && scheduling.scheduleTime) {
    // One-time run ("Run Once"): a specific date/time with no cron. This uses
    // scheduleStep="start" (not "create"), mirroring the web console — the API
    // then builds a single at-that-instant cron(... year) schedule. "create" is
    // reserved for the recurring path's schedule-setup indirection.
    body.scheduleStep = "start";
    body.scheduleDate = scheduling.scheduleDate;
    body.scheduleTime = scheduling.scheduleTime;
  }
  // The timezone applies to whichever scheduled mode was set above.
  if (body.scheduleStep) {
    body.scheduleTimezone = scheduling.scheduleTimezone ?? "UTC";
  }
  // cronExpiryDate bounds a recurring schedule only. Attaching it to a one-time
  // run makes the API set it as the schedule's EndDate, which can fall before
  // the run instant and stop it from ever firing.
  if (scheduling.cron && scheduling.cronExpiryDate) {
    body.cronExpiryDate = scheduling.cronExpiryDate;
  }
}

/**
 * Assemble the `POST /scenarios` request body from a resolved field set.
 *
 * Required fields are always written. Optional fields are included only when
 * defined, so a body never carries an explicit `tags`/`nativeRunMode`/etc. key
 * that the caller did not set (callers rely on absence, e.g. `start` omits both
 * `tags` and `nativeRunMode` for a standard scenario). `showLive` defaults to
 * `false` to match the historical behavior of every path.
 * @param input The normalized field set for this write.
 */
export function buildScenarioBody(input: ScenarioBodyInput): CreateScenarioPayload {
  const body: PartialScenarioPayload = {
    testId: input.testId,
    testName: input.testName,
    testType: input.testType,
    showLive: input.showLive ?? false,
    testTaskConfigs: input.testTaskConfigs,
    testScenario: input.testScenario,
    regionalTaskDetails: input.regionalTaskDetails,
  };

  if (input.testDescription !== undefined) {
    body.testDescription = input.testDescription;
  }
  if (input.fileType !== undefined) {
    body.fileType = input.fileType;
  }
  if (input.tags !== undefined) {
    body.tags = input.tags;
  }
  if (input.healthyThreshold !== undefined) {
    body.healthyThreshold = input.healthyThreshold;
  }
  // Present only for native scenarios. Omitted (not `undefined`) otherwise, so a
  // standard scenario's body has no nativeRunMode key at all.
  if (input.nativeRunMode) {
    body.nativeRunMode = input.nativeRunMode;
  }
  if (input.saveOnly) {
    body.saveOnly = true;
  }
  if (input.scheduling) {
    applySchedulingFields(body, input.scheduling);
  }

  // The field names above are all keys of CreateScenarioPayload, so the shape is
  // contract-checked; the cast only relaxes the per-field value types (the CLI
  // assembles testScenario/testType dynamically from looser local shapes).
  return body as CreateScenarioPayload;
}
