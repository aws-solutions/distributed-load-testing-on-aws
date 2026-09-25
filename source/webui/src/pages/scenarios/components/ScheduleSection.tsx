// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Component for test execution timing and schedule configuration

import {
  Box,
  DatePicker,
  FormField,
  Grid,
  Input,
  Link,
  SegmentedControl,
  Select,
  SpaceBetween,
} from "@cloudscape-design/components";
import { useMemo } from "react";
import { DateTime } from "luxon";
import { getTimeZones } from "@vvo/tzdb";
import { FormData } from "../types";
import { CronExpressionParser, CronExpressionOptions } from "cron-parser";
import { validateExpiryDate, parseExpiryDate, checkScheduleInFuture } from "../../../utils/dateValidation";
import {
  allCronFieldsFilled,
  CRON_FIELD_ORDER,
  CRON_REQUIRED_MESSAGE,
  CronFields,
  formatCronValidationExpression,
  validateCronFields,
} from "../../../utils/cronValidation";
import { FormSection } from "./FormSection";
import { useFieldReveal } from "../hooks/useFieldReveal";
import { SECTION_IDS, scheduleDateError, scheduleTimeError } from "../utils/scenarioValidation";

/**
 * Build timezone dropdown options from @vvo/tzdb getTimeZones.
 * Uses currentTimeFormat which reflects the current DST offset.
 */
const timeZonesWithUtc = getTimeZones({ includeUtc: true });

const timezoneOptions = timeZonesWithUtc.map((tz) => {
  const totalMinutes = tz.currentTimeOffsetInMinutes;
  const sign = totalMinutes >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(totalMinutes) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(totalMinutes) % 60).padStart(2, "0");
  return {
    label: `(UTC${sign}${hours}:${minutes}) ${tz.name}`,
    value: tz.name,
  };
});

// Cron fields rendered as a labeled 5-column grid.
type CronFieldKey = "cronMinutes" | "cronHours" | "cronDayOfMonth" | "cronMonth" | "cronDayOfWeek";
const CRON_FIELDS: { key: CronFieldKey; label: string; placeholder: string }[] = [
  { key: "cronMinutes", label: "Minutes", placeholder: "minutes" },
  { key: "cronHours", label: "Hours", placeholder: "hours" },
  { key: "cronDayOfMonth", label: "Day of month", placeholder: "day of month" },
  { key: "cronMonth", label: "Month", placeholder: "month" },
  { key: "cronDayOfWeek", label: "Day of week (0-6)", placeholder: "day of week" },
];

// Execution timing options. SegmentedControl has no per-option description, so
// the description for the selected option is rendered below the control.
type ExecutionTiming = FormData["executionTiming"];
const EXECUTION_TIMING_OPTIONS: { id: ExecutionTiming; text: string; description: string }[] = [
  { id: "run-now", text: "Run Now", description: "Execute the load test immediately after creation" },
  { id: "run-once", text: "Run Once", description: "Execute the test on a date and time" },
  { id: "run-schedule", text: "Run on a Schedule", description: "Enter a cron expression to define the schedule" },
];

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
}

export const ScheduleSection = ({ formData, updateFormData, showValidationErrors = false }: Props) => {
  const { markTouched, isRevealed, resetTouched } = useFieldReveal(showValidationErrors);
  // Cron missing errors also reveal once an expiry date is set (setting expiry
  // engages the schedule, so we surface missing cron fields then, not only at submit).
  const cronRevealed = (key: (typeof CRON_FIELD_ORDER)[number]) => isRevealed(key) || !!formData.cronExpiryDate?.trim();
  const cronFieldMissing = (key: (typeof CRON_FIELD_ORDER)[number], value: string) =>
    !value?.trim() && cronRevealed(key);

  const applyCronPattern = (minutes: string, hours: string, dayOfMonth: string, month: string, dayOfWeek: string) => {
    updateFormData({
      cronMinutes: minutes,
      cronHours: hours,
      cronDayOfMonth: dayOfMonth,
      cronMonth: month,
      cronDayOfWeek: dayOfWeek,
    });
  };

  const expiryDateError = useMemo(() => {
    if (formData.executionTiming !== "run-schedule" || !formData.cronExpiryDate) return "";
    return validateExpiryDate(formData.cronExpiryDate, formData.scheduleTimezone).errorMessage;
  }, [formData.cronExpiryDate, formData.executionTiming, formData.scheduleTimezone]);

  // Two-mode cron validation, both keyed off CRON_FIELD_ORDER over the form's own
  // cron fields: a revealed empty field reports "<Field> is required", and the
  // full format check only runs once all five fields are filled.
  const isSchedule = formData.executionTiming === "run-schedule";
  const firstMissingCron = CRON_FIELD_ORDER.find((key) => !formData[key]?.trim() && cronRevealed(key));
  const cronFormatError = isSchedule && allCronFieldsFilled(formData) ? validateCronFields(formData) : "";
  const cronError = ((): string | undefined => {
    if (!isSchedule) return undefined;
    if (firstMissingCron) return CRON_REQUIRED_MESSAGE[firstMissingCron];
    return cronFormatError || undefined;
  })();

  const expiryError = ((): string | undefined => {
    if (!isSchedule) return undefined;
    if (formData.cronExpiryDate) return expiryDateError || undefined;
    return isRevealed("cronExpiryDate") ? "Expiry date is required" : undefined;
  })();

  const scheduleDateTimeError = useMemo(() => {
    if (formData.executionTiming !== "run-once") return "";
    if (checkScheduleInFuture(formData.scheduleDate, formData.scheduleTime, formData.scheduleTimezone)) {
      return "";
    }
    return "Scheduled date and time must be in the future";
  }, [formData.executionTiming, formData.scheduleDate, formData.scheduleTime, formData.scheduleTimezone]);

  // Run time is free-text so its format is validated against the shared schema;
  // format takes precedence over the (combined) future check. Run date uses a
  // picker, so its format is effectively guaranteed but validated for parity.
  const runTimeError = ((): string | undefined => {
    if (formData.executionTiming !== "run-once") return undefined;
    const timeFieldError = scheduleTimeError(formData.scheduleTime, isRevealed("scheduleTime"));
    if (timeFieldError) return timeFieldError;
    if (formData.scheduleTime?.trim() && formData.scheduleDate?.trim()) return scheduleDateTimeError || undefined;
    return undefined;
  })();

  const runDateError =
    formData.executionTiming === "run-once"
      ? scheduleDateError(formData.scheduleDate, isRevealed("scheduleDate"))
      : undefined;

  const isDateEnabled = useMemo(() => {
    const tz = formData.scheduleTimezone || "UTC";
    const today = DateTime.now().setZone(tz);
    const todayY = today.year,
      todayM = today.month,
      todayD = today.day;
    return (date: Date) => {
      const y = date.getFullYear(),
        m = date.getMonth() + 1,
        d = date.getDate();
      return y * 10000 + m * 100 + d >= todayY * 10000 + todayM * 100 + todayD;
    };
  }, [formData.scheduleTimezone]);

  const nextRun = useMemo(() => {
    const cronFields: CronFields = {
      cronMinutes: formData.cronMinutes,
      cronHours: formData.cronHours,
      cronDayOfMonth: formData.cronDayOfMonth,
      cronMonth: formData.cronMonth,
      cronDayOfWeek: formData.cronDayOfWeek,
    };
    const { cronExpiryDate, scheduleTimezone } = formData;
    // Only build a preview once an expiry date and all five cron fields are set.
    if (!cronExpiryDate || !allCronFieldsFilled(cronFields)) return { dates: [], error: "" };

    try {
      // Build Linux cron expression (5 fields)
      const cronExpression = formatCronValidationExpression(cronFields);

      // Use the selected schedule timezone for cron parsing
      const parserOptions: CronExpressionOptions = { tz: scheduleTimezone || "UTC" };

      // Configure expiration for the cron parser
      if (cronExpiryDate) {
        const expiryDate = parseExpiryDate(cronExpiryDate, scheduleTimezone);
        if (expiryDate) {
          parserOptions.endDate = expiryDate;
        }
      }

      // Parse using cron-parser
      const interval = CronExpressionParser.parse(cronExpression, parserOptions);

      // Take maximum of 5 scheduled times or until expire, whichever is fewer.
      const dates: string[] = interval.take(5).map((nextDate) => {
        const nextDateObj = nextDate.toDate();

        // Convert to the user's local browser timezone for display
        const localDateTime = DateTime.fromJSDate(nextDateObj).setZone("local");
        const formatted = localDateTime.toFormat("MMM d, yyyy, h:mm a");
        return formatted;
      });

      return { dates, error: dates.length === 0 ? "No matching dates found" : "" };
    } catch (error) {
      console.error("Error parsing cron expression:", error);
      return { dates: [], error: "Invalid cron expression format for scheduling." };
    }
  }, [
    formData.cronMinutes,
    formData.cronHours,
    formData.cronDayOfMonth,
    formData.cronMonth,
    formData.cronDayOfWeek,
    formData.cronExpiryDate,
    formData.scheduleTimezone,
  ]);

  // Memoized so the ~450-entry timezone list is only scanned when the selected
  // zone changes, not on every render/keystroke (the picker may be hidden).
  const selectedTimezone = useMemo(
    () => timezoneOptions.find((opt) => opt.value === formData.scheduleTimezone) || null,
    [formData.scheduleTimezone]
  );

  const timezoneSelect = (
    <Select
      selectedOption={selectedTimezone}
      onChange={({ detail }) => updateFormData({ scheduleTimezone: detail.selectedOption.value ?? "UTC" })}
      options={timezoneOptions}
      filteringType="auto"
      placeholder="Select a timezone"
    />
  );

  return (
    <FormSection sectionId={SECTION_IDS.SCHEDULE} headerText="Schedule">
      <SpaceBetween direction="vertical" size="s">
        <Box variant="small">Configure when the load test should run</Box>

        <FormField label="Execution timing">
          <SpaceBetween direction="vertical" size="xs">
            <SegmentedControl
              data-cy="execution-timing-segmented"
              selectedId={formData.executionTiming}
              onChange={({ detail }) => {
                const value: ExecutionTiming = detail.selectedId;
                const updates: Partial<FormData> = { executionTiming: value };
                resetTouched();
                if (value === "run-now") {
                  updates.scheduleDate = "";
                  updates.scheduleTime = "";
                  updates.cronMinutes = "";
                  updates.cronHours = "";
                  updates.cronDayOfMonth = "";
                  updates.cronMonth = "";
                  updates.cronDayOfWeek = "";
                  updates.cronExpiryDate = "";
                } else if (value === "run-once") {
                  updates.cronMinutes = "";
                  updates.cronHours = "";
                  updates.cronDayOfMonth = "";
                  updates.cronMonth = "";
                  updates.cronDayOfWeek = "";
                  updates.cronExpiryDate = "";
                } else if (value === "run-schedule") {
                  updates.scheduleDate = "";
                  updates.scheduleTime = "";
                }
                updateFormData(updates);
              }}
              options={EXECUTION_TIMING_OPTIONS.map(({ id, text }) => ({ id, text }))}
            />
            <Box variant="small" color="text-body-secondary">
              {EXECUTION_TIMING_OPTIONS.find(({ id }) => id === formData.executionTiming)?.description}
            </Box>
          </SpaceBetween>
        </FormField>

        {formData.executionTiming === "run-once" && (
          <SpaceBetween direction="vertical" size="s">
            <FormField label="Timezone" description="The timezone for the scheduled run.">
              {timezoneSelect}
            </FormField>
            <Grid gridDefinition={[{ colspan: 6 }, { colspan: 6 }]}>
              <FormField label="Run time" constraintText="Time must be in 24-hour format" errorText={runTimeError}>
                <Input
                  data-cy="schedule-time-input"
                  value={formData.scheduleTime}
                  onChange={({ detail }) => updateFormData({ scheduleTime: detail.value })}
                  onBlur={() => markTouched("scheduleTime")}
                  placeholder="00:00"
                  invalid={!!runTimeError}
                />
              </FormField>
              <FormField label="Run date" errorText={runDateError}>
                <DatePicker
                  data-cy="schedule-date-picker"
                  value={formData.scheduleDate}
                  onChange={({ detail }) => updateFormData({ scheduleDate: detail.value })}
                  onBlur={() => markTouched("scheduleDate")}
                  placeholder="YYYY/MM/DD"
                  isDateEnabled={isDateEnabled}
                  dateDisabledReason={() => "Date must be today or later"}
                  invalid={!!runDateError}
                />
              </FormField>
            </Grid>
          </SpaceBetween>
        )}

        {formData.executionTiming === "run-schedule" && (
          <SpaceBetween direction="vertical" size="m">
            <FormField
              label="Timezone"
              description="The timezone for the cron schedule. DST adjustments are handled automatically."
            >
              {timezoneSelect}
            </FormField>
            <FormField label="Select from common cron patterns">
              <Box fontSize="body-s">
                <SpaceBetween direction="horizontal" size="xs">
                  <Link fontSize="body-s" onFollow={() => applyCronPattern("0", "*", "*", "*", "*")}>
                    Every hour
                  </Link>
                  <Link fontSize="body-s" onFollow={() => applyCronPattern("0", "9", "*", "*", "*")}>
                    Daily at 9:00 AM
                  </Link>
                  <Link fontSize="body-s" onFollow={() => applyCronPattern("0", "8", "*", "*", "1-5")}>
                    Weekdays at 8:00 AM
                  </Link>
                  <Link fontSize="body-s" onFollow={() => applyCronPattern("0", "17", "*", "*", "0")}>
                    Every Sunday at 5 PM
                  </Link>
                  <Link fontSize="body-s" onFollow={() => applyCronPattern("0", "11", "1", "*", "*")}>
                    1st of month at 11 AM
                  </Link>
                </SpaceBetween>
              </Box>
            </FormField>
            <FormField
              stretch
              label="Schedule pattern"
              description="A fine-grained schedule that runs at a specific time in the selected timezone."
              errorText={cronError}
            >
              <Grid gridDefinition={CRON_FIELDS.map(() => ({ colspan: 2 }))}>
                {CRON_FIELDS.map((field) => (
                  <div key={field.key}>
                    <Input
                      ariaLabel={field.label}
                      value={formData[field.key] ?? ""}
                      onChange={({ detail }) => updateFormData({ [field.key]: detail.value })}
                      onBlur={() => markTouched(field.key)}
                      invalid={cronFieldMissing(field.key, formData[field.key] ?? "")}
                      placeholder={field.placeholder}
                    />
                    <Box variant="small" color="text-body-secondary">
                      {field.label}
                    </Box>
                  </div>
                ))}
              </Grid>
            </FormField>
            <FormField
              label="Expiry date"
              description="The date when the scheduled test should stop running"
              errorText={expiryError}
            >
              <DatePicker
                data-cy="cron-expiry-date-picker"
                value={formData.cronExpiryDate}
                onChange={({ detail }) => updateFormData({ cronExpiryDate: detail.value })}
                onBlur={() => markTouched("cronExpiryDate")}
                placeholder="YYYY/MM/DD"
                invalid={!!expiryError}
              />
            </FormField>
            {(cronFormatError || nextRun.dates.length > 0 || nextRun.error) && (
              <FormField
                label="Next Runs (Local time)"
                errorText={cronFormatError ? undefined : nextRun.error || undefined}
              >
                <Box variant="small">
                  {!cronFormatError && nextRun.dates.map((date) => <Box key={date}>• {date}</Box>)}
                </Box>
              </FormField>
            )}
          </SpaceBetween>
        )}
      </SpaceBetween>
    </FormSection>
  );
};
