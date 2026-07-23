// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Cron field validation rules matching the API-side regex in api-services/lib/validation/schemas.ts.
 * and the validation utility in webui/src/utils/cronValidation.ts.
 * Supported:
 *  minute - single value (0-59)
 *  hour - 0-23 with ranges ('-'), step values ('/N'), and comma (',') lists
 *  day-of-month - 1-31 with ranges ('-'), step values ('/N'), "any" wildcard ('?'),
 *                "last day" wildcard ('L'), and comma (',') lists
 *  month - 1-12 or JAN-DEC with ranges ('-'), step values ('/N'), and comma (',') lists
 *  day-of-week - 0-6 or SUN-SAT with ranges ('-'), instance specifier ('#N'), "any" wildcard ('?'),
 *                "last day" wildcard ('L'), and comma (',') lists
 */

import type { CronExpressionOptions } from "cron-parser";
import { CronExpressionParser, CronExpression } from "cron-parser";
import { parseExpiryDate } from "./date-utils.ts"

const MINUTE_REGEX = /^[0-5]?\d$/;
const HOUR_REGEX = /^(\*|\*\/\d+|([01]?\d|2[0-3])(-([01]?\d|2[0-3]))?(\/\d+)?)(,(\*|\*\/\d+|([01]?\d|2[0-3])(-([01]?\d|2[0-3]))?(\/\d+)?))*$/; // NOSONAR
const DAYS_OF_MONTH_REGEX = /^(\?|(\*|L|([1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?)(\/\d+)?(,(\*|L|([1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?)(\/\d+)?)*)$/; // NOSONAR
const MONTHS_REGEX = /^((\*|0[1-9]|1[0-2]?|[2-9]|[jJ][aA][nN]|[fF][eE][bB]|[mM][aA][rRyY]|[aA][pP][rR]|[jJ][uU][nNlL]|[aA][uU][gG]|[sS][eE][pP]|[oO][cC][tT]|[nN][oO][vV]|[dD][eE][cC])(-(\*|0[1-9]|1[0-2]?|[2-9]|[jJ][aA][nN]|[fF][eE][bB]|[mM][aA][rRyY]|[aA][pP][rR]|[jJ][uU][nNlL]|[aA][uU][gG]|[sS][eE][pP]|[oO][cC][tT]|[nN][oO][vV]|[dD][eE][cC]))?(\/\d+)?(,((\*|0[1-9]|1[0-2]?|[2-9]|[jJ][aA][nN]|[fF][eE][bB]|[mM][aA][rRyY]|[aA][pP][rR]|[jJ][uU][nNlL]|[aA][uU][gG]|[sS][eE][pP]|[oO][cC][tT]|[nN][oO][vV]|[dD][eE][cC])(-(\*|0[1-9]|1[0-2]?|[2-9]|[jJ][aA][nN]|[fF][eE][bB]|[mM][aA][rRyY]|[aA][pP][rR]|[jJ][uU][nNlL]|[aA][uU][gG]|[sS][eE][pP]|[oO][cC][tT]|[nN][oO][vV]|[dD][eE][cC]))?(\/\d+)?))*)$/; // NOSONAR
const DAYS_OF_WEEK_REGEX = /^(\?|L|(\*|[0-6]|[sS][uU][nN]|[mM][oO][nN]|[tT][uU][eE]|[wW][eE][dD]|[tT][hH][uU]|[fF][rR][iI]|[sS][aA][tT])(#[1-5]|L?(-([0-6]|[sS][uU][nN]|[mM][oO][nN]|[tT][uU][eE]|[wW][eE][dD]|[tT][hH][uU]|[fF][rR][iI]|[sS][aA][tT])L?)?(,(L|(\*|[0-6]|[sS][uU][nN]|[mM][oO][nN]|[tT][uU][eE]|[wW][eE][dD]|[tT][hH][uU]|[fF][rR][iI]|[sS][aA][tT])(L?(-([0-6]|[sS][uU][nN]|[mM][oO][nN]|[tT][uU][eE]|[wW][eE][dD]|[tT][hH][uU]|[fF][rR][iI]|[sS][aA][tT])L?)?)?))*)?)$/; // NOSONAR

/**
 * Formats a cron expression suitable for CronExpressionParser to parse in strict mode.
 * The expression includes six elements: seconds minutes hour day-of-month month day-of-week.
 * Seconds is always '0'.
 * Also may modify day-of-month day-of-week to '*'.
 */
function formatCronValidationExpression(cronExpression: string): string {
  const fields: string[] = cronExpression.trim().split(/\s+/);
  const [ cronMinutes = "", cronHours = "", cronDayOfMonth = "", cronMonth = "", cronDayOfWeek = "" ] = fields;

  // cron-parser supports '*' and '?' wild cards differently from what we
  // do internally. Day-of-month and Day-of-week can't both be defined
  // because it would be ambiguous. Internally, if one is defined, the other
  // must be '?'. Internally, '*' means "all" while '?' means "any". So, '*'
  // is a placeholder for "all" values and '?' accepts "any" as it is
  // unspecified.
  // However, cron-parser considers '?' as explicitly defined and '*' as
  // unspecified. So, we have to make adjustments.
  const dayOfWeek = (cronDayOfMonth !== '*' && cronDayOfWeek === '?') ? '*' : cronDayOfWeek;
  const dayOfMonth = (dayOfWeek !== '*' && cronDayOfMonth === '?') ? '*' : cronDayOfMonth;
  // cron-parser expects 6 fields; the first one is "seconds".
  return `0 ${cronMinutes} ${cronHours} ${dayOfMonth} ${cronMonth} ${dayOfWeek}`;
}

/**
 * Validates cron expression string and returns an error message.
 * Returns empty string if all fields are valid.
 */
export function validateCronExpression(cronExpression: string): string {
  const fields: string[] = cronExpression.trim().split(/\s+/);
  if (fields.length != 5) {
    return "Expected format: 0 * * * *";
  }
  const [ cronMinutes = "", cronHours = "", cronDayOfMonth = "", cronMonth = "", cronDayOfWeek = "" ] = fields;

  // For DLT we need to restrict the expression further than cron-parser.
  // cron-parser allows '?' and 'H' in all fields.
  // We don't support 'H' and we only support '?' in Day-of-the-x fields.
  // We also don't allow a schedule that runs more than once per hour.

  cronExpression = formatCronValidationExpression(cronExpression);
  try {
    CronExpressionParser.parse(cronExpression);
  } catch (error: any) {
    return error.message;
  }

  // We only allow for single value because we don't allow scheduling multiple runs in an hour
  if (!MINUTE_REGEX.test(cronMinutes)) {
    return "Minutes must be a single value (0-59). Step values and lists are not supported.";
  }
  if (!HOUR_REGEX.test(cronHours)) {
    return "Hours must be *, a value (0-23), a step value (*/N or h/N), or a comma-separated list.";
  }
  if (!DAYS_OF_MONTH_REGEX.test(cronDayOfMonth)) {
    return "Day of month must be *, ?, L, a value (1-31), or a range/list (e.g., 1-5, 1,5). Use '/N' to increment by N.";
  }
  if (!MONTHS_REGEX.test(cronMonth)) {
    return "Month must be *, a value (1-12), name prefix (JAN-DEC), or a range/list (e.g., 1-5, 1,5). Use '/N' to increment by N.";
  }
  if (!DAYS_OF_WEEK_REGEX.test(cronDayOfWeek)) {
    return "Day of week must be *, ?, L, a value (0-6), name prefix (SUN-SAT), or a range/list (e.g., 1-5, 0,6).";
  }

  return "";
}

/**
 * Parse the input cron value into a `CronExpression` with expiration in the specified timezone
 */
export function parseCronExpression(cronValue: string, cronExpiryDate: string = "", scheduleTimezone: string = "UTC"): CronExpression {

  // Reformat the cron expression to be parsed by the cron-parser
  const cronExpression = formatCronValidationExpression(cronValue);

  // Use the selected schedule timezone for cron parsing
  const parserOptions: CronExpressionOptions = { tz: scheduleTimezone || "UTC" };

  // Configure expiration for the cron parser
  const expiryDate = parseExpiryDate(cronExpiryDate, scheduleTimezone);
  if (expiryDate) {
    parserOptions.endDate = expiryDate.toJSDate();
  }

  // Parse using cron-parser
  return CronExpressionParser.parse(cronExpression, parserOptions);
}
