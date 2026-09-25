// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Pure validation logic for the single-page create/edit scenario form.
// Common schemas own field validity; this module maps errors to UI fields,
// controls friendly wording, and validates form-only cross-field rules.

import {
  concurrencySchema,
  healthyThresholdSchema,
  holdForSchema,
  maxTestDurationSecondsSchema,
  rampUpSchema,
  scheduleDateSchema,
  scheduleTimeSchema,
  taskCountSchema,
  testDescriptionSchema,
  testNameSchema,
  urlSchema,
} from "@amzn/dlt-common/validation";
import { missingCronFieldError, validateCronFields } from "../../../utils/cronValidation";
import { checkScheduleInFuture, validateExpiryDate } from "../../../utils/dateValidation";
import { isValidJSON } from "../../../utils/jsonValidator";
import { isScriptTestType } from "../../../utils/scenarioUtils";
import { TestMode, TestTypes, VALIDATION_LIMITS } from "../constants";
import type { DurationUnit, FormData, NativeModeInput } from "../types";
import {
  isNonNegativeInteger,
  isPositiveInteger,
  serializeDuration,
  toSeconds,
} from "./duration";

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
} as const;

/** A single validation error tied to a field and its owning section. */
export interface FieldError {
  field: string;
  sectionId: string;
  message: string;
}

/** Field-keyed error map: field name → error. Empty object means valid. */
export type ValidationErrors = Record<string, FieldError>;

type FieldSchema = {
  safeParse(value: unknown): { success: boolean };
};

const invalidMessage = (schema: FieldSchema, value: unknown, message: string): string | undefined =>
  schema.safeParse(value).success ? undefined : message;

const isScheduleDateTimeInFuture = (formData: FormData): boolean =>
  checkScheduleInFuture(formData.scheduleDate, formData.scheduleTime, formData.scheduleTimezone);

const durationBoundError = (
  value: string,
  unit: DurationUnit,
  label: string,
  allowZero: boolean,
  bound: (seconds: number) => string | undefined
): string | undefined => {
  const validInteger = allowZero ? isNonNegativeInteger(value) : isPositiveInteger(value);
  if (!validInteger) return `${label} must be an integer`;
  return bound(toSeconds(value, unit));
};

// Native mode "Safety duration". Bounds come from the shared schema
// (maxTestDurationSecondsSchema: integer, 1 second to 24 hours).
const maxDurationValidationError = (nativeMode: NativeModeInput): string | undefined => {
  const { value, unit } = nativeMode.maxDuration;
  if (!value) return "Safety duration is required";
  return durationBoundError(value, unit, "Safety duration", false, (seconds) =>
    invalidMessage(maxTestDurationSecondsSchema, seconds, "Safety duration must not exceed 24 hours")
  );
};

export const maxDurationError = (nativeMode: NativeModeInput, reveal: boolean): string | undefined =>
  reveal ? maxDurationValidationError(nativeMode) : undefined;

export const testNameError = (value: string, reveal: boolean): string | undefined => {
  if (!reveal) return undefined;
  if (!value?.trim()) return "Name is required";
  return invalidMessage(
    testNameSchema,
    value,
    "Name must be 3–255 characters with no control characters"
  );
};

export const testDescriptionError = (value: string, reveal: boolean): string | undefined => {
  if (!reveal) return undefined;
  if (!value?.trim()) return "Description is required";
  return invalidMessage(testDescriptionSchema, value, "Description must be between 3 and 60,000 characters");
};

export const httpEndpointError = (value: string, reveal: boolean): string | undefined => {
  if (!reveal) return undefined;
  if (!value?.trim()) return "HTTP endpoint is required";
  return invalidMessage(urlSchema, value, "HTTP endpoint must be a valid HTTP or HTTPS URL");
};

export const taskCountError = (value: string, reveal: boolean): string | undefined => {
  if (!reveal) return undefined;
  if (!value?.trim()) return "Task count is required";
  return invalidMessage(taskCountSchema, value, "Task count must be a positive integer");
};

export const concurrencyError = (value: string, reveal: boolean): string | undefined => {
  if (!reveal) return undefined;
  if (!value?.trim()) return "Concurrency is required";
  return invalidMessage(concurrencySchema, value, "Concurrency must be an integer between 1 and 25,000");
};

const durationRangeMessage = (label: string, minimum: number, unit: DurationUnit): string => {
  switch (unit) {
    case "hours":
      return `${label} must be an integer between ${minimum} and 168 hours`;
    case "minutes":
      return `${label} must be an integer between ${minimum} and 1440 minutes`;
    case "seconds":
      return `${label} must be an integer between ${minimum} and 3600 seconds`;
  }
};

export const rampUpError = (value: string, unit: DurationUnit, reveal: boolean): string | undefined => {
  if (!reveal) return undefined;
  if (!value?.trim()) return "Ramp up is required";
  return invalidMessage(rampUpSchema, serializeDuration(value, unit), durationRangeMessage("Ramp up", 0, unit));
};

export const holdForError = (value: string, unit: DurationUnit, reveal: boolean): string | undefined => {
  if (!reveal) return undefined;
  if (!value?.trim()) return "Hold for is required";
  return invalidMessage(holdForSchema, serializeDuration(value, unit), durationRangeMessage("Hold for", 1, unit));
};

export const healthyThresholdError = (value: string, reveal: boolean): string | undefined =>
  reveal
    ? invalidMessage(
        healthyThresholdSchema,
        Number(value),
        "Healthy threshold must be an integer between 0 and 100"
      )
    : undefined;

export const scheduleTimeError = (value: string, reveal: boolean): string | undefined => {
  if (!reveal) return undefined;
  if (!value?.trim()) return "Run time is required";
  return invalidMessage(scheduleTimeSchema, value, "Run time must be in 24-hour HH:MM format");
};

export const scheduleDateError = (value: string, reveal: boolean): string | undefined => {
  if (!reveal) return undefined;
  if (!value?.trim()) return "Run date is required";
  return invalidMessage(scheduleDateSchema, value, "Run date must be in YYYY-MM-DD format");
};

type AddError = (field: string, sectionId: string, message: string) => void;

function validateTestConfiguration(formData: FormData, add: AddError): void {
  // Validate the trimmed name so the gate agrees with the display and the payload
  // (which also trim) — an untrimmed name can't reach here as a dead-end submit.
  const nameError = testNameError(formData.testName.trim(), true);
  if (nameError) add("testName", SECTION_IDS.TEST_CONFIG, nameError);
  const descriptionError = testDescriptionError(formData.testDescription, true);
  if (descriptionError) add("testDescription", SECTION_IDS.TEST_CONFIG, descriptionError);
}

function validateRunOnceSchedule(formData: FormData, add: AddError): void {
  const timeError = scheduleTimeError(formData.scheduleTime, true);
  if (timeError) add("scheduleTime", SECTION_IDS.SCHEDULE, timeError);
  const dateError = scheduleDateError(formData.scheduleDate, true);
  if (dateError) add("scheduleDate", SECTION_IDS.SCHEDULE, dateError);
  if (!timeError && !dateError && !isScheduleDateTimeInFuture(formData)) {
    add("scheduleDate", SECTION_IDS.SCHEDULE, "Scheduled date and time must be in the future");
  }
}

function validateRecurringSchedule(formData: FormData, add: AddError): void {
  const cronFields = {
    cronMinutes: formData.cronMinutes,
    cronHours: formData.cronHours,
    cronDayOfMonth: formData.cronDayOfMonth,
    cronMonth: formData.cronMonth,
    cronDayOfWeek: formData.cronDayOfWeek,
  };
  const cronMissing = missingCronFieldError(cronFields);
  if (cronMissing) {
    add("cronExpression", SECTION_IDS.SCHEDULE, cronMissing);
  } else {
    const cronError = validateCronFields(cronFields);
    if (cronError) add("cronExpression", SECTION_IDS.SCHEDULE, cronError);
  }
  const expiry = validateExpiryDate(formData.cronExpiryDate, formData.scheduleTimezone);
  if (!expiry.isValid) add("cronExpiryDate", SECTION_IDS.SCHEDULE, expiry.errorMessage);
}

function validateSchedule(formData: FormData, add: AddError): void {
  if (formData.executionTiming === "run-once") validateRunOnceSchedule(formData, add);
  if (formData.executionTiming === "run-schedule") validateRecurringSchedule(formData, add);
}

function validateScenarioConfiguration(formData: FormData, add: AddError): void {
  if (isScriptTestType(formData.testType)) {
    if (!formData.scriptFile?.length) {
      add("scriptFile", SECTION_IDS.FILE_UPLOAD, "Please upload a test script file.");
    }
    if (formData.testType === TestTypes.K6 && !formData.k6LicenseAcknowledged) {
      add("k6LicenseAcknowledged", SECTION_IDS.FILE_UPLOAD, "Please acknowledge the K6 AGPL-3.0 license terms.");
    }
    return;
  }

  const endpointError = httpEndpointError(formData.httpEndpoint, true);
  if (endpointError) add("httpEndpoint", SECTION_IDS.HTTP_ENDPOINT, endpointError);
  if (!isValidJSON(formData.requestHeaders || "")) {
    add("requestHeaders", SECTION_IDS.HTTP_ENDPOINT, "Request headers must be valid JSON");
  }
  if (!isValidJSON(formData.bodyPayload || "")) {
    add("bodyPayload", SECTION_IDS.HTTP_ENDPOINT, "Body payload must be valid JSON");
  }
}

function validateRegion(region: FormData["regions"][number], index: number, isNative: boolean, add: AddError): void {
  const countError = taskCountError(region.taskCount, true);
  if (countError) add(`regions.${index}.taskCount`, SECTION_IDS.MULTI_REGION, countError);
  if (!isNative) {
    const regionConcurrencyError = concurrencyError(region.concurrency, true);
    if (regionConcurrencyError) {
      add(`regions.${index}.concurrency`, SECTION_IDS.MULTI_REGION, regionConcurrencyError);
    }
  }
}

function validateRegions(
  formData: FormData,
  incompatibleRegions: ReadonlySet<string>,
  isNative: boolean,
  add: AddError
): void {
  const regions = formData.regions ?? [];
  if (regions.length === 0) {
    add("regions", SECTION_IDS.MULTI_REGION, "Please select at least one region");
    return;
  }
  if (regions.length > VALIDATION_LIMITS.MAX_REGIONS) {
    add("regions", SECTION_IDS.MULTI_REGION, `Maximum ${VALIDATION_LIMITS.MAX_REGIONS} regions allowed`);
  }
  const selectedIncompatible = regions.filter((region) => incompatibleRegions.has(region.region));
  if (selectedIncompatible.length > 0) {
    add(
      "regions",
      SECTION_IDS.MULTI_REGION,
      `Incompatible regions selected: ${selectedIncompatible.map((region) => region.region).join(", ")}. Please update the regional stack or remove them`
    );
  }
  regions.forEach((region, index) => validateRegion(region, index, isNative, add));
}

function validateNativeSafetyDuration(formData: FormData, add: AddError): void {
  // Safety duration lives in the Upload test file section, so its error anchors there.
  const durationError = maxDurationError(formData.nativeMode, true);
  if (durationError) add("nativeMode.maxDuration.value", SECTION_IDS.FILE_UPLOAD, durationError);
}

function validateStandardTrafficShape(formData: FormData, add: AddError): void {
  const rampError = rampUpError(formData.rampUpValue, formData.rampUpUnit, true);
  if (rampError) add("rampUpValue", SECTION_IDS.TEST_DURATION, rampError);
  const holdError = holdForError(formData.holdForValue, formData.holdForUnit, true);
  if (holdError) add("holdForValue", SECTION_IDS.TEST_DURATION, holdError);
}

/** Validates the entire scenario form and returns a field-keyed error map. */
export const validateScenarioForm = (
  formData: FormData,
  incompatibleRegions: ReadonlySet<string> = new Set()
): ValidationErrors => {
  const errors: ValidationErrors = {};
  const add: AddError = (field, sectionId, message) => {
    if (!errors[field]) errors[field] = { field, sectionId, message };
  };
  const isNative = formData.testMode === TestMode.NATIVE;

  validateTestConfiguration(formData, add);
  validateSchedule(formData, add);
  validateScenarioConfiguration(formData, add);
  validateRegions(formData, incompatibleRegions, isNative, add);
  // Healthy threshold lives in the multi-region section, so its error scrolls there.
  const thresholdError = healthyThresholdError(formData.healthyThreshold, true);
  if (thresholdError) add("healthyThreshold", SECTION_IDS.MULTI_REGION, thresholdError);
  if (isNative) validateNativeSafetyDuration(formData, add);
  else validateStandardTrafficShape(formData, add);

  return errors;
};

/** True when the form has no validation errors. */
export const isScenarioFormValid = (
  formData: FormData,
  incompatibleRegions: ReadonlySet<string> = new Set()
): boolean => Object.keys(validateScenarioForm(formData, incompatibleRegions)).length === 0;

export { isScheduleDateTimeInFuture };
