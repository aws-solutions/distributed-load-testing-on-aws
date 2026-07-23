// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Ramp-up / hold-for duration configuration. Extracted from the former
// TrafficShapeStep. Errors show on blur or after a submit attempt.

import { Box, FormField, Grid, Input, Select, SpaceBetween } from "@cloudscape-design/components";
import { useState } from "react";
import { VALIDATION_LIMITS } from "../constants";
import { FormData } from "../types";
import { FormSection } from "./FormSection";
import { SECTION_IDS } from "../utils/scenarioValidation";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
}

const UNIT_OPTIONS = [
  { label: "seconds", value: "seconds" },
  { label: "minutes", value: "minutes" },
];

export const TestDurationSection = ({ formData, updateFormData, showValidationErrors = false }: Props) => {
  const [rampUpTouched, setRampUpTouched] = useState(false);
  const [holdForTouched, setHoldForTouched] = useState(false);

  const showRampUp = rampUpTouched || showValidationErrors;
  const showHoldFor = holdForTouched || showValidationErrors;

  const rampUpError =
    showRampUp && !formData.rampUpValue
      ? "Ramp up time is required"
      : formData.rampUpValue && Number(formData.rampUpValue) < VALIDATION_LIMITS.RAMP_UP.MIN
        ? `Ramp up must be ≥${VALIDATION_LIMITS.RAMP_UP.MIN}`
        : undefined;
  const holdForError =
    showHoldFor && !formData.holdForValue
      ? "Hold for time is required"
      : formData.holdForValue && Number(formData.holdForValue) < VALIDATION_LIMITS.HOLD_FOR.MIN
        ? `Hold for must be ≥${VALIDATION_LIMITS.HOLD_FOR.MIN}`
        : undefined;

  return (
    <FormSection
      sectionId={SECTION_IDS.TEST_DURATION}
      headerText="Test Duration"
      headerDescription="Define how long your load test will run"
    >
      <SpaceBetween direction="vertical" size="m">
        <FormField label="Ramp Up" description="The time to reach target concurrency" errorText={rampUpError}>
          <Grid disableGutters gridDefinition={[{ colspan: 3 }, { colspan: 6 }]}>
            <Box padding={"xxs"}>
              <Input
                data-cy="ramp-up-input"
                value={formData.rampUpValue || ""}
                onChange={({ detail }) => updateFormData({ rampUpValue: detail.value })}
                onBlur={() => setRampUpTouched(true)}
                invalid={!!rampUpError}
                type="number"
              />
            </Box>
            <Box padding={"xxs"}>
              <Select
                data-cy="ramp-up-unit-select"
                selectedOption={{ label: formData.rampUpUnit || "minutes", value: formData.rampUpUnit || "minutes" }}
                onChange={({ detail }) => updateFormData({ rampUpUnit: detail.selectedOption.value })}
                options={UNIT_OPTIONS}
              />
            </Box>
          </Grid>
        </FormField>

        <FormField label="Hold For" description="The duration to maintain target load" errorText={holdForError}>
          <Grid disableGutters gridDefinition={[{ colspan: 3 }, { colspan: 6 }]}>
            <Box padding={"xxs"}>
              <Input
                data-cy="hold-for-input"
                value={formData.holdForValue || ""}
                onChange={({ detail }) => updateFormData({ holdForValue: detail.value })}
                onBlur={() => setHoldForTouched(true)}
                invalid={!!holdForError}
                type="number"
              />
            </Box>
            <Box padding={"xxs"}>
              <Select
                data-cy="hold-for-unit-select"
                selectedOption={{ label: formData.holdForUnit || "minutes", value: formData.holdForUnit || "minutes" }}
                onChange={({ detail }) => updateFormData({ holdForUnit: detail.selectedOption.value })}
                options={UNIT_OPTIONS}
              />
            </Box>
          </Grid>
        </FormField>
      </SpaceBetween>
    </FormSection>
  );
};
