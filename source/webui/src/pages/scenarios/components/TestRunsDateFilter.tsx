// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useCallback } from "react";
import { DateRangePicker } from "@cloudscape-design/components";

const RELATIVE_DATE_OPTIONS = [
  { key: "last-3-days", amount: 3, unit: "day" as const, type: "relative" as const },
  { key: "last-7-days", amount: 7, unit: "day" as const, type: "relative" as const },
  { key: "last-2-weeks", amount: 14, unit: "day" as const, type: "relative" as const },
  { key: "last-month", amount: 30, unit: "day" as const, type: "relative" as const },
];

const DATE_PICKER_I18N = {
  relativeRangeSelectionHeading: "Choose a range",
  clearButtonLabel: "Clear and dismiss",
  cancelButtonLabel: "Cancel",
  applyButtonLabel: "Apply",
  customRelativeRangeOptionLabel: "Custom range",
  customRelativeRangeOptionDescription: "Set a custom range in the past",
  customRelativeRangeDurationLabel: "Duration",
  customRelativeRangeUnitLabel: "Unit of time",
};

interface DateFilterProps {
  dateFilter: any;
  onChange: (dateRange: any) => void;
}

const formatRelativeRange = (range: any) => {
  if (!range?.amount || !range.unit) return "Custom range";
  const unit = range.amount === 1 ? range.unit : `${range.unit}s`;
  return `Last ${range.amount} ${unit}`;
};

export const TestRunsDateFilter: React.FC<DateFilterProps> = ({ dateFilter, onChange }) => {
  const handleChange = useCallback(({ detail }: any) => onChange(detail.value), [onChange]);

  return (
    <DateRangePicker
      onChange={handleChange}
      value={dateFilter}
      relativeOptions={RELATIVE_DATE_OPTIONS}
      rangeSelectorMode="relative-only"
      showClearButton
      isValidRange={() => ({ valid: true })}
      placeholder="Filter by date range"
      expandToViewport
      i18nStrings={{
        ...DATE_PICKER_I18N,
        formatRelativeRange,
      }}
    />
  );
};