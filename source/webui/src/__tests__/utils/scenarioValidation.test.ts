// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  SECTION_IDS,
  isScenarioFormValid,
  validateScenarioForm,
} from "../../pages/scenarios/utils/scenarioValidation";
import { TestTypes } from "../../pages/scenarios/constants";
import { FormData } from "../../pages/scenarios/types";

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
  rampUpValue: "1",
  rampUpUnit: "minutes",
  holdForValue: "5",
  holdForUnit: "minutes",
  healthyThreshold: "90",
  k6LicenseAcknowledged: false,
};

describe("validateScenarioForm", () => {
  it("returns no errors for a valid run-now simple form", () => {
    expect(validateScenarioForm(validForm)).toEqual({});
    expect(isScenarioFormValid(validForm)).toBe(true);
  });

  describe("test configuration", () => {
    it("flags missing test name", () => {
      const errors = validateScenarioForm({ ...validForm, testName: "  " });
      expect(errors.testName).toMatchObject({ sectionId: SECTION_IDS.TEST_CONFIG });
    });

    it("flags missing description", () => {
      const errors = validateScenarioForm({ ...validForm, testDescription: "" });
      expect(errors.testDescription?.sectionId).toBe(SECTION_IDS.TEST_CONFIG);
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
  });

  describe("test duration", () => {
    it("requires ramp up and hold for", () => {
      const errors = validateScenarioForm({ ...validForm, rampUpValue: "", holdForValue: "" });
      expect(errors.rampUpValue?.sectionId).toBe(SECTION_IDS.TEST_DURATION);
      expect(errors.holdForValue?.sectionId).toBe(SECTION_IDS.TEST_DURATION);
    });
  });
});
