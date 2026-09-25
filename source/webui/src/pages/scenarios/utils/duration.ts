// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Shared duration parsing and conversion for scenario form inputs.

import { DurationInput, DurationUnit } from "../types";

export const DURATION_UNIT_OPTIONS: Array<{ text: string; id: DurationUnit }> = [
  { text: "Seconds", id: "seconds" },
  { text: "Minutes", id: "minutes" },
  { text: "Hours", id: "hours" },
];

const SECONDS_PER_UNIT: Record<DurationUnit, number> = { seconds: 1, minutes: 60, hours: 3600 };
const UNIT_SUFFIX: Record<DurationUnit, "s" | "m" | "h"> = { seconds: "s", minutes: "m", hours: "h" };

export const isDurationUnit = (unit: string): unit is DurationUnit =>
  unit === "seconds" || unit === "minutes" || unit === "hours";

export const serializeDuration = (value: string, unit: DurationUnit): string => `${value}${UNIT_SUFFIX[unit]}`;

/** Converts a form value + unit to whole seconds. NaN when the value isn't numeric. */
export const toSeconds = (value: string, unit: DurationUnit): number => Number(value) * SECONDS_PER_UNIT[unit];

/** Converts seconds back to a form value + unit, preferring the largest exact unit. */
export const fromSeconds = (seconds: number): DurationInput => {
  if (seconds > 0 && seconds % 3600 === 0) return { value: String(seconds / 3600), unit: "hours" };
  if (seconds > 0 && seconds % 60 === 0) return { value: String(seconds / 60), unit: "minutes" };
  return { value: String(seconds), unit: "seconds" };
};

/** Parses persisted Standard durations without inventing a value or coercing a unit. */
export const parseStoredDuration = (duration: unknown): DurationInput | undefined => {
  if (typeof duration === "number") {
    return Number.isInteger(duration) && duration >= 0 ? fromSeconds(duration) : undefined;
  }
  if (typeof duration !== "string") return undefined;

  const { value, suffix } = /^(?<value>\d+)(?<suffix>[smh])$/.exec(duration)?.groups ?? {};
  if (!value) return undefined;
  if (suffix === "s") return { value, unit: "seconds" };
  if (suffix === "m") return { value, unit: "minutes" };
  return { value, unit: "hours" };
};

/** True when the string is a positive whole number (rejects "3.5", "", "-1", "1e3"). */
export const isPositiveInteger = (value: string): boolean => /^\d+$/.test(value.trim()) && Number(value) > 0;

/** True when the string is a non-negative whole number, including zero. */
export const isNonNegativeInteger = (value: string): boolean => /^\d+$/.test(value.trim());

/** True when the string is a number greater than 0, fractions included ("0.5"). */
export const isPositiveNumber = (value: string): boolean => {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0;
};
