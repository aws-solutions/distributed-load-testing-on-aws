// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { TestMode, TestTypes, VALIDATION_LIMITS } from "../../pages/scenarios/constants";
import { createEmptyNativeModeInput } from "../../pages/scenarios/hooks/useFormData";
import { DurationInput, FormData, NativeModeInput } from "../../pages/scenarios/types";
import { SECTION_IDS, isScenarioFormValid, validateScenarioForm } from "../../pages/scenarios/utils/scenarioValidation";

type NativeModeOverrides = {
  maxDuration?: Partial<DurationInput>;
};

const nativeMode = (overrides: NativeModeOverrides = {}): NativeModeInput => {
  const empty = createEmptyNativeModeInput();
  return {
    maxDuration: { ...empty.maxDuration, ...overrides.maxDuration },
  };
};

const withNativeMode = (formData: FormData, overrides: NativeModeOverrides): FormData => ({
  ...formData,
  nativeMode: nativeMode(overrides),
});

// A fully valid "run-now" simple-HTTP scenario used as the baseline; tests mutate one field at a time.
const validForm: FormData = {
  testName: "My Test",
  testDescription: "A description",
  testId: "abc1234567",
  testType: TestTypes.SIMPLE,
  executionTiming: "run-now",
  showLive: false,
  scriptFile: [],
  fileError: "",
  tags: [],
  httpEndpoint: "https://example.com",
  httpMethod: { label: "GET", value: "GET" },
  requestHeaders: "",
  bodyPayload: "",
  scheduleTime: "",
  scheduleDate: "",
  cronMinutes: "",
  cronHours: "",
  cronDayOfMonth: "",
  cronMonth: "",
  cronDayOfWeek: "",
  cronExpiryDate: "",
  scheduleTimezone: "UTC",
  regions: [{ region: "us-east-1", taskCount: "1", concurrency: "1" }],
  testMode: TestMode.STANDARD,
  rampUpValue: "1",
  rampUpUnit: "minutes",
  holdForValue: "5",
  holdForUnit: "minutes",
  nativeMode: nativeMode(),
  healthyThreshold: "90",
  k6LicenseAcknowledged: false,
};

// A valid native-mode Locust scenario: task count + max duration, no concurrency.
const validNativeForm: FormData = {
  ...validForm,
  testType: TestTypes.LOCUST,
  scriptFile: [new File([], "locustfile.py")],
  httpEndpoint: "",
  testMode: TestMode.NATIVE,
  regions: [{ region: "us-east-1", taskCount: "1", concurrency: "" }],
  rampUpValue: "",
  holdForValue: "",
  nativeMode: nativeMode({ maxDuration: { value: "30", unit: "minutes" } }),
};

const validNativeK6Form: FormData = {
  ...validNativeForm,
  testType: TestTypes.K6,
  scriptFile: [new File([], "test.js")],
  k6LicenseAcknowledged: true,
};

describe("validateScenarioForm", () => {
  it("returns no errors for a valid run-now simple form", () => {
    expect(validateScenarioForm(validForm)).toEqual({});
    expect(isScenarioFormValid(validForm)).toBe(true);
  });

  it("returns multiple errors in page and field order", () => {
    const errors = validateScenarioForm({
      ...validNativeK6Form,
      testName: "",
      testDescription: "",
      executionTiming: "run-once",
      scriptFile: [],
      k6LicenseAcknowledged: false,
      regions: [],
      nativeMode: nativeMode({ maxDuration: { value: "" } }),
    });

    expect(Object.keys(errors)).toEqual([
      "testName",
      "testDescription",
      "scheduleTime",
      "scheduleDate",
      "scriptFile",
      "k6LicenseAcknowledged",
      "regions",
      "nativeMode.maxDuration.value",
    ]);
  });

  describe("test configuration", () => {
    it("flags missing test name", () => {
      const errors = validateScenarioForm({ ...validForm, testName: "  " });
      expect(errors.testName).toMatchObject({ sectionId: SECTION_IDS.TEST_CONFIG });
    });

    it("does not flag a valid name that only needs trimming", () => {
      // The gate trims before validating, matching the display and the payload, so
      // surrounding whitespace never becomes a dead-end submit.
      const errors = validateScenarioForm({ ...validForm, testName: "  Valid Name  " });
      expect(errors.testName).toBeUndefined();
    });

    it("flags missing description", () => {
      const errors = validateScenarioForm({ ...validForm, testDescription: "" });
      expect(errors.testDescription?.sectionId).toBe(SECTION_IDS.TEST_CONFIG);
    });

    it("blocks an out-of-range healthy threshold", () => {
      const errors = validateScenarioForm({ ...validForm, healthyThreshold: "150" });
      expect(errors.healthyThreshold?.sectionId).toBe(SECTION_IDS.MULTI_REGION);
    });

    it("accepts a valid healthy threshold", () => {
      expect(validateScenarioForm({ ...validForm, healthyThreshold: "90" }).healthyThreshold).toBeUndefined();
    });
  });

  describe("schedule", () => {
    it("requires time and date for run-once", () => {
      const errors = validateScenarioForm({ ...validForm, executionTiming: "run-once" });
      expect(errors.scheduleTime?.sectionId).toBe(SECTION_IDS.SCHEDULE);
      expect(errors.scheduleDate?.sectionId).toBe(SECTION_IDS.SCHEDULE);
    });

    it("rejects a past run-once date/time", () => {
      const errors = validateScenarioForm({
        ...validForm,
        executionTiming: "run-once",
        scheduleDate: "2000-01-01",
        scheduleTime: "00:00",
      });
      expect(errors.scheduleDate?.message).toMatch(/future/i);
    });

    it("rejects a malformed run-once time", () => {
      const errors = validateScenarioForm({
        ...validForm,
        executionTiming: "run-once",
        scheduleDate: "2099-01-01",
        scheduleTime: "25:00",
      });
      expect(errors.scheduleTime?.message).toMatch(/HH:MM/);
    });

    it("requires cron minutes/hours for run-schedule", () => {
      const errors = validateScenarioForm({ ...validForm, executionTiming: "run-schedule" });
      expect(errors.cronExpression?.sectionId).toBe(SECTION_IDS.SCHEDULE);
    });

    it("requires an expiry date for run-schedule", () => {
      const errors = validateScenarioForm({
        ...validForm,
        executionTiming: "run-schedule",
        cronMinutes: "0",
        cronHours: "9",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
        cronExpiryDate: "",
      });
      expect(errors.cronExpiryDate?.sectionId).toBe(SECTION_IDS.SCHEDULE);
    });

    it("flags a never-focused cron field as required on submit", () => {
      const errors = validateScenarioForm({
        ...validForm,
        executionTiming: "run-schedule",
        cronMinutes: "0",
        cronHours: "9",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "",
        cronExpiryDate: "2099-01-01",
      });
      expect(errors.cronExpression?.message).toBe("Day of week is required");
    });

    it("accepts a fully filled valid cron", () => {
      const errors = validateScenarioForm({
        ...validForm,
        executionTiming: "run-schedule",
        cronMinutes: "0",
        cronHours: "9",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
        cronExpiryDate: "2099-01-01",
      });
      expect(errors.cronExpression).toBeUndefined();
    });
  });

  describe("scenario configuration", () => {
    it("requires a script file for script test types", () => {
      const errors = validateScenarioForm({ ...validForm, testType: TestTypes.JMETER, scriptFile: [] });
      expect(errors.scriptFile?.sectionId).toBe(SECTION_IDS.FILE_UPLOAD);
    });

    it("requires K6 license acknowledgment", () => {
      const errors = validateScenarioForm({
        ...validForm,
        testType: TestTypes.K6,
        scriptFile: [new File([], "test.js")],
        k6LicenseAcknowledged: false,
      });
      expect(errors.k6LicenseAcknowledged?.sectionId).toBe(SECTION_IDS.FILE_UPLOAD);
    });

    it("requires an HTTP endpoint for simple tests", () => {
      const errors = validateScenarioForm({ ...validForm, httpEndpoint: "" });
      expect(errors.httpEndpoint?.sectionId).toBe(SECTION_IDS.HTTP_ENDPOINT);
    });

    it("rejects an invalid URI", () => {
      const errors = validateScenarioForm({ ...validForm, httpEndpoint: "not a url" });
      expect(errors.httpEndpoint?.sectionId).toBe(SECTION_IDS.HTTP_ENDPOINT);
    });

    it("rejects invalid JSON headers and body", () => {
      const errors = validateScenarioForm({ ...validForm, requestHeaders: "{bad", bodyPayload: "{bad" });
      expect(errors.requestHeaders?.sectionId).toBe(SECTION_IDS.HTTP_ENDPOINT);
      expect(errors.bodyPayload?.sectionId).toBe(SECTION_IDS.HTTP_ENDPOINT);
    });

    it("does not validate HTTP fields for script tests", () => {
      const errors = validateScenarioForm({
        ...validForm,
        testType: TestTypes.JMETER,
        scriptFile: [new File([], "test.jmx")],
        httpEndpoint: "",
        requestHeaders: "{bad",
      });
      expect(errors.httpEndpoint).toBeUndefined();
      expect(errors.requestHeaders).toBeUndefined();
    });
  });

  describe("multi-region traffic", () => {
    it("requires at least one region", () => {
      const errors = validateScenarioForm({ ...validForm, regions: [] });
      expect(errors.regions?.sectionId).toBe(SECTION_IDS.MULTI_REGION);
    });

    it("flags incompatible regions", () => {
      const errors = validateScenarioForm(validForm, new Set(["us-east-1"]));
      expect(errors.regions?.message).toMatch(/incompatible/i);
    });

    it("flags missing task count / concurrency per region", () => {
      const errors = validateScenarioForm({
        ...validForm,
        regions: [{ region: "us-east-1", taskCount: "", concurrency: "" }],
      });
      expect(errors["regions.0.taskCount"]?.sectionId).toBe(SECTION_IDS.MULTI_REGION);
      expect(errors["regions.0.concurrency"]?.sectionId).toBe(SECTION_IDS.MULTI_REGION);
    });

    it("flags exceeding the max region count", () => {
      const regions = Array.from({ length: 6 }, (_, i) => ({ region: `r${i}`, taskCount: "1", concurrency: "1" }));
      const errors = validateScenarioForm({ ...validForm, regions });
      expect(errors.regions?.message).toMatch(/maximum/i);
    });

    it("rejects zero and non-numeric task counts with an integer message", () => {
      for (const taskCount of ["0", "asd"]) {
        const errors = validateScenarioForm({
          ...validForm,
          regions: [{ region: "us-east-1", taskCount, concurrency: "1" }],
        });
        expect(errors["regions.0.taskCount"]?.message).toMatch(/integer/i);
      }
    });
  });

  describe("test duration", () => {
    it("requires ramp up and hold for", () => {
      const errors = validateScenarioForm({ ...validForm, rampUpValue: "", holdForValue: "" });
      expect(errors.rampUpValue?.sectionId).toBe(SECTION_IDS.TEST_DURATION);
      expect(errors.holdForValue?.sectionId).toBe(SECTION_IDS.TEST_DURATION);
    });

    it("rejects a non-numeric ramp up with an integer message", () => {
      const errors = validateScenarioForm({ ...validForm, rampUpValue: "asd" });
      expect(errors.rampUpValue?.message).toMatch(/integer/i);
    });

    it("accepts a zero ramp up", () => {
      expect(validateScenarioForm({ ...validForm, rampUpValue: "0" }).rampUpValue).toBeUndefined();
    });
  });

  describe("native mode", () => {
    const maxDurationKey = "nativeMode.maxDuration.value";

    it("returns no errors for a valid native form", () => {
      expect(validateScenarioForm(validNativeForm)).toEqual({});
      expect(isScenarioFormValid(validNativeForm)).toBe(true);
    });

    it("does not require concurrency", () => {
      const errors = validateScenarioForm({
        ...validNativeForm,
        regions: [{ region: "us-east-1", taskCount: "2", concurrency: "" }],
      });
      expect(errors["regions.0.concurrency"]).toBeUndefined();
    });

    it("still requires task count", () => {
      const errors = validateScenarioForm({
        ...validNativeForm,
        regions: [{ region: "us-east-1", taskCount: "", concurrency: "" }],
      });
      expect(errors["regions.0.taskCount"]?.sectionId).toBe(SECTION_IDS.MULTI_REGION);
    });

    it("does not validate ramp up or hold for", () => {
      const errors = validateScenarioForm({ ...validNativeForm, rampUpValue: "", holdForValue: "" });
      expect(errors.rampUpValue).toBeUndefined();
      expect(errors.holdForValue).toBeUndefined();
    });

    it("requires a safety duration, anchored to the Upload test file section", () => {
      const errors = validateScenarioForm(withNativeMode(validNativeForm, { maxDuration: { value: "" } }));
      expect(errors[maxDurationKey]?.sectionId).toBe(SECTION_IDS.FILE_UPLOAD);
    });

    it("accepts the shared-schema lower bound of 1 second", () => {
      const errors = validateScenarioForm(
        withNativeMode(validNativeForm, { maxDuration: { value: "1", unit: "seconds" } })
      );
      expect(errors[maxDurationKey]).toBeUndefined();
    });

    it("rejects a non-positive duration", () => {
      const errors = validateScenarioForm(
        withNativeMode(validNativeForm, { maxDuration: { value: "0", unit: "seconds" } })
      );
      expect(errors[maxDurationKey]?.sectionId).toBe(SECTION_IDS.FILE_UPLOAD);
    });

    it("accepts the upper bound of 24 hours", () => {
      const errors = validateScenarioForm(
        withNativeMode(validNativeForm, { maxDuration: { value: "24", unit: "hours" } })
      );
      expect(errors[maxDurationKey]).toBeUndefined();
    });

    it("rejects a duration past 24 hours", () => {
      const errors = validateScenarioForm(
        withNativeMode(validNativeForm, {
          maxDuration: { value: String(VALIDATION_LIMITS.DURATION.MAX_SECONDS + 1), unit: "seconds" },
        })
      );
      expect(errors[maxDurationKey]?.sectionId).toBe(SECTION_IDS.FILE_UPLOAD);
    });

    it("rejects a duration in minutes that exceeds the cap in seconds", () => {
      // 1500 minutes = 90,000s.
      const errors = validateScenarioForm(
        withNativeMode(validNativeForm, { maxDuration: { value: "1500", unit: "minutes" } })
      );
      expect(errors[maxDurationKey]?.sectionId).toBe(SECTION_IDS.FILE_UPLOAD);
    });

    it("rejects a non-integer duration", () => {
      const errors = validateScenarioForm(
        withNativeMode(validNativeForm, { maxDuration: { value: "3.5", unit: "minutes" } })
      );
      expect(errors[maxDurationKey]?.sectionId).toBe(SECTION_IDS.FILE_UPLOAD);
    });
  });
});
