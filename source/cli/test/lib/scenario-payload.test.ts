// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import {
  buildScenarioBody,
  buildRegionalTaskDetails,
  parseTestScenario,
  renameScenario,
  assembleTestScenario,
  validateSchedulingInput,
  type ScenarioBodyInput,
} from "../../src/lib/scenario-payload.js";

const base: ScenarioBodyInput = {
  testId: "abc123",
  testName: "My Test",
  testType: "simple",
  testTaskConfigs: [{ region: "us-east-1", taskCount: 2, concurrency: 10 }],
  testScenario: { execution: [{ concurrency: 10 }] },
  regionalTaskDetails: { "us-east-1": { dltAvailableTasks: 2 } },
};

describe("buildScenarioBody", () => {
  it("always writes the required fields", () => {
    const body = buildScenarioBody(base);
    expect(body).toMatchObject({
      testId: "abc123",
      testName: "My Test",
      testType: "simple",
      testTaskConfigs: [{ region: "us-east-1", taskCount: 2, concurrency: 10 }],
      testScenario: { execution: [{ concurrency: 10 }] },
      regionalTaskDetails: { "us-east-1": { dltAvailableTasks: 2 } },
    });
  });

  it("defaults showLive to false when unset", () => {
    expect(buildScenarioBody(base)["showLive"]).toBe(false);
    expect(buildScenarioBody({ ...base, showLive: true })["showLive"]).toBe(true);
  });

  it("omits optional fields that were not provided", () => {
    const body = buildScenarioBody(base);
    expect(body).not.toHaveProperty("tags");
    expect(body).not.toHaveProperty("nativeRunMode");
    expect(body).not.toHaveProperty("healthyThreshold");
    expect(body).not.toHaveProperty("saveOnly");
    expect(body).not.toHaveProperty("testDescription");
    expect(body).not.toHaveProperty("fileType");
  });

  it("includes optional fields when provided", () => {
    const body = buildScenarioBody({
      ...base,
      testDescription: "desc",
      fileType: "script",
      tags: ["a"],
      healthyThreshold: 90,
      saveOnly: true,
    });
    expect(body).toMatchObject({
      testDescription: "desc",
      fileType: "script",
      tags: ["a"],
      healthyThreshold: 90,
      saveOnly: true,
    });
  });

  it("includes an empty tags array (distinct from omitting tags)", () => {
    const body = buildScenarioBody({ ...base, tags: [] });
    expect(body["tags"]).toEqual([]);
  });

  it("does not set saveOnly when false", () => {
    expect(buildScenarioBody({ ...base, saveOnly: false })).not.toHaveProperty("saveOnly");
  });

  it("attaches nativeRunMode only when present", () => {
    const nativeRunMode = { maxTestDurationSeconds: 600 };
    expect(buildScenarioBody({ ...base, testType: "locust", nativeRunMode })["nativeRunMode"]).toEqual(nativeRunMode);
  });

  it("applies cron scheduling fields", () => {
    const body = buildScenarioBody({
      ...base,
      scheduling: { cron: "0 8 * * *", scheduleTimezone: "US/Pacific" },
    });
    expect(body).toMatchObject({
      scheduleStep: "create",
      cronValue: "0 8 * * *",
      scheduleTimezone: "US/Pacific",
    });
    // Cadence lives in the cron expression; no separate recurrence field is sent.
    expect(body).not.toHaveProperty("recurrence");
  });

  it("adds no scheduling fields when cron is absent", () => {
    const body = buildScenarioBody({ ...base, scheduling: { scheduleTimezone: "UTC" } });
    expect(body).not.toHaveProperty("cronValue");
    expect(body).not.toHaveProperty("scheduleStep");
  });

  it("applies one-time (Run Once) scheduling fields with default UTC timezone", () => {
    const body = buildScenarioBody({
      ...base,
      scheduling: { scheduleDate: "2027-01-31", scheduleTime: "14:30" },
    });
    expect(body).toMatchObject({
      // One-time uses scheduleStep="start" (mirrors the console), not "create".
      scheduleStep: "start",
      scheduleDate: "2027-01-31",
      scheduleTime: "14:30",
      scheduleTimezone: "UTC",
    });
    // One-time is cron-free.
    expect(body).not.toHaveProperty("cronValue");
  });

  it("does not attach cronExpiryDate to a one-time run body", () => {
    const body = buildScenarioBody({
      ...base,
      scheduling: { scheduleDate: "2027-01-31", scheduleTime: "14:30", cronExpiryDate: "2030-01-01" },
    });
    expect(body).toMatchObject({ scheduleStep: "start", scheduleDate: "2027-01-31" });
    // cronExpiryDate is recurring-only; it must not ride along on a one-time run.
    expect(body).not.toHaveProperty("cronExpiryDate");
  });

  it("attaches cronExpiryDate on a recurring (cron) body", () => {
    const body = buildScenarioBody({
      ...base,
      scheduling: { cron: "0 8 * * *", cronExpiryDate: "2030-01-01" },
    });
    expect(body).toMatchObject({ scheduleStep: "create", cronValue: "0 8 * * *", cronExpiryDate: "2030-01-01" });
  });

  it("honors an explicit timezone for a one-time run", () => {
    const body = buildScenarioBody({
      ...base,
      scheduling: { scheduleDate: "2027-01-31", scheduleTime: "14:30", scheduleTimezone: "US/Pacific" },
    });
    expect(body["scheduleTimezone"]).toBe("US/Pacific");
  });

  it("prefers cron over one-time fields when both are somehow present", () => {
    // (validateSchedulingInput rejects this combination; applySchedulingFields
    // still deterministically prefers the recurring path.)
    const body = buildScenarioBody({
      ...base,
      scheduling: { cron: "0 8 * * *", scheduleDate: "2027-01-31", scheduleTime: "14:30" },
    });
    expect(body).toMatchObject({ scheduleStep: "create", cronValue: "0 8 * * *" });
    expect(body).not.toHaveProperty("scheduleDate");
    expect(body).not.toHaveProperty("scheduleTime");
  });
});

describe("validateSchedulingInput", () => {
  it("accepts run-now (no scheduling fields)", () => {
    expect(() => validateSchedulingInput({})).not.toThrow();
    expect(() => validateSchedulingInput({ scheduleTimezone: "UTC" })).not.toThrow();
  });

  it("accepts a valid recurring cron", () => {
    expect(() => validateSchedulingInput({ cron: "0 8 * * *" })).not.toThrow();
  });

  it("accepts a valid one-time date + time", () => {
    // Compute a date relative to now so the positive-path assertion is not a
    // time bomb (validateSchedulingInput rejects any non-future date/time).
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const scheduleDate = future.toISOString().slice(0, 10); // YYYY-MM-DD

    expect(() => validateSchedulingInput({ scheduleDate, scheduleTime: "14:30" })).not.toThrow();
    // HH:MM:SS is also accepted by the shared time schema.
    expect(() => validateSchedulingInput({ scheduleDate, scheduleTime: "14:30:00" })).not.toThrow();
  });

  it("rejects mixing cron with a one-time date/time", () => {
    expect(() => validateSchedulingInput({ cron: "0 8 * * *", scheduleDate: "2027-01-31" })).toThrow(
      /either --cron .* or --schedule-date/
    );
    expect(() => validateSchedulingInput({ cron: "0 8 * * *", scheduleTime: "14:30" })).toThrow(
      /either --cron .* or --schedule-date/
    );
  });

  it("rejects a date without a time (and vice versa)", () => {
    expect(() => validateSchedulingInput({ scheduleDate: "2027-01-31" })).toThrow(/must be provided together/);
    expect(() => validateSchedulingInput({ scheduleTime: "14:30" })).toThrow(/must be provided together/);
  });

  it("rejects a malformed date or time", () => {
    expect(() => validateSchedulingInput({ scheduleDate: "01-31-2027", scheduleTime: "14:30" })).toThrow(/YYYY-MM-DD/);
    expect(() => validateSchedulingInput({ scheduleDate: "2027-01-31", scheduleTime: "2:5pm" })).toThrow(/HH:MM/);
  });

  it("rejects a one-time run in the past", () => {
    expect(() => validateSchedulingInput({ scheduleDate: "2020-01-01", scheduleTime: "09:00" })).toThrow(/future/);
  });

  it("rejects --cron-expiry-date combined with a one-time run", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const scheduleDate = future.toISOString().slice(0, 10);
    expect(() => validateSchedulingInput({ scheduleDate, scheduleTime: "14:30", cronExpiryDate: "2030-01-01" })).toThrow(
      /applies only to a recurring --cron schedule/
    );
  });

  it("rejects an invalid --schedule-timezone with a timezone-specific message", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const scheduleDate = future.toISOString().slice(0, 10);
    // A bad zone must not surface as a misleading "not a valid date/time".
    expect(() => validateSchedulingInput({ scheduleDate, scheduleTime: "14:30", scheduleTimezone: "Not/AZone" })).toThrow(
      /not a valid IANA timezone/
    );
    expect(() => validateSchedulingInput({ cron: "0 8 * * *", scheduleTimezone: "Bogus/Zone" })).toThrow(
      /not a valid IANA timezone/
    );
    // A real zone is accepted.
    expect(() =>
      validateSchedulingInput({ scheduleDate, scheduleTime: "14:30", scheduleTimezone: "US/Pacific" })
    ).not.toThrow();
  });

  it("rejects a calendar-invalid date distinctly from the future check", () => {
    // Passes the format regex (day 01-31) but is not a real date; luxon flags it.
    expect(() => validateSchedulingInput({ scheduleDate: "2027-02-30", scheduleTime: "09:00" })).toThrow(
      /not a valid date\/time/
    );
    expect(() => validateSchedulingInput({ scheduleDate: "2027-04-31", scheduleTime: "09:00" })).toThrow(
      /not a valid date\/time/
    );
  });
});

describe("buildRegionalTaskDetails", () => {
  it("maps each region's task count to dltAvailableTasks", () => {
    const details = buildRegionalTaskDetails([
      { region: "us-east-1", taskCount: 2 },
      { region: "eu-west-1", taskCount: 5 },
    ]);
    expect(details).toEqual({
      "us-east-1": { dltAvailableTasks: 2 },
      "eu-west-1": { dltAvailableTasks: 5 },
    });
  });

  it("returns an empty map for no task configs", () => {
    expect(buildRegionalTaskDetails([])).toEqual({});
  });
});

describe("parseTestScenario", () => {
  it("parses a JSON string into mutable, copied parts", () => {
    const source = JSON.stringify({
      execution: [{ concurrency: 5, scenario: "Load" }],
      scenarios: { Load: { script: "abc.jmx" } },
      reporting: [{ module: "final-stats" }],
    });
    const parsed = parseTestScenario(source);

    expect(parsed.name).toBe("Load");
    expect(parsed.execution).toEqual({ concurrency: 5, scenario: "Load" });
    expect(parsed.scenarios).toEqual({ Load: { script: "abc.jmx" } });
    // Original keys are preserved on the whole object for reassembly.
    expect(parsed.testScenario["reporting"]).toEqual([{ module: "final-stats" }]);

    // Mutating the copies must not affect the source object.
    parsed.execution["concurrency"] = 99;
    parsed.scenarios["Load"]!["script"] = "changed";
    expect(JSON.parse(source).execution[0].concurrency).toBe(5);
  });

  it("accepts an object and defaults missing execution/scenarios", () => {
    const parsed = parseTestScenario({ ramp: "1m" });
    expect(parsed.execution).toEqual({});
    expect(parsed.scenarios).toEqual({});
    expect(parsed.name).toBeUndefined();
  });

  it("defaults an empty parse for undefined", () => {
    const parsed = parseTestScenario(undefined);
    expect(parsed.execution).toEqual({});
    expect(parsed.scenarios).toEqual({});
    expect(parsed.name).toBeUndefined();
  });
});

describe("renameScenario", () => {
  it("re-keys the scenarios map and updates execution.scenario", () => {
    const parsed = parseTestScenario({
      execution: [{ scenario: "Old" }],
      scenarios: { Old: { script: "x.jmx" } },
    });
    renameScenario(parsed, "New");

    expect(parsed.name).toBe("New");
    expect(Object.keys(parsed.scenarios)).toEqual(["New"]);
    expect(parsed.scenarios["New"]).toEqual({ script: "x.jmx" });
    expect(parsed.execution["scenario"]).toBe("New");
  });

  it("is a no-op when the name is unchanged", () => {
    const parsed = parseTestScenario({
      execution: [{ scenario: "Same" }],
      scenarios: { Same: { script: "x.jmx" } },
    });
    renameScenario(parsed, "Same");
    expect(Object.keys(parsed.scenarios)).toEqual(["Same"]);
    expect(parsed.execution["scenario"]).toBe("Same");
  });

  it("is a no-op when there is no existing scenario", () => {
    const parsed = parseTestScenario({ execution: [{ concurrency: 1 }] });
    renameScenario(parsed, "New");
    expect(parsed.scenarios).toEqual({});
    expect(parsed.execution).not.toHaveProperty("scenario");
  });
});

describe("assembleTestScenario", () => {
  it("reassembles execution as an array and preserves other keys", () => {
    const parsed = parseTestScenario({
      execution: [{ concurrency: 5 }],
      scenarios: { Load: { script: "x.jmx" } },
      reporting: [{ module: "final-stats" }],
    });
    parsed.execution["concurrency"] = 20;

    const assembled = assembleTestScenario(parsed);
    expect(assembled["execution"]).toEqual([{ concurrency: 20 }]);
    expect(assembled["scenarios"]).toEqual({ Load: { script: "x.jmx" } });
    expect(assembled["reporting"]).toEqual([{ module: "final-stats" }]);
  });

  it("omits an empty scenarios map so the schema's min-one check is not tripped", () => {
    const parsed = parseTestScenario({ execution: [{ concurrency: 5 }] });
    const assembled = assembleTestScenario(parsed);
    expect(assembled).not.toHaveProperty("scenarios");
    expect(assembled["execution"]).toEqual([{ concurrency: 5 }]);
  });
});
