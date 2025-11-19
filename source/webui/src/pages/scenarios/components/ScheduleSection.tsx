// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Component for test execution timing and schedule configuration

import {
  Box,
  Checkbox,
  Container,
  DatePicker,
  FormField,
  Header,
  RadioGroup,
  SpaceBetween,
  Input,
  Grid,
  Link,
} from "@cloudscape-design/components";
import { useMemo } from "react";
import { DateTime } from "luxon";
import { FormData } from "../types";
import cronParser from "cron-parser";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
}

export const ScheduleSection = ({ formData, updateFormData, showValidationErrors }: Props) => {
  const applyCronPattern = (
    minutes: string,
    hours: string,
    dayOfMonth: string,
    month: string,
    dayOfWeek: string
  ) => {
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
    try {
      const dateParts = formData.cronExpiryDate.split(/[-/]/);
      if (dateParts.length !== 3) return "Invalid date format";
      
      const year = parseInt(dateParts[0]);
      const month = parseInt(dateParts[1]);
      const day = parseInt(dateParts[2]);
      
      if (isNaN(year) || isNaN(month) || isNaN(day)) return "Invalid date format";
      
      const expiryDate = new Date(year, month - 1, day, 23, 59, 59, 999);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return expiryDate < today ? "Expiry date must be in the future" : "";
    } catch {
      return "Invalid date format";
    }
  }, [formData.cronExpiryDate, formData.executionTiming]);

  const nextRun = useMemo(() => {
    const { cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek, cronExpiryDate } = formData;
    if (!cronMinutes || !cronHours) return { dates: [], error: "" };

    try {
      // Convert ? to * for cron-parser compatibility
      const dayOfMonth = cronDayOfMonth === "?" ? "*" : cronDayOfMonth;
      const dayOfWeek = cronDayOfWeek === "?" ? "*" : cronDayOfWeek;

      // Build Linux cron expression (5 fields)
      const cronExpression = `${cronMinutes} ${cronHours} ${dayOfMonth} ${cronMonth} ${dayOfWeek}`;

      // Parse using cron-parser
      const interval = cronParser.parse(cronExpression);
      let expiryDate = null;
      
      if (cronExpiryDate) {
        const dateParts = cronExpiryDate.split(/[-/]/);
        if (dateParts.length === 3) {
          const year = parseInt(dateParts[0]);
          const month = parseInt(dateParts[1]);
          const day = parseInt(dateParts[2]);
          if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
            expiryDate = new Date(year, month - 1, day, 23, 59, 59, 999);
          }
        }
      }
      
      const dates: string[] = [];
      while (dates.length < 5) {
        const nextDate = interval.next().toDate();
        if (expiryDate && nextDate > expiryDate) break;
        const formatted = DateTime.fromJSDate(nextDate).toFormat("MMM d, yyyy, h:mm a");
        if (!dates.includes(formatted)) dates.push(formatted);
      }

      return { dates, error: dates.length === 0 ? "No matching dates found" : "" };
    } catch (error) {
      console.error("Error parsing cron expression:", error);
      return { dates: [], error: "Invalid cron expression" };
    }
  }, [
    formData.cronMinutes,
    formData.cronHours,
    formData.cronDayOfMonth,
    formData.cronMonth,
    formData.cronDayOfWeek,
    formData.cronExpiryDate,
  ]);

  return (
    <Container header={<Header variant="h2">Schedule</Header>}>
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
                description="Select the time of day and date when the load test should start running (browser time)."
              >
                <Grid gridDefinition={[{ colspan: 6 }, { colspan: 6 }]}>
                  <FormField 
                    label="Run time" 
                    constraintText="Time must be in 24-hour format"
                    errorText={showValidationErrors && !formData.scheduleTime?.trim() ? "Run time is required" : undefined}
                  >
                    <Input
                      value={formData.scheduleTime}
                      onChange={({ detail }) => updateFormData({ scheduleTime: detail.value })}
                      placeholder="00:00"
                      invalid={showValidationErrors && !formData.scheduleTime?.trim()}
                    />
                  </FormField>
                  <FormField 
                    label="Run date"
                    errorText={showValidationErrors && !formData.scheduleDate?.trim() ? "Run date is required" : undefined}
                  >
                    <DatePicker
                      value={formData.scheduleDate}
                      onChange={({ detail }) => updateFormData({ scheduleDate: detail.value })}
                      placeholder="YYYY/MM/DD"
                      invalid={showValidationErrors && !formData.scheduleDate?.trim()}
                    />
                  </FormField>
                </Grid>
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
                description="A fine-grained schedule that runs at a specific time, such as 8:00 a.m. PST on the first Monday of every month."
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
                        <FormField description={"Day of week"}></FormField>
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
                errorText={expiryDateError || (showValidationErrors && !formData.cronExpiryDate ? "Expiry date is required" : undefined)}
              >
                <DatePicker
                  value={formData.cronExpiryDate}
                  onChange={({ detail }) => updateFormData({ cronExpiryDate: detail.value })}
                  placeholder="YYYY/MM/DD"
                  invalid={!!expiryDateError || (showValidationErrors && !formData.cronExpiryDate)}
                />
              </FormField>
              {(nextRun.dates.length > 0 || nextRun.error) && (
                <FormField label="Next Run Dates" errorText={nextRun.error || undefined}>
                  <Box variant="small">
                    {nextRun.dates.map((date) => (
                      <Box key={date}>• {date}</Box>
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
    </Container>
  );
};
