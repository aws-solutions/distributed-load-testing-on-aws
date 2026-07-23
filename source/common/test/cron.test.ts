// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateCronExpression, parseCronExpression } from "../src/cron.ts";

describe("date-utils", () => {

  beforeEach(() => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    // Current time:
    //  Mar 5, 2026 at 5:45 PM PST
    //  Mar 5, 2026 at 8:45 PM EST
    //  Mar 6, 2026 at 1:45 AM UTC
    vi.setSystemTime(Date.UTC(2026, 2, 6, 1, 45, 0, 0));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it.each([
    [ "0 * * *", "Expected format: 0 * * * *" ],
    [ "0 *  * *", "Expected format: 0 * * * *" ],
    [ "30 1-3,4-9/2,12-22/3,*/10 ? Feb-May/2,Sep 1#3", "" ],
    [ "0 0 5 * ?", "" ],
    [ "0 0 ? * MON-WED,FRI", "" ],
    [ "5,10 * * * *", "Minutes must be a single value (0-59). Step values and lists are not supported." ],
    [ "abc * * * *", "Invalid characters, got value: abc" ],
    [ "0 25 * * *" , "Constraint error, got value 25 expected range 0-23" ],
    [ "0 0 32 * *", "Constraint error, got value 32 expected range 1-31" ],
    [ "0 0 * 13 *", "Constraint error, got value 13 expected range 1-12" ],
    [ "0 0 * * 8", "Constraint error, got value 8 expected range 0-7" ],
    [ "0 0 * * H", "Day of week must be *, ?, L, a value (0-6), name prefix (SUN-SAT), or a range/list (e.g., 1-5, 0,6)." ],
    [ "0 0 * H *", "Month must be *, a value (1-12), name prefix (JAN-DEC), or a range/list (e.g., 1-5, 1,5). Use '/N' to increment by N." ],
    [ "0 0 H * *", "Day of month must be *, ?, L, a value (1-31), or a range/list (e.g., 1-5, 1,5). Use '/N' to increment by N." ],
    [ "0 H * * *", "Hours must be *, a value (0-23), a step value (*/N or h/N), or a comma-separated list." ],
  ])("validateCronExpression('%s') -> '%s'", (cronExpression: string, expected: string) => {
    expect(validateCronExpression(cronExpression)).toBe(expected);
  });

  it.each([
    [ "0 * * * *", "2026-06-03", "America/New_York", [
      "2026-03-06T02:00:00.000Z",
      "2026-03-06T03:00:00.000Z",
      "2026-03-06T04:00:00.000Z",
      "2026-03-06T05:00:00.000Z",
      "2026-03-06T06:00:00.000Z",
    ] ],
    [ "30 * * * *", "2026-03-05", "America/New_York", [ // Expires today
      "2026-03-06T02:30:00.000Z",
      "2026-03-06T03:30:00.000Z",
      "2026-03-06T04:30:00.000Z",
    ] ],
    [ "30 * * * *", "2026-03-05", "", [ // UTC Expired yesterday
    ] ],
    [ "30 * * * *", "2026-03-06", "", [ // UTC Expires today
      "2026-03-06T02:30:00.000Z",
      "2026-03-06T03:30:00.000Z",
      "2026-03-06T04:30:00.000Z",
      "2026-03-06T05:30:00.000Z",
      "2026-03-06T06:30:00.000Z",
    ] ],
    [ "30 * * * *", "", "", [ // No Expire
      "2026-03-06T02:30:00.000Z",
      "2026-03-06T03:30:00.000Z",
      "2026-03-06T04:30:00.000Z",
      "2026-03-06T05:30:00.000Z",
      "2026-03-06T06:30:00.000Z",
    ] ],
    [ "30 8 L FEB-AUG/3,9 *", "2027-05-15", "America/Los_Angeles", [ // Last day of specific months
      "2026-05-31T15:30:00.000Z",
      "2026-08-31T15:30:00.000Z",
      "2026-09-30T15:30:00.000Z",
      "2027-02-28T16:30:00.000Z",
    ] ],
    [ "30 8 ? * TUE#3", "2027-05-15", "America/Los_Angeles", [ // Third Tuesday of each month
      "2026-03-17T15:30:00.000Z",
      "2026-04-21T15:30:00.000Z",
      "2026-05-19T15:30:00.000Z",
      "2026-06-16T15:30:00.000Z",
      "2026-07-21T15:30:00.000Z",
    ] ],
    [ "30 8 ? * 2#3", "2027-05-15", "America/Los_Angeles", [ // Third Tuesday of each month
      "2026-03-17T15:30:00.000Z",
      "2026-04-21T15:30:00.000Z",
      "2026-05-19T15:30:00.000Z",
      "2026-06-16T15:30:00.000Z",
      "2026-07-21T15:30:00.000Z",
    ] ],
    [ "30 8 ? * 2L", "2027-05-15", "America/Los_Angeles", [ // Last Tuesday of each month
      "2026-03-31T15:30:00.000Z",
      "2026-04-28T15:30:00.000Z",
      "2026-05-26T15:30:00.000Z",
      "2026-06-30T15:30:00.000Z",
      "2026-07-28T15:30:00.000Z",
    ] ],
  ])("parseCronExpression('%s', '%s') -> %s", (cronValue: string, expiryDate: string, scheduleTimezone: string | undefined, expected: string[]) => {
    const cron = parseCronExpression(cronValue, expiryDate, scheduleTimezone);
    expect(!cron).toBe(false);
    const series = cron.take(5).map(c => c.toDate().toISOString());
    expect(series).toStrictEqual(expected);
  });

});
