// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Ramp-up / hold-for duration configuration, presented as a compact table.
// Errors show on blur or after a submit attempt, via the shared schema validators.

import { Box, Input, SegmentedControl, Table, TableProps } from "@cloudscape-design/components";
import { DurationUnit, FormData } from "../types";
import { FormSection } from "./FormSection";
import { useFieldReveal } from "../hooks/useFieldReveal";
import { DURATION_UNIT_OPTIONS, isDurationUnit, toSeconds } from "../utils/duration";
import { holdForError as holdForRule, rampUpError as rampUpRule, SECTION_IDS } from "../utils/scenarioValidation";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
}

interface DurationRow {
  id: string;
  phase: string;
  description: string;
  valueKey: "rampUpValue" | "holdForValue";
  unitKey: "rampUpUnit" | "holdForUnit";
  /** Field key used with useFieldReveal for blur/submit error gating. */
  revealKey: "rampUp" | "holdFor";
}

const ROWS: DurationRow[] = [
  {
    id: "ramp-up",
    phase: "Ramp Up",
    description: "The time to reach target concurrency",
    valueKey: "rampUpValue",
    unitKey: "rampUpUnit",
    revealKey: "rampUp",
  },
  {
    id: "hold-for",
    phase: "Hold For",
    description: "The duration to maintain target load",
    valueKey: "holdForValue",
    unitKey: "holdForUnit",
    revealKey: "holdFor",
  },
];

/** Total estimated duration in seconds across both phases, normalizing mixed units. */
const durationInSeconds = (value: string | undefined, unit: DurationUnit) => {
  const seconds = toSeconds(value || "0", unit);
  return Number.isFinite(seconds) ? seconds : 0;
};

const PhaseCell = ({ row }: { row: DurationRow }) => (
  <Box>
    <Box variant="awsui-key-label">{row.phase}</Box>
    <Box variant="small" color="text-body-secondary">
      {row.description}
    </Box>
  </Box>
);

const DurationCell = ({
  row,
  value,
  error,
  onChange,
  onBlur,
}: {
  row: DurationRow;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) => (
  <div>
    <Input
      data-cy={`${row.id}-input`}
      value={value}
      onChange={({ detail }) => onChange(detail.value)}
      onBlur={onBlur}
      invalid={!!error}
      type="number"
      placeholder="0"
    />
    {error && (
      <Box color="text-status-error" variant="small" padding={{ top: "xxs" }}>
        {error}
      </Box>
    )}
  </div>
);

const UnitCell = ({
  row,
  current,
  onSelect,
}: {
  row: DurationRow;
  current: DurationUnit;
  onSelect: (unit: DurationUnit) => void;
}) => (
  <SegmentedControl
    label={`${row.phase} duration unit`}
    selectedId={current}
    onChange={({ detail }) => {
      if (isDurationUnit(detail.selectedId)) onSelect(detail.selectedId);
    }}
    options={DURATION_UNIT_OPTIONS}
  />
);

/**
 * Build the table column definitions at module scope so the per-cell renderers
 * are not redefined on every render of TestDurationSection. Row data and the
 * form callbacks are passed in as arguments.
 */
const getColumnDefinitions = (
  formData: FormData,
  updateFormData: Props["updateFormData"],
  getError: (row: DurationRow) => string | undefined,
  onBlur: (row: DurationRow) => void
): TableProps.ColumnDefinition<DurationRow>[] => [
  {
    id: "phase",
    header: "Phase",
    cell: (row) => <PhaseCell row={row} />,
    width: 280,
  },
  {
    id: "duration",
    header: "Duration",
    cell: (row) => (
      <DurationCell
        row={row}
        value={formData[row.valueKey] || ""}
        error={getError(row)}
        onChange={(value) => updateFormData({ [row.valueKey]: value })}
        onBlur={() => onBlur(row)}
      />
    ),
    width: 220,
  },
  {
    id: "unit",
    header: "Unit",
    // No fixed width: the Unit column takes the remaining space so the
    // segmented control has room for all three unit labels.
    cell: (row) => (
      <UnitCell
        row={row}
        current={formData[row.unitKey]}
        onSelect={(unit) => updateFormData({ [row.unitKey]: unit })}
      />
    ),
  },
];

export const TestDurationSection = ({ formData, updateFormData, showValidationErrors = false }: Props) => {
  const { markTouched, isRevealed } = useFieldReveal(showValidationErrors);

  // The shared schema validators own the rules, messages, and reveal gating.
  const getError = (row: DurationRow): string | undefined =>
    row.valueKey === "rampUpValue"
      ? rampUpRule(formData.rampUpValue, formData.rampUpUnit, isRevealed("rampUp"))
      : holdForRule(formData.holdForValue, formData.holdForUnit, isRevealed("holdFor"));

  const totalSeconds =
    durationInSeconds(formData.rampUpValue, formData.rampUpUnit) +
    durationInSeconds(formData.holdForValue, formData.holdForUnit);

  // This only formats the total shown in the UI; each API value still uses one unit.
  const formatTotal = () => {
    if (totalSeconds === 0) return "—";
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours > 0 && `${hours}h`, minutes > 0 && `${minutes}m`, seconds > 0 && `${seconds}s`]
      .filter(Boolean)
      .join(" ");
  };

  const columnDefinitions = getColumnDefinitions(formData, updateFormData, getError, (row) =>
    markTouched(row.revealKey)
  );

  return (
    <FormSection
      sectionId={SECTION_IDS.TEST_DURATION}
      headerText="Test Duration"
      headerDescription="Define how long your load test will run"
    >
      <Table
        variant="embedded"
        items={ROWS}
        columnDefinitions={columnDefinitions}
        footer={
          <Box textAlign="right">
            <Box variant="awsui-key-label" display="inline">
              Total estimated duration:{" "}
            </Box>
            <Box display="inline">{formatTotal()}</Box>
          </Box>
        }
      />
    </FormSection>
  );
};
