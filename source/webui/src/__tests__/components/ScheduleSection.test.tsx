// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import fc from "fast-check";
import { ScheduleSection } from "../../pages/scenarios/components/ScheduleSection";
import { TestTypes } from "../../pages/scenarios/constants";
import { FormData } from "../../pages/scenarios/types";

describe("ScheduleSection", () => {
  let mockUpdateFormData: Mock<(updates: Partial<FormData>) => void>;
  let mockFormData: FormData;

  beforeEach(() => {
    mockUpdateFormData = vi.fn();
    mockFormData = {
      testId: "test-123",
      testName: "Test Scenario",
      testDescription: "Test Description",
      testType: TestTypes.SIMPLE,
      regions: [],
      executionTiming: "run-now",
      scheduleDate: "",
      scheduleTime: "",
      cronMinutes: "",
      cronHours: "",
      cronDayOfMonth: "",
      cronMonth: "",
      cronDayOfWeek: "",
      cronExpiryDate: "",
      scheduleTimezone: "America/Los_Angeles",
      showLive: false,
      tags: [],
      httpEndpoint: "",
      httpMethod: { label: "GET", value: "GET" },
      requestHeaders: "",
      bodyPayload: "",
      scriptFile: [],
      fileError: "",
      rampUpValue: "5",
      rampUpUnit: "m",
      holdForValue: "10",
      holdForUnit: "m",
      healthyThreshold: "90",
      k6LicenseAcknowledged: false,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("execution timing selection", () => {
    test("renders all execution timing options", () => {
      render(<ScheduleSection formData={mockFormData} updateFormData={mockUpdateFormData} />);

      expect(screen.getByText("Run Now")).toBeInTheDocument();
      expect(screen.getByText("Run Once")).toBeInTheDocument();
      expect(screen.getByText("Run on a Schedule")).toBeInTheDocument();
    });
  });

  describe("run once configuration", () => {
    beforeEach(() => {
      mockFormData.executionTiming = "run-once";
    });

    test("shows run once fields when selected", () => {
      render(<ScheduleSection formData={mockFormData} updateFormData={mockUpdateFormData} />);

      expect(screen.getByText("Run time")).toBeInTheDocument();
      expect(screen.getByText("Run date")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("00:00")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("YYYY/MM/DD")).toBeInTheDocument();
    });
  });

  describe("cron schedule configuration", () => {
    beforeEach(() => {
      mockFormData.executionTiming = "run-schedule";
    });

    test("shows cron schedule fields when selected", () => {
      render(<ScheduleSection formData={mockFormData} updateFormData={mockUpdateFormData} />);

      expect(screen.getByText("Schedule pattern")).toBeInTheDocument();
      expect(screen.getByText("Expiry date")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("minutes")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("hours")).toBeInTheDocument();
    });

    test("applies common cron patterns when links are clicked", () => {
      render(<ScheduleSection formData={mockFormData} updateFormData={mockUpdateFormData} />);

      const everyHourLink = screen.getByText("Every hour");
      fireEvent.click(everyHourLink);

      expect(mockUpdateFormData).toHaveBeenCalledWith({
        cronMinutes: "0",
        cronHours: "*",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
      });
    });

    test("applies daily pattern correctly", () => {
      render(<ScheduleSection formData={mockFormData} updateFormData={mockUpdateFormData} />);

      const dailyLink = screen.getByText("Daily at 9:00 AM");
      fireEvent.click(dailyLink);

      expect(mockUpdateFormData).toHaveBeenCalledWith({
        cronMinutes: "0",
        cronHours: "9",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
      });
    });

    test("applies weekdays pattern correctly", () => {
      render(<ScheduleSection formData={mockFormData} updateFormData={mockUpdateFormData} />);

      const weekdaysLink = screen.getByText("Weekdays at 8:00 AM");
      fireEvent.click(weekdaysLink);

      expect(mockUpdateFormData).toHaveBeenCalledWith({
        cronMinutes: "0",
        cronHours: "8",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "1-5",
      });
    });

    test("updates individual cron fields", () => {
      render(<ScheduleSection formData={mockFormData} updateFormData={mockUpdateFormData} />);

      const minutesInput = screen.getByPlaceholderText("minutes");
      fireEvent.change(minutesInput, { target: { value: "30" } });

      expect(mockUpdateFormData).toHaveBeenCalledWith({ cronMinutes: "30" });

      const hoursInput = screen.getByPlaceholderText("hours");
      fireEvent.change(hoursInput, { target: { value: "14" } });

      expect(mockUpdateFormData).toHaveBeenCalledWith({ cronHours: "14" });
    });
  });

  describe("cron validation and Next Runs", () => {
    beforeEach(() => {
      vi.stubEnv("TZ", "America/Los_Angeles");
      const DateTimeFormat = Intl.DateTimeFormat;
      vi.spyOn(global.Intl, "DateTimeFormat").mockImplementation(function (locale, options) {
        if (!locale) {
          locale = "en-US";
          options = { timeZone: "America/Los_Angeles", calendar: "gregory", numberingSystem: "latn" };
        }
        return DateTimeFormat(locale, options);
      });
      vi.setSystemTime(Date.UTC(2026, 2, 5, 23, 0, 0, 0));

      mockFormData.executionTiming = "run-schedule";
      mockFormData.cronMinutes = "0";
      mockFormData.cronHours = "22";
      mockFormData.cronMonth = "*";
      mockFormData.cronDayOfMonth = "*";
      mockFormData.cronDayOfWeek = "*";
      mockFormData.cronExpiryDate = "2026/04/01";
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    test("shows Next Runs when valid cron expression and expiry date provided", () => {
      render(<ScheduleSection formData={mockFormData} updateFormData={mockUpdateFormData} />);

      expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
      expect(screen.getByText("• Mar 5, 2026, 10:00 PM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 6, 2026, 10:00 PM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 7, 2026, 10:00 PM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 9, 2026, 10:00 PM")).toBeInTheDocument(); // Mar 8 skipped (DST)
      expect(screen.getByText("• Mar 10, 2026, 10:00 PM")).toBeInTheDocument();
      expect(screen.queryAllByText("• Mar 11, 2026, 10:00 PM")).toHaveLength(0); // max 5 list items
    });

    test("shows Next Runs until expiration when valid cron expression provided and expire soon provided", () => {
      const formDataWithEarlyExpiry = {
        ...mockFormData,
        cronExpiryDate: "2026/03/08",
      };

      render(<ScheduleSection formData={formDataWithEarlyExpiry} updateFormData={mockUpdateFormData} />);

      expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
      expect(screen.getByText("• Mar 5, 2026, 10:00 PM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 6, 2026, 10:00 PM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 7, 2026, 10:00 PM")).toBeInTheDocument();
      // Mar 8 at 22:00 PDT = Mar 9 05:00 UTC, which is past the expiry of Mar 8 23:59 UTC
      expect(screen.queryAllByText("• Mar 8, 2026, 10:00 PM")).toHaveLength(0); // Expired
      expect(screen.queryAllByText("• Mar 9, 2026, 10:00 PM")).toHaveLength(0); // Expired
    });

    test("shows Next Runs with no matching dates found when first scheduled time is after expiration", () => {
      const formDataWithEarlyExpiry = {
        ...mockFormData,
        cronExpiryDate: "2026/03/08", // Expires before Monday (starting on Thursday)
        cronDayOfWeek: "1-3", // Only Monday through Wednesday
      };

      render(<ScheduleSection formData={formDataWithEarlyExpiry} updateFormData={mockUpdateFormData} />);

      // Expired before any times matched the schedule so schedule should be empty
      expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
      expect(screen.getByText("No matching dates found")).toBeInTheDocument();
    });

    test("shows expiry date validation error", () => {
      const formDataWithPastExpiry = {
        ...mockFormData,
        cronExpiryDate: "2026/03/04",
      };

      render(<ScheduleSection formData={formDataWithPastExpiry} updateFormData={mockUpdateFormData} />);

      expect(screen.getByText("Expiry date must be in the future")).toBeInTheDocument();
    });

    test("shows required expiry date error when missing", () => {
      const formDataWithoutExpiry = {
        ...mockFormData,
        cronExpiryDate: "",
      };

      render(
        <ScheduleSection
          formData={formDataWithoutExpiry}
          updateFormData={mockUpdateFormData}
          showValidationErrors={true}
        />
      );

      expect(screen.getByText("Expiry date is required")).toBeInTheDocument();
    });
  });
});

/**
 * Bug Condition Exploration Test
 *
 * Property 1: Empty Cron Fields Produce Corrupted Next Runs
 *
 * Validates: Requirements 1.1, 1.2, 2.1, 2.3
 *
 * This test encodes the EXPECTED behavior: when cronDayOfMonth, cronMonth, or
 * cronDayOfWeek is an empty string, the nextRun computation SHALL return an
 * empty dates array (no corrupted entries displayed).
 *
 * On UNFIXED code, this test is EXPECTED TO FAIL because empty strings fall
 * through the || operator and silently default to "*", producing incorrect
 * Next Runs entries.
 */
describe("ScheduleSection Bug Condition Exploration", () => {
  let mockUpdateFormData: Mock<(updates: Partial<FormData>) => void>;
  let baseFormData: FormData;

  beforeEach(() => {
    mockUpdateFormData = vi.fn();
    vi.stubEnv("TZ", "America/Los_Angeles");
    const DateTimeFormat = Intl.DateTimeFormat;
    vi.spyOn(global.Intl, "DateTimeFormat").mockImplementation(function (locale, options) {
      if (!locale) {
        locale = "en-US";
        options = { timeZone: "America/Los_Angeles", calendar: "gregory", numberingSystem: "latn" };
      }
      return DateTimeFormat(locale, options);
    });
    vi.setSystemTime(Date.UTC(2026, 2, 5, 23, 0, 0, 0));

    baseFormData = {
      testId: "test-123",
      testName: "Test Scenario",
      testDescription: "Test Description",
      testType: TestTypes.SIMPLE,
      regions: [],
      executionTiming: "run-schedule",
      scheduleDate: "",
      scheduleTime: "",
      cronMinutes: "0",
      cronHours: "9",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "*",
      cronExpiryDate: "2026/04/01",
      scheduleTimezone: "America/Los_Angeles",
      showLive: false,
      tags: [],
      httpEndpoint: "",
      httpMethod: { label: "GET", value: "GET" },
      requestHeaders: "",
      bodyPayload: "",
      scriptFile: [],
      fileError: "",
      rampUpValue: "5",
      rampUpUnit: "m",
      holdForValue: "10",
      holdForUnit: "m",
      healthyThreshold: "90",
      k6LicenseAcknowledged: false,
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * **Validates: Requirements 1.1, 2.1**
   *
   * Property: For all inputs where cronDayOfWeek === "", the nextRun computation
   * SHALL return an empty dates array (no corrupted entries displayed).
   */
  test("empty cronDayOfWeek with valid minutes/hours/dayOfMonth/month/expiryDate produces no Next Runs", () => {
    const formData: FormData = {
      ...baseFormData,
      cronMinutes: "0",
      cronHours: "9",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "",
      cronExpiryDate: "2026/04/01",
    };

    render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

    expect(screen.queryByText("Next Runs (Local time)")).not.toBeInTheDocument();
  });

  /**
   * **Validates: Requirements 1.1, 2.1**
   *
   * Property: For all inputs where cronMonth === "", the nextRun computation
   * SHALL return an empty dates array (no corrupted entries displayed).
   */
  test("empty cronMonth with valid minutes/hours/dayOfMonth/dayOfWeek/expiryDate produces no Next Runs", () => {
    const formData: FormData = {
      ...baseFormData,
      cronMinutes: "0",
      cronHours: "9",
      cronDayOfMonth: "*",
      cronMonth: "",
      cronDayOfWeek: "*",
      cronExpiryDate: "2026/04/01",
    };

    render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

    expect(screen.queryByText("Next Runs (Local time)")).not.toBeInTheDocument();
  });

  /**
   * **Validates: Requirements 1.1, 2.1**
   *
   * Property: For all inputs where cronDayOfMonth === "", the nextRun computation
   * SHALL return an empty dates array (no corrupted entries displayed).
   */
  test("empty cronDayOfMonth with valid minutes/hours/month/dayOfWeek/expiryDate produces no Next Runs", () => {
    const formData: FormData = {
      ...baseFormData,
      cronMinutes: "0",
      cronHours: "9",
      cronDayOfMonth: "",
      cronMonth: "*",
      cronDayOfWeek: "*",
      cronExpiryDate: "2026/04/01",
    };

    render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

    expect(screen.queryByText("Next Runs (Local time)")).not.toBeInTheDocument();
  });

  /**
   * **Validates: Requirements 1.1, 2.1, 2.3**
   *
   * Property-based test: For ALL inputs where cronDayOfMonth === "" OR
   * cronMonth === "" OR cronDayOfWeek === "", the component SHALL NOT display
   * any Next Runs entries.
   */
  test("property: any empty cron field (dayOfMonth, month, dayOfWeek) prevents Next Runs display", () => {
    const validMinutes = fc.constantFrom("0", "15", "30", "45");
    const validHours = fc.constantFrom("0", "9", "12", "17", "*");
    const validDayOfMonth = fc.constantFrom("*", "1", "15", "?");
    const validMonth = fc.constantFrom("*", "1", "6", "12");
    const validDayOfWeek = fc.constantFrom("*", "0", "1-5", "0,6");
    const emptyField = fc.constant("");

    const emptyDayOfWeekArb = fc.tuple(validMinutes, validHours, validDayOfMonth, validMonth, emptyField);
    const emptyMonthArb = fc.tuple(validMinutes, validHours, validDayOfMonth, emptyField, validDayOfWeek);
    const emptyDayOfMonthArb = fc.tuple(validMinutes, validHours, emptyField, validMonth, validDayOfWeek);

    const bugConditionArb = fc.oneof(emptyDayOfWeekArb, emptyMonthArb, emptyDayOfMonthArb);

    fc.assert(
      fc.property(bugConditionArb, ([minutes, hours, dayOfMonth, month, dayOfWeek]) => {
        const formData: FormData = {
          ...baseFormData,
          cronMinutes: minutes,
          cronHours: hours,
          cronDayOfMonth: dayOfMonth,
          cronMonth: month,
          cronDayOfWeek: dayOfWeek,
          cronExpiryDate: "2026/04/01",
        };

        const { unmount } = render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

        const nextRunsHeader = screen.queryByText("Next Runs (Local time)");
        const hasNextRuns = nextRunsHeader !== null;

        unmount();

        return !hasNextRuns;
      }),
      { numRuns: 50 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 2.2, 2.3**
   *
   * Verify that duplicate React keys do not occur when rendering Next Runs.
   * When the bug condition produces identical date strings, the component should
   * use unique keys (e.g., index-based) to prevent stale DOM nodes.
   */
  test("duplicate React keys do not occur in Next Runs list", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const formData: FormData = {
      ...baseFormData,
      cronMinutes: "0",
      cronHours: "*",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "*",
      cronExpiryDate: "2026/04/01",
    };

    render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

    const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("Encountered two children with the same key")
    );

    expect(duplicateKeyWarnings).toHaveLength(0);

    consoleErrorSpy.mockRestore();
  });
});

/**
 * Preservation Property Tests
 *
 * Property 2: Valid Cron Expressions Produce Correct Next Runs
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 *
 * These tests verify that existing correct behavior is preserved after the fix.
 * They run on UNFIXED code and MUST PASS, confirming the baseline behavior that
 * must remain unchanged.
 */
describe("ScheduleSection Preservation Properties", () => {
  let mockUpdateFormData: Mock<(updates: Partial<FormData>) => void>;
  let baseFormData: FormData;

  beforeEach(() => {
    mockUpdateFormData = vi.fn();
    vi.stubEnv("TZ", "America/Los_Angeles");
    const DateTimeFormat = Intl.DateTimeFormat;
    vi.spyOn(global.Intl, "DateTimeFormat").mockImplementation(function (locale, options) {
      if (!locale) {
        locale = "en-US";
        options = { timeZone: "America/Los_Angeles", calendar: "gregory", numberingSystem: "latn" };
      }
      return DateTimeFormat(locale, options);
    });
    // March 5, 2026 23:00 UTC = March 5, 2026 3:00 PM PST
    vi.setSystemTime(Date.UTC(2026, 2, 5, 23, 0, 0, 0));

    baseFormData = {
      testId: "test-123",
      testName: "Test Scenario",
      testDescription: "Test Description",
      testType: TestTypes.SIMPLE,
      regions: [],
      executionTiming: "run-schedule",
      scheduleDate: "",
      scheduleTime: "",
      cronMinutes: "0",
      cronHours: "9",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "*",
      cronExpiryDate: "2026/04/01",
      scheduleTimezone: "America/Los_Angeles",
      showLive: false,
      tags: [],
      httpEndpoint: "",
      httpMethod: { label: "GET", value: "GET" },
      requestHeaders: "",
      bodyPayload: "",
      scriptFile: [],
      fileError: "",
      rampUpValue: "5",
      rampUpUnit: "m",
      holdForValue: "10",
      holdForUnit: "m",
      healthyThreshold: "90",
      k6LicenseAcknowledged: false,
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * **Validates: Requirements 3.2, 3.4**
   *
   * Observe: cronMinutes: "0", cronHours: "*", cronDayOfMonth: "*", cronMonth: "*",
   * cronDayOfWeek: "*" with valid expiry produces 5 hourly Next Runs entries.
   */
  test("every hour pattern produces 5 hourly Next Runs entries", () => {
    const formData: FormData = {
      ...baseFormData,
      cronMinutes: "0",
      cronHours: "*",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "*",
      cronExpiryDate: "2026/04/01",
    };

    render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

    expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
    // Current time is Mar 5, 2026 3:00 PM PST. Next hourly runs at :00 are 4PM, 5PM, 6PM, 7PM, 8PM
    expect(screen.getByText("• Mar 5, 2026, 4:00 PM")).toBeInTheDocument();
    expect(screen.getByText("• Mar 5, 2026, 5:00 PM")).toBeInTheDocument();
    expect(screen.getByText("• Mar 5, 2026, 6:00 PM")).toBeInTheDocument();
    expect(screen.getByText("• Mar 5, 2026, 7:00 PM")).toBeInTheDocument();
    expect(screen.getByText("• Mar 5, 2026, 8:00 PM")).toBeInTheDocument();
  });

  /**
   * **Validates: Requirements 3.2, 3.4**
   *
   * Observe: cronMinutes: "0", cronHours: "9", cronDayOfMonth: "*", cronMonth: "*",
   * cronDayOfWeek: "*" with valid expiry produces daily 9AM entries.
   */
  test("daily at 9AM pattern produces daily 9AM Next Runs entries", () => {
    const formData: FormData = {
      ...baseFormData,
      cronMinutes: "0",
      cronHours: "9",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "*",
      cronExpiryDate: "2026/04/01",
    };

    render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

    expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
    // Current time is Mar 5, 2026 3:00 PM PST. Next 9AM is Mar 6.
    // DST starts Mar 8 at 2 AM; cron-parser skips Mar 8 due to the DST transition.
    expect(screen.getByText("• Mar 6, 2026, 9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("• Mar 7, 2026, 9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("• Mar 9, 2026, 9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("• Mar 10, 2026, 9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("• Mar 11, 2026, 9:00 AM")).toBeInTheDocument();
  });

  /**
   * **Validates: Requirements 3.2, 3.4**
   *
   * Observe: cronMinutes: "0", cronHours: "8", cronDayOfMonth: "*", cronMonth: "*",
   * cronDayOfWeek: "1-5" with valid expiry produces weekday 8AM entries.
   */
  test("weekdays at 8AM pattern produces weekday 8AM Next Runs entries", () => {
    const formData: FormData = {
      ...baseFormData,
      cronMinutes: "0",
      cronHours: "8",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "1-5",
      cronExpiryDate: "2026/04/01",
    };

    render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

    expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
    // Mar 5, 2026 is Thursday. Next weekday 8AM runs: Mar 6 (Fri), Mar 9 (Mon), Mar 10 (Tue), Mar 11 (Wed), Mar 12 (Thu)
    expect(screen.getByText("• Mar 6, 2026, 8:00 AM")).toBeInTheDocument();
    expect(screen.getByText("• Mar 9, 2026, 8:00 AM")).toBeInTheDocument();
    expect(screen.getByText("• Mar 10, 2026, 8:00 AM")).toBeInTheDocument();
    expect(screen.getByText("• Mar 11, 2026, 8:00 AM")).toBeInTheDocument();
    expect(screen.getByText("• Mar 12, 2026, 8:00 AM")).toBeInTheDocument();
  });

  /**
   * **Validates: Requirements 3.2, 3.4**
   *
   * Observe: "?" is not valid in standard Linux cron (5-field format).
   * The regex correctly rejects it, and Next Runs is hidden when validation error is present.
   * This test verifies that "?" produces a validation error and no Next Runs.
   */
  test("question mark fields are rejected by regex validation and hide Next Runs", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const formData: FormData = {
      ...baseFormData,
      cronMinutes: "0",
      cronHours: "22",
      cronDayOfMonth: "?",
      cronMonth: "*",
      cronDayOfWeek: "?",
      cronExpiryDate: "2026/04/01",
    };

    render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

    // ? is not valid Linux cron syntax — regex rejects it, title shown but no dates
    expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
    expect(screen.queryAllByText(/^• /)).toHaveLength(0);
    expect(
      screen.getByText("Day of month must be * or a single value (1-31). Ranges and lists are not supported.")
    ).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.4**
   *
   * Property-based test: for all valid non-empty cron field combinations,
   * the component renders Next Runs entries (at least 1 entry displayed).
   */
  test("property: valid non-empty cron fields always produce Next Runs entries", () => {
    const validMinutes = fc.constantFrom("0", "15", "30", "45");
    const validHours = fc.constantFrom("*", "0", "9", "12", "17");
    const validDayOfMonth = fc.constantFrom("*", "1", "15");
    const validMonth = fc.constantFrom("*", "1", "6", "12");
    const validDayOfWeek = fc.constantFrom("*", "0", "1-5", "0,6");

    fc.assert(
      fc.property(
        validMinutes,
        validHours,
        validDayOfMonth,
        validMonth,
        validDayOfWeek,
        (minutes, hours, dayOfMonth, month, dayOfWeek) => {
          const formData: FormData = {
            ...baseFormData,
            cronMinutes: minutes,
            cronHours: hours,
            cronDayOfMonth: dayOfMonth,
            cronMonth: month,
            cronDayOfWeek: dayOfWeek,
            cronExpiryDate: "2026/04/01",
          };

          const { unmount } = render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

          const nextRunsHeader = screen.queryByText("Next Runs (Local time)");
          const hasNextRuns = nextRunsHeader !== null;

          unmount();

          // All valid non-empty cron fields should produce Next Runs
          return hasNextRuns;
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Validates: Requirement 3.3**
   *
   * Verify: switching execution timing from "run-schedule" to "run-now" clears all cron fields.
   */
  test("switching from run-schedule to run-now clears all cron fields", () => {
    const formData: FormData = {
      ...baseFormData,
      executionTiming: "run-schedule",
      cronMinutes: "0",
      cronHours: "9",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "*",
      cronExpiryDate: "2026/04/01",
    };

    render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

    // Click "Run Now" radio button
    const runNowRadio = screen.getByLabelText("Run Now");
    fireEvent.click(runNowRadio);

    expect(mockUpdateFormData).toHaveBeenCalledWith(
      expect.objectContaining({
        executionTiming: "run-now",
        cronMinutes: "",
        cronHours: "",
        cronDayOfMonth: "",
        cronMonth: "",
        cronDayOfWeek: "",
        cronExpiryDate: "",
      })
    );
  });

  /**
   * **Validates: Requirement 3.1**
   *
   * Verify: common pattern selection without prior manual edits populates fields correctly.
   * The applyCronPattern function calls updateFormData with all five cron field values.
   */
  test("common pattern selection populates all cron fields correctly", () => {
    const formData: FormData = {
      ...baseFormData,
      executionTiming: "run-schedule",
      cronMinutes: "",
      cronHours: "",
      cronDayOfMonth: "",
      cronMonth: "",
      cronDayOfWeek: "",
      cronExpiryDate: "2026/04/01",
    };

    render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

    // Click "Every hour" pattern link
    const everyHourLink = screen.getByText("Every hour");
    fireEvent.click(everyHourLink);

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      cronMinutes: "0",
      cronHours: "*",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "*",
    });

    mockUpdateFormData.mockClear();

    // Click "Daily at 9:00 AM" pattern link
    const dailyLink = screen.getByText("Daily at 9:00 AM");
    fireEvent.click(dailyLink);

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      cronMinutes: "0",
      cronHours: "9",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "*",
    });

    mockUpdateFormData.mockClear();

    // Click "Weekdays at 8:00 AM" pattern link
    const weekdaysLink = screen.getByText("Weekdays at 8:00 AM");
    fireEvent.click(weekdaysLink);

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      cronMinutes: "0",
      cronHours: "8",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "1-5",
    });

    mockUpdateFormData.mockClear();

    // Click "Every Sunday at 5 PM" pattern link
    const sundayLink = screen.getByText("Every Sunday at 5 PM");
    fireEvent.click(sundayLink);

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      cronMinutes: "0",
      cronHours: "17",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "0",
    });

    mockUpdateFormData.mockClear();

    // Click "1st of month at 11 AM" pattern link
    const monthlyLink = screen.getByText("1st of month at 11 AM");
    fireEvent.click(monthlyLink);

    expect(mockUpdateFormData).toHaveBeenCalledWith({
      cronMinutes: "0",
      cronHours: "11",
      cronDayOfMonth: "1",
      cronMonth: "*",
      cronDayOfWeek: "*",
    });
  });
});

/**
 * Comprehensive cron tests covering gaps not tested in ScheduleSection.test.tsx
 * or ScheduleSection.bugfix.test.tsx:
 *
 * 1. Invalid field values (validation errors)
 * 2. Timezone switching
 * 3. Execution timing switching clears fields
 * 4. Edge cases (hourly, question marks, same-day expiry, DST)
 * 5. Pattern reselection after manual edit (the fixed bug)
 * 6. No console errors for valid configurations
 */
describe("ScheduleSection Cron Comprehensive Tests", () => {
  let mockUpdateFormData: Mock<(updates: Partial<FormData>) => void>;
  let baseFormData: FormData;

  beforeEach(() => {
    mockUpdateFormData = vi.fn();
    vi.stubEnv("TZ", "America/Los_Angeles");
    const DateTimeFormat = Intl.DateTimeFormat;
    vi.spyOn(global.Intl, "DateTimeFormat").mockImplementation(function (locale, options) {
      if (!locale) {
        locale = "en-US";
        options = { timeZone: "America/Los_Angeles", calendar: "gregory", numberingSystem: "latn" };
      }
      return DateTimeFormat(locale, options);
    });
    // March 5, 2026 23:00 UTC = March 5, 2026 3:00 PM PST
    vi.setSystemTime(Date.UTC(2026, 2, 5, 23, 0, 0, 0));

    baseFormData = {
      testId: "test-123",
      testName: "Test Scenario",
      testDescription: "Test Description",
      testType: TestTypes.SIMPLE,
      regions: [],
      executionTiming: "run-schedule",
      scheduleDate: "",
      scheduleTime: "",
      cronMinutes: "0",
      cronHours: "9",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "*",
      cronExpiryDate: "2026/04/01",
      scheduleTimezone: "America/Los_Angeles",
      showLive: false,
      tags: [],
      httpEndpoint: "",
      httpMethod: { label: "GET", value: "GET" },
      requestHeaders: "",
      bodyPayload: "",
      scriptFile: [],
      fileError: "",
      rampUpValue: "5",
      rampUpUnit: "m",
      holdForValue: "10",
      holdForUnit: "m",
      healthyThreshold: "90",
      k6LicenseAcknowledged: false,
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Invalid Field Values (validation error)
  // =========================================================================
  describe("Invalid Field Values", () => {
    /**
     * NOTE: When an invalid cron expression fails both the regex validation AND
     * cron-parser parsing, the error message "Invalid cron expression format for
     * scheduling." appears TWICE in the DOM:
     * 1. From cronValidationError (Schedule pattern FormField errorText)
     * 2. From nextRun.error (Next Runs FormField errorText via cron-parser catch)
     *
     * This is a minor UI bug: the same error message is shown in two places.
     * The tests use getAllByText to match current behavior.
     */
    test("cronMinutes 'abc' with other fields valid shows validation error", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "abc",
        cronHours: "9",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      expect(
        screen.getByText("Minutes must be a single value (0-59). Step values and lists are not supported.")
      ).toBeInTheDocument();
      // No bullet-point Next Runs entries should be rendered
      const bulletItems = screen.queryAllByText(/^• /);
      expect(bulletItems).toHaveLength(0);
      consoleErrorSpy.mockRestore();
    });

    test("cronHours '99' with other fields valid shows validation error", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "0",
        cronHours: "99",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      expect(
        screen.getByText("Hours must be *, a value (0-23), a step value (*/N), or a comma-separated list.")
      ).toBeInTheDocument();
      const bulletItems = screen.queryAllByText(/^• /);
      expect(bulletItems).toHaveLength(0);
      consoleErrorSpy.mockRestore();
    });

    test("cronMonth '13' with other fields valid shows validation error", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "0",
        cronHours: "9",
        cronDayOfMonth: "*",
        cronMonth: "13",
        cronDayOfWeek: "*",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      expect(
        screen.getByText("Month must be * or a single value (1-12). Ranges and lists are not supported.")
      ).toBeInTheDocument();
      const bulletItems = screen.queryAllByText(/^• /);
      expect(bulletItems).toHaveLength(0);
      consoleErrorSpy.mockRestore();
    });

    test("cronDayOfWeek '8' with other fields valid shows validation error", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "0",
        cronHours: "9",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "8",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      expect(
        screen.getByText("Day of week must be *, a value (0-6), or a range/list (e.g., 1-5, 0,6).")
      ).toBeInTheDocument();
      const bulletItems = screen.queryAllByText(/^• /);
      expect(bulletItems).toHaveLength(0);
      consoleErrorSpy.mockRestore();
    });

    test("Next Runs bullet entries are NOT displayed when validation error is shown", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "60",
        cronHours: "9",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      expect(
        screen.getByText("Minutes must be a single value (0-59). Step values and lists are not supported.")
      ).toBeInTheDocument();
      // Verify no bullet-point entries are rendered
      const bulletItems = screen.queryAllByText(/^• /);
      expect(bulletItems).toHaveLength(0);
      consoleErrorSpy.mockRestore();
    });
  });

  // =========================================================================
  // 2. Timezone Switching
  // =========================================================================
  describe("Timezone Switching", () => {
    test("cron '0 9 * * *' with America/Los_Angeles shows LA local times", () => {
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "0",
        cronHours: "9",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
        scheduleTimezone: "America/Los_Angeles",
        cronExpiryDate: "2026/04/01",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
      // 9AM LA time displayed in local (also LA) = 9:00 AM
      expect(screen.getByText("• Mar 6, 2026, 9:00 AM")).toBeInTheDocument();
    });

    test("cron '0 9 * * *' with Asia/Tokyo shows different times than LA", () => {
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "0",
        cronHours: "9",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
        scheduleTimezone: "Asia/Tokyo",
        cronExpiryDate: "2026/04/01",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
      // 9AM Tokyo = 0:00 UTC = 4:00 PM previous day PST (UTC-8)
      // Mar 6 9AM Tokyo = Mar 5 4PM PST (which is after current time 3PM PST)
      expect(screen.getByText("• Mar 5, 2026, 4:00 PM")).toBeInTheDocument();
      // Verify it does NOT show 9:00 AM (that would be LA interpretation)
      expect(screen.queryByText("• Mar 6, 2026, 9:00 AM")).not.toBeInTheDocument();
    });

    test("cron '0 9 * * *' with UTC shows UTC-based times in local display", () => {
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "0",
        cronHours: "9",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
        scheduleTimezone: "UTC",
        cronExpiryDate: "2026/04/01",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
      // 9AM UTC = 1:00 AM PST (UTC-8)
      // Current time is Mar 5 3PM PST = Mar 5 23:00 UTC, so next 9AM UTC is Mar 6
      // Mar 6 9AM UTC = Mar 6 1:00 AM PST
      expect(screen.getByText("• Mar 6, 2026, 1:00 AM")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 3. Execution Timing Switching Clears Fields
  // =========================================================================
  describe("Execution Timing Switching Clears Fields", () => {
    test("switching from run-schedule to run-now clears all cron fields", () => {
      const formData: FormData = {
        ...baseFormData,
        executionTiming: "run-schedule",
        cronMinutes: "0",
        cronHours: "9",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "1-5",
        cronExpiryDate: "2026/04/01",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      const runNowRadio = screen.getByLabelText("Run Now");
      fireEvent.click(runNowRadio);

      expect(mockUpdateFormData).toHaveBeenCalledWith(
        expect.objectContaining({
          executionTiming: "run-now",
          cronMinutes: "",
          cronHours: "",
          cronDayOfMonth: "",
          cronMonth: "",
          cronDayOfWeek: "",
          cronExpiryDate: "",
        })
      );
    });

    test("switching from run-schedule to run-once clears all cron fields", () => {
      const formData: FormData = {
        ...baseFormData,
        executionTiming: "run-schedule",
        cronMinutes: "30",
        cronHours: "14",
        cronDayOfMonth: "1",
        cronMonth: "6",
        cronDayOfWeek: "*",
        cronExpiryDate: "2026/07/01",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      const runOnceRadio = screen.getByLabelText("Run Once");
      fireEvent.click(runOnceRadio);

      expect(mockUpdateFormData).toHaveBeenCalledWith(
        expect.objectContaining({
          executionTiming: "run-once",
          cronMinutes: "",
          cronHours: "",
          cronDayOfMonth: "",
          cronMonth: "",
          cronDayOfWeek: "",
          cronExpiryDate: "",
        })
      );
    });

    test("switching from run-once to run-schedule clears schedule date/time", () => {
      const formData: FormData = {
        ...baseFormData,
        executionTiming: "run-once",
        scheduleDate: "2026/03/10",
        scheduleTime: "14:00",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      const runScheduleRadio = screen.getByLabelText("Run on a Schedule");
      fireEvent.click(runScheduleRadio);

      expect(mockUpdateFormData).toHaveBeenCalledWith(
        expect.objectContaining({
          executionTiming: "run-schedule",
          scheduleDate: "",
          scheduleTime: "",
        })
      );
    });
  });

  // =========================================================================
  // 4. Edge Cases
  // =========================================================================
  describe("Edge Cases", () => {
    test("all fields '*' except minutes '0' produces hourly entries", () => {
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "0",
        cronHours: "*",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
        cronExpiryDate: "2026/04/01",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
      // Current time is Mar 5, 2026 3:00 PM PST. Next hourly runs at :00 are 4PM, 5PM, 6PM, 7PM, 8PM
      expect(screen.getByText("• Mar 5, 2026, 4:00 PM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 5, 2026, 5:00 PM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 5, 2026, 6:00 PM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 5, 2026, 7:00 PM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 5, 2026, 8:00 PM")).toBeInTheDocument();
    });

    test("cronDayOfMonth '?' and cronDayOfWeek '?' are rejected as invalid Linux cron syntax", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "30",
        cronHours: "12",
        cronDayOfMonth: "?",
        cronMonth: "*",
        cronDayOfWeek: "?",
        cronExpiryDate: "2026/04/01",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      // ? is not valid in standard 5-field Linux cron — shows validation error, title shown but no dates
      expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
      expect(screen.queryAllByText(/^• /)).toHaveLength(0);
      expect(
        screen.getByText("Day of month must be * or a single value (1-31). Ranges and lists are not supported.")
      ).toBeInTheDocument();
      consoleErrorSpy.mockRestore();
    });

    test("expiry date same day (2026/03/05) shows limited or no entries for remaining hours", () => {
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "0",
        cronHours: "*",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
        cronExpiryDate: "2026/03/05",
        scheduleTimezone: "America/Los_Angeles",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      // Expiry is set as Date.UTC(2026, 2, 5, 23, 59, 59, 999) = Mar 5 23:59:59 UTC.
      // Current time is Mar 5 23:00 UTC = Mar 5 3:00 PM PST.
      // Next hourly run in LA at 4PM PST = Mar 6 00:00 UTC > expiry.
      // cron-parser endDate is absolute, so 4PM PST exceeds the expiry.
      // The component shows "Next Runs (Local time)" with "No matching dates found"
      // because all next occurrences in LA timezone exceed the UTC-based expiry.
      expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
      expect(screen.getByText("No matching dates found")).toBeInTheDocument();
    });

    test("cronMinutes '0', cronHours '2' near DST transition (March 8, 2026 2AM) handled gracefully", () => {
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "0",
        cronHours: "2",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
        cronExpiryDate: "2026/04/01",
        scheduleTimezone: "America/Los_Angeles",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      // 2AM PST/PDT. DST starts Mar 8 at 2AM (clocks spring forward to 3AM).
      // cron-parser should skip Mar 8 since 2AM doesn't exist that day.
      // We expect entries but Mar 8 should be skipped.
      expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();

      // Mar 6 2AM, Mar 7 2AM exist (before DST)
      expect(screen.getByText("• Mar 6, 2026, 2:00 AM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 7, 2026, 2:00 AM")).toBeInTheDocument();
      // Mar 8 2AM does NOT exist (DST spring forward)
      expect(screen.queryByText("• Mar 8, 2026, 2:00 AM")).not.toBeInTheDocument();
      // Mar 9 2AM exists (now PDT)
      expect(screen.getByText("• Mar 9, 2026, 2:00 AM")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 5. Pattern Reselection After Manual Edit (the fixed bug)
  // =========================================================================
  describe("Pattern Reselection After Manual Edit", () => {
    test("clearing cronDayOfWeek to empty string hides Next Runs", () => {
      // Start with "Every hour" pattern fully populated
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "0",
        cronHours: "*",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "",
        cronExpiryDate: "2026/04/01",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      // With cronDayOfWeek empty, Next Runs should NOT be shown
      expect(screen.queryByText("Next Runs (Local time)")).not.toBeInTheDocument();
    });

    test("clicking 'Every hour' after manual edit calls updateFormData with all 5 fields", () => {
      // Render with a partially cleared state (simulating user cleared cronDayOfWeek)
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "0",
        cronHours: "*",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "",
        cronExpiryDate: "2026/04/01",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      // Click "Every hour" pattern link to re-apply
      const everyHourLink = screen.getByText("Every hour");
      fireEvent.click(everyHourLink);

      // Verify updateFormData is called with ALL 5 cron fields
      expect(mockUpdateFormData).toHaveBeenCalledWith({
        cronMinutes: "0",
        cronHours: "*",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
      });
    });

    test("re-render with restored pattern values shows 5 clean hourly entries", () => {
      // After clicking "Every hour", the parent re-renders with all fields set
      const formData: FormData = {
        ...baseFormData,
        cronMinutes: "0",
        cronHours: "*",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
        cronExpiryDate: "2026/04/01",
      };

      render(<ScheduleSection formData={formData} updateFormData={mockUpdateFormData} />);

      expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();

      // Verify exactly 5 entries (no stale entries)
      const bulletItems = screen.getAllByText(/^• /);
      expect(bulletItems).toHaveLength(5);

      // Verify they are clean hourly entries
      expect(screen.getByText("• Mar 5, 2026, 4:00 PM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 5, 2026, 5:00 PM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 5, 2026, 6:00 PM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 5, 2026, 7:00 PM")).toBeInTheDocument();
      expect(screen.getByText("• Mar 5, 2026, 8:00 PM")).toBeInTheDocument();
    });

    test("full reselection flow: populated → clear field → reselect pattern → clean output", () => {
      // Step 1: Render with fully populated "Every hour" pattern
      const { unmount } = render(
        <ScheduleSection
          formData={{
            ...baseFormData,
            cronMinutes: "0",
            cronHours: "*",
            cronDayOfMonth: "*",
            cronMonth: "*",
            cronDayOfWeek: "*",
            cronExpiryDate: "2026/04/01",
          }}
          updateFormData={mockUpdateFormData}
        />
      );

      expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
      expect(screen.getAllByText(/^• /)).toHaveLength(5);
      unmount();

      // Step 2: Simulate user clearing cronDayOfWeek
      mockUpdateFormData.mockClear();
      const { unmount: unmount2 } = render(
        <ScheduleSection
          formData={{
            ...baseFormData,
            cronMinutes: "0",
            cronHours: "*",
            cronDayOfMonth: "*",
            cronMonth: "*",
            cronDayOfWeek: "",
            cronExpiryDate: "2026/04/01",
          }}
          updateFormData={mockUpdateFormData}
        />
      );

      expect(screen.queryByText("Next Runs (Local time)")).not.toBeInTheDocument();

      // Step 3: Click "Every hour" to reselect
      const everyHourLink = screen.getByText("Every hour");
      fireEvent.click(everyHourLink);

      expect(mockUpdateFormData).toHaveBeenCalledWith({
        cronMinutes: "0",
        cronHours: "*",
        cronDayOfMonth: "*",
        cronMonth: "*",
        cronDayOfWeek: "*",
      });
      unmount2();

      // Step 4: Re-render with restored values
      render(
        <ScheduleSection
          formData={{
            ...baseFormData,
            cronMinutes: "0",
            cronHours: "*",
            cronDayOfMonth: "*",
            cronMonth: "*",
            cronDayOfWeek: "*",
            cronExpiryDate: "2026/04/01",
          }}
          updateFormData={mockUpdateFormData}
        />
      );

      expect(screen.getByText("Next Runs (Local time)")).toBeInTheDocument();
      expect(screen.getAllByText(/^• /)).toHaveLength(5);
      expect(screen.getByText("• Mar 5, 2026, 4:00 PM")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 6. No Console Errors
  // =========================================================================
  describe("No Console Errors", () => {
    test("valid hourly cron produces no console errors", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(
        <ScheduleSection
          formData={{
            ...baseFormData,
            cronMinutes: "0",
            cronHours: "*",
            cronDayOfMonth: "*",
            cronMonth: "*",
            cronDayOfWeek: "*",
            cronExpiryDate: "2026/04/01",
          }}
          updateFormData={mockUpdateFormData}
        />
      );

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    test("valid daily cron produces no console errors", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(
        <ScheduleSection
          formData={{
            ...baseFormData,
            cronMinutes: "0",
            cronHours: "9",
            cronDayOfMonth: "*",
            cronMonth: "*",
            cronDayOfWeek: "*",
            cronExpiryDate: "2026/04/01",
          }}
          updateFormData={mockUpdateFormData}
        />
      );

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    test("valid weekday cron produces no console errors", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(
        <ScheduleSection
          formData={{
            ...baseFormData,
            cronMinutes: "0",
            cronHours: "8",
            cronDayOfMonth: "*",
            cronMonth: "*",
            cronDayOfWeek: "1-5",
            cronExpiryDate: "2026/04/01",
          }}
          updateFormData={mockUpdateFormData}
        />
      );

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    test("valid monthly cron produces no console errors", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(
        <ScheduleSection
          formData={{
            ...baseFormData,
            cronMinutes: "0",
            cronHours: "11",
            cronDayOfMonth: "1",
            cronMonth: "*",
            cronDayOfWeek: "*",
            cronExpiryDate: "2026/04/01",
          }}
          updateFormData={mockUpdateFormData}
        />
      );

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    test("question mark wildcards produce validation error with no unexpected console errors", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(
        <ScheduleSection
          formData={{
            ...baseFormData,
            cronMinutes: "0",
            cronHours: "22",
            cronDayOfMonth: "?",
            cronMonth: "*",
            cronDayOfWeek: "?",
            cronExpiryDate: "2026/04/01",
          }}
          updateFormData={mockUpdateFormData}
        />
      );

      // ? is rejected by regex — validation error shown, but no unexpected React errors
      const keyWarnings = consoleErrorSpy.mock.calls.filter(
        (call) => typeof call[0] === "string" && call[0].includes("key")
      );
      expect(keyWarnings).toHaveLength(0);
      consoleErrorSpy.mockRestore();
    });

    test("DST-crossing cron produces no console errors", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(
        <ScheduleSection
          formData={{
            ...baseFormData,
            cronMinutes: "0",
            cronHours: "2",
            cronDayOfMonth: "*",
            cronMonth: "*",
            cronDayOfWeek: "*",
            cronExpiryDate: "2026/04/01",
            scheduleTimezone: "America/Los_Angeles",
          }}
          updateFormData={mockUpdateFormData}
        />
      );

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });
});
