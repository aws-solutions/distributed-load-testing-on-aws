// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Component for test execution timing and schedule configuration

import {
  Box,
  Checkbox,
  Container,
  DatePicker,
  FormField,
  RadioGroup,
  Select,
  SpaceBetween,
  Input,
  Grid,
  Link,
} from "@cloudscape-design/components";
import { useMemo } from "react";
import { DateTime } from "luxon";
import { getTimeZones } from "@vvo/tzdb";
import { FormData } from "../types";
import { CronExpressionParser, CronExpressionOptions } from "cron-parser";
import { validateExpiryDate, parseExpiryDate, checkScheduleInFuture } from "../../../utils/dateValidation";
import { validateCronFields, formatCronValidationExpression } from "../../../utils/cronValidation";
import { FormSection } from "./FormSection";
import { SECTION_IDS } from "../utils/scenarioValidation";


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

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
}

export const ScheduleSection = ({ formData, updateFormData, showValidationErrors }: Props) => {
  const applyCronPattern = (minutes: string, hours: string, dayOfMonth: string, month: string, dayOfWeek: string) => {
    updateFormData({
      cronMinutes: minutes,
      cronHours: hours,
      cronDayOfMonth: dayOfMonth,
      cronMonth: month,
      cronDayOfWeek: dayOfWeek,
    });
  };

  const cronValidationError = useMemo(() => {
    if (formData.executionTiming !== "run-schedule") return "";

    const { cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek } = formData;

    // If required fields are missing, don't show regex validation error yet
    if (!cronMinutes || !cronHours) return "";

    // Treat empty strings as incomplete input — do not default to "*"
    if (cronDayOfMonth === "" || cronMonth === "" || cronDayOfWeek === "") return "";

    return validateCronFields({ cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek });
  }, [
    formData.executionTiming,
    formData.cronMinutes,
    formData.cronHours,
    formData.cronDayOfMonth,
    formData.cronMonth,
    formData.cronDayOfWeek,
  ]);

  const expiryDateError = useMemo(() => {
    if (formData.executionTiming !== "run-schedule" || !formData.cronExpiryDate) return "";
    return validateExpiryDate(formData.cronExpiryDate, formData.scheduleTimezone).errorMessage;
  }, [formData.cronExpiryDate, formData.executionTiming, formData.scheduleTimezone]);

  const scheduleDateTimeError = useMemo(() => {
    if (formData.executionTiming !== "run-once") return "";
    if (checkScheduleInFuture(formData.scheduleDate, formData.scheduleTime, formData.scheduleTimezone)) {
      return "";
    }
    return "Scheduled date and time must be in the future";
  }, [formData.executionTiming, formData.scheduleDate, formData.scheduleTime, formData.scheduleTimezone]);

  const isDateEnabled = useMemo(() => {
    const tz = formData.scheduleTimezone || "UTC";
    const today = DateTime.now().setZone(tz);
    const todayY = today.year, todayM = today.month, todayD = today.day;
    return (date: Date) => {
      const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
      return (y * 10000 + m * 100 + d) >= (todayY * 10000 + todayM * 100 + todayD);
    };
  }, [formData.scheduleTimezone]);

  const nextRun = useMemo(() => {
    const { cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek, cronExpiryDate, scheduleTimezone } =
      formData;
    if (!cronMinutes || !cronHours || !cronExpiryDate) return { dates: [], error: "" };

    // Prevent computation when fields are empty strings
    if (cronDayOfMonth === "" || cronMonth === "" || cronDayOfWeek === "") return { dates: [], error: "" };

    try {
      // Build Linux cron expression (5 fields)
      const cronExpression = formatCronValidationExpression({
        cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek
      });

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

  return (
    <FormSection sectionId={SECTION_IDS.SCHEDULE} headerText="Schedule">
      <SpaceBetween direction="vertical" size="s">
        <Box variant="small">Configure when the load test should run</Box>

        <FormField label="Execution timing">
          <RadioGroup
            value={formData.executionTiming}
            onChange={({ detail }) => {
              const updates: Partial<FormData> = { executionTiming: detail.value };
              if (detail.value === "run-now") {
                updates.scheduleDate = "";
                updates.scheduleTime = "";
                updates.cronMinutes = "";
                updates.cronHours = "";
                updates.cronDayOfMonth = "";
                updates.cronMonth = "";
                updates.cronDayOfWeek = "";
                updates.cronExpiryDate = "";
              } else if (detail.value === "run-once") {
                updates.cronMinutes = "";
                updates.cronHours = "";
                updates.cronDayOfMonth = "";
                updates.cronMonth = "";
                updates.cronDayOfWeek = "";
                updates.cronExpiryDate = "";
              } else if (detail.value === "run-schedule") {
                updates.scheduleDate = "";
                updates.scheduleTime = "";
              }
              updateFormData(updates);
            }}
            items={[
              {
                value: "run-now",
                label: "Run Now",
                description: "Execute the load test immediately after creation",
              },
              {
                value: "run-once",
                label: "Run Once",
                description: "Execute the test on a date and time",
              },
              {
                value: "run-schedule",
                label: "Run on a Schedule",
                description: "Enter a cron expression to define the schedule",
              },
            ]}
          />
        </FormField>
        {formData.executionTiming === "run-once" && (
          <Container>
            <SpaceBetween direction="vertical" size="s">
              <FormField
                stretch
                label="Run Once"
                description="Select the time of day and date when the load test should start running in the selected timezone."
              >
                <Grid gridDefinition={[{ colspan: 6 }, { colspan: 6 }]}>
                  <FormField
                    label="Run time"
                    constraintText="Time must be in 24-hour format"
                    errorText={
                      scheduleDateTimeError ||
                      (showValidationErrors && !formData.scheduleTime?.trim() ? "Run time is required" : undefined)
                    }
                  >
                    <Input
                      data-cy="schedule-time-input"
                      value={formData.scheduleTime}
                      onChange={({ detail }) => updateFormData({ scheduleTime: detail.value })}
                      placeholder="00:00"
                      invalid={!!scheduleDateTimeError || (showValidationErrors && !formData.scheduleTime?.trim())}
                    />
                  </FormField>
                  <FormField
                    label="Run date"
                    errorText={
                      showValidationErrors && !formData.scheduleDate?.trim() ? "Run date is required" : undefined
                    }
                  >
                    <DatePicker
                      data-cy="schedule-date-picker"
                      value={formData.scheduleDate}
                      onChange={({ detail }) => updateFormData({ scheduleDate: detail.value })}
                      placeholder="YYYY/MM/DD"
                      isDateEnabled={isDateEnabled}
                      dateDisabledReason={() => "Date must be today or later"}
                      invalid={showValidationErrors && !formData.scheduleDate?.trim()}
                    />
                  </FormField>
                </Grid>
              </FormField>
              <FormField label="Timezone" description="The timezone for the scheduled run.">
                <Select
                  selectedOption={timezoneOptions.find((opt) => opt.value === formData.scheduleTimezone) || null}
                  onChange={({ detail }) => updateFormData({ scheduleTimezone: detail.selectedOption.value ?? "UTC" })}
                  options={timezoneOptions}
                  filteringType="auto"
                  placeholder="Select a timezone"
                />
              </FormField>
            </SpaceBetween>
          </Container>
        )}
        {formData.executionTiming === "run-schedule" && (
          <Container>
            <SpaceBetween direction="vertical" size="m">
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
                description={`A fine-grained schedule that runs at a specific time in the selected timezone.`}
                errorText={cronValidationError || undefined}
              >
                <Grid disableGutters gridDefinition={[{ colspan: 1 }, { colspan: 10 }, { colspan: 1 }]}>
                  <Box padding="xs">
                    <b>cron (</b>
                  </Box>
                  <Box>
                    <Grid
                      disableGutters
                      gridDefinition={[
                        { colspan: 2 },
                        { colspan: 2 },
                        { colspan: 2 },
                        { colspan: 2 },
                        { colspan: 4 },
                        { colspan: 2 },
                        { colspan: 2 },
                        { colspan: 2 },
                        { colspan: 2 },
                        { colspan: 4 },
                      ]}
                    >
                      <Box padding="xxs">
                        <Input
                          value={formData.cronMinutes}
                          onChange={({ detail }) => updateFormData({ cronMinutes: detail.value })}
                          placeholder="minutes"
                        />
                      </Box>
                      <Box padding="xxs">
                        <Input
                          value={formData.cronHours}
                          onChange={({ detail }) => updateFormData({ cronHours: detail.value })}
                          placeholder="hours"
                        />
                      </Box>
                      <Box padding="xxs">
                        <Input
                          value={formData.cronDayOfMonth}
                          onChange={({ detail }) => updateFormData({ cronDayOfMonth: detail.value })}
                          placeholder="day of month"
                        />
                      </Box>
                      <Box padding="xxs">
                        <Input
                          value={formData.cronMonth}
                          onChange={({ detail }) => updateFormData({ cronMonth: detail.value })}
                          placeholder="month"
                        />
                      </Box>
                      <Box padding="xxs">
                        <Input
                          value={formData.cronDayOfWeek}
                          onChange={({ detail }) => updateFormData({ cronDayOfWeek: detail.value })}
                          placeholder="day of week"
                        />
                      </Box>
                      <Box padding="xxs">
                        <FormField description={"Minutes"}></FormField>
                      </Box>
                      <Box padding="xxs">
                        <FormField description={"Hours"}></FormField>
                      </Box>
                      <Box padding="xxs">
                        <FormField description={"Day of month"}></FormField>
                      </Box>
                      <Box padding="xxs">
                        <FormField description={"Month"}></FormField>
                      </Box>
                      <Box padding="xxs">
                        <FormField description={"Day of week (0-6)"}></FormField>
                      </Box>
                    </Grid>
                  </Box>
                  <Box padding="xs">
                    <b>)</b>
                  </Box>
                </Grid>
              </FormField>
              <FormField
                label="Expiry date"
                description="The date when the scheduled test should stop running"
                errorText={
                  expiryDateError ||
                  (showValidationErrors && !formData.cronExpiryDate ? "Expiry date is required" : undefined)
                }
              >
                <DatePicker
                  data-cy="cron-expiry-date-picker"
                  value={formData.cronExpiryDate}
                  onChange={({ detail }) => updateFormData({ cronExpiryDate: detail.value })}
                  placeholder="YYYY/MM/DD"
                  invalid={!!expiryDateError || (showValidationErrors && !formData.cronExpiryDate)}
                />
              </FormField>
              <FormField
                label="Timezone"
                description="The timezone for the cron schedule. DST adjustments are handled automatically."
              >
                <Select
                  selectedOption={timezoneOptions.find((opt) => opt.value === formData.scheduleTimezone) || null}
                  onChange={({ detail }) => updateFormData({ scheduleTimezone: detail.selectedOption.value ?? "UTC" })}
                  options={timezoneOptions}
                  filteringType="auto"
                  placeholder="Select a timezone"
                />
              </FormField>
              {(cronValidationError || nextRun.dates.length > 0 || nextRun.error) && (
                <FormField label="Next Runs (Local time)" errorText={!cronValidationError ? nextRun.error || undefined : undefined}>
                  <Box variant="small">
                    {!cronValidationError &&
                      nextRun.dates.map((date, index) => (
                        <Box key={index}>• {date}</Box>
                      ))}
                  </Box>
                </FormField>
              )}
            </SpaceBetween>
          </Container>
        )}
        <FormField label="Live data" description="Collect and analyze live data during execution">
          <Checkbox onChange={({ detail }) => updateFormData({ showLive: detail.checked })} checked={formData.showLive}>
            Include live data
          </Checkbox>
        </FormField>
      </SpaceBetween>
    </FormSection>
  );
};
