// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Pure validation logic for the single-page create/edit scenario form.
// Returns a field-keyed error map so the page can render inline errors and,
// on submit, expand + scroll to the first errored section/field.

import { validateCronFields } from "../../../utils/cronValidation";
import { validateExpiryDate, checkScheduleInFuture } from "../../../utils/dateValidation";
import { isValidJSON } from "../../../utils/jsonValidator";
import { isScriptTestType } from "../../../utils/scenarioUtils";
import { isValidUri } from "../../../utils/uriValidator";
import { TestTypes, VALIDATION_LIMITS } from "../constants";
import { FormData } from "../types";

/** Stable id per form section — also used as the `data-section-id` DOM attribute. */
export const SECTION_IDS = {
  TEST_CONFIG: "test-configuration",
  SCHEDULE: "schedule",
  TEST_TYPE: "test-type",
  HTTP_ENDPOINT: "http-endpoint",
  FILE_UPLOAD: "file-upload",
  MULTI_REGION: "multi-region",
  TEST_DURATION: "test-duration",
  TAGS: "tags",
  REGIONAL_AVAILABILITY: "regional-availability",
} as const;

/** A single validation error tied to a field and its owning section. */
export interface FieldError {
  field: string;
  sectionId: string;
  message: string;
}

/** Field-keyed error map: field name → error. Empty object means valid. */
export type ValidationErrors = Record<string, FieldError>;

const isScheduleDateTimeInFuture = (formData: FormData): boolean => {
  return checkScheduleInFuture(formData.scheduleDate, formData.scheduleTime, formData.scheduleTimezone);
};

/**
 * Validates the entire scenario form and returns a field-keyed error map.
 * @param formData current form state
 * @param incompatibleRegions regions whose regional stack version is incompatible
 */
export const validateScenarioForm = (
  formData: FormData,
  incompatibleRegions: ReadonlySet<string> = new Set()
): ValidationErrors => {
  const errors: ValidationErrors = {};
  const add = (field: string, sectionId: string, message: string) => {
    if (!errors[field]) errors[field] = { field, sectionId, message };
  };

  // --- Test Configuration ---
  if (!formData.testName?.trim()) add("testName", SECTION_IDS.TEST_CONFIG, "Test name is required");
  if (!formData.testDescription?.trim())
    add("testDescription", SECTION_IDS.TEST_CONFIG, "Test description is required");

  // --- Schedule ---
  if (formData.executionTiming === "run-once") {
    const missingTime = !formData.scheduleTime?.trim();
    const missingDate = !formData.scheduleDate?.trim();
    if (missingTime) add("scheduleTime", SECTION_IDS.SCHEDULE, "Run time is required");
    if (missingDate) add("scheduleDate", SECTION_IDS.SCHEDULE, "Run date is required");
    if (!missingTime && !missingDate && !isScheduleDateTimeInFuture(formData)) {
      add("scheduleDate", SECTION_IDS.SCHEDULE, "Scheduled date and time must be in the future");
    }
  } else if (formData.executionTiming === "run-schedule") {
    const { cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek } = formData;
    if (!cronMinutes || !cronHours) {
      add("cronExpression", SECTION_IDS.SCHEDULE, "Cron minutes and hours are required");
    } else {
      const cronError = validateCronFields({ cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek });
      if (cronError) add("cronExpression", SECTION_IDS.SCHEDULE, cronError);
    }
    const expiry = validateExpiryDate(formData.cronExpiryDate, formData.scheduleTimezone);
    if (!expiry.isValid) add("cronExpiryDate", SECTION_IDS.SCHEDULE, expiry.errorMessage);
  }

  // --- Scenario Configuration (test-type dependent) ---
  const isScriptTest = isScriptTestType(formData.testType);
  if (isScriptTest) {
    if (!formData.scriptFile?.length) add("scriptFile", SECTION_IDS.FILE_UPLOAD, "Please upload a test script file.");
    if (formData.testType === TestTypes.K6 && !formData.k6LicenseAcknowledged) {
      add("k6LicenseAcknowledged", SECTION_IDS.FILE_UPLOAD, "Please acknowledge the K6 AGPL-3.0 license terms.");
    }
  } else {
    if (!formData.httpEndpoint?.trim()) {
      add("httpEndpoint", SECTION_IDS.HTTP_ENDPOINT, "HTTP endpoint is required");
    } else if (!isValidUri(formData.httpEndpoint).isValid) {
      add("httpEndpoint", SECTION_IDS.HTTP_ENDPOINT, isValidUri(formData.httpEndpoint).errorMessage);
    }
    if (!isValidJSON(formData.requestHeaders || "")) {
      add("requestHeaders", SECTION_IDS.HTTP_ENDPOINT, "Request headers must be valid JSON");
    }
    if (!isValidJSON(formData.bodyPayload || "")) {
      add("bodyPayload", SECTION_IDS.HTTP_ENDPOINT, "Body payload must be valid JSON");
    }
  }

  // --- Multi-Region Traffic ---
  const regions = formData.regions ?? [];
  if (regions.length === 0) {
    add("regions", SECTION_IDS.MULTI_REGION, "Please select at least one region");
  } else {
    if (regions.length > VALIDATION_LIMITS.MAX_REGIONS) {
      add("regions", SECTION_IDS.MULTI_REGION, `Maximum ${VALIDATION_LIMITS.MAX_REGIONS} regions allowed`);
    }
    const selectedIncompatible = regions.filter((r) => incompatibleRegions.has(r.region));
    if (selectedIncompatible.length > 0) {
      add(
        "regions",
        SECTION_IDS.MULTI_REGION,
        `Incompatible regions selected: ${selectedIncompatible.map((r) => r.region).join(", ")}. Please update the regional stack or remove them`
      );
    }
    regions.forEach((region, index) => {
      if (!region.taskCount || Number(region.taskCount) < VALIDATION_LIMITS.TASK_COUNT.MIN) {
        add(`regions.${index}.taskCount`, SECTION_IDS.MULTI_REGION, `Task count must be ≥${VALIDATION_LIMITS.TASK_COUNT.MIN}`);
      }
      if (!region.concurrency || Number(region.concurrency) < VALIDATION_LIMITS.CONCURRENCY.MIN) {
        add(`regions.${index}.concurrency`, SECTION_IDS.MULTI_REGION, `Concurrency must be ≥${VALIDATION_LIMITS.CONCURRENCY.MIN}`);
      }
    });
  }

  // --- Test Duration ---
  if (!formData.rampUpValue) {
    add("rampUpValue", SECTION_IDS.TEST_DURATION, "Ramp up time is required");
  } else if (Number(formData.rampUpValue) < VALIDATION_LIMITS.RAMP_UP.MIN) {
    add("rampUpValue", SECTION_IDS.TEST_DURATION, `Ramp up must be ≥${VALIDATION_LIMITS.RAMP_UP.MIN}`);
  }
  if (!formData.holdForValue) {
    add("holdForValue", SECTION_IDS.TEST_DURATION, "Hold for time is required");
  } else if (Number(formData.holdForValue) < VALIDATION_LIMITS.HOLD_FOR.MIN) {
    add("holdForValue", SECTION_IDS.TEST_DURATION, `Hold for must be ≥${VALIDATION_LIMITS.HOLD_FOR.MIN}`);
  }

  return errors;
};

/** True when the form has no validation errors. */
export const isScenarioFormValid = (
  formData: FormData,
  incompatibleRegions: ReadonlySet<string> = new Set()
): boolean => Object.keys(validateScenarioForm(formData, incompatibleRegions)).length === 0;

export { isScheduleDateTimeInFuture };
