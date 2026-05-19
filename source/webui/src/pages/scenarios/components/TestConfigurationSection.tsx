// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Component for test scenario name and description configuration

import { Box, Container, FormField, Header, Input, SpaceBetween, Textarea } from "@cloudscape-design/components";
import { FormData } from "../types";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
}

export const TestConfigurationSection = ({ formData, updateFormData, showValidationErrors = false }: Props) => (
  <Container header={<Header variant="h2">Test Configuration</Header>}>
    <SpaceBetween direction="vertical" size="m">
      <FormField
        label="Name"
        description="The name of your load test which makes it easy to identify"
        constraintText={`${(formData.testName || "").length}/200 characters`}
        errorText={showValidationErrors && !formData.testName?.trim() ? "Name is required" : ""}
      >
        <Input
          data-cy="test-name-input"
          value={formData.testName}
          onChange={({ detail }) => {
            if (detail.value.length <= 200) {
              updateFormData({ testName: detail.value });
            }
          }}
          invalid={showValidationErrors && !formData.testName?.trim()}
        />
      </FormField>

      <FormField
        label="Description"
        description="Short description of the load test"
        constraintText={`${(formData.testDescription || "").length}/1000 characters`}
        errorText={showValidationErrors && !formData.testDescription?.trim() ? "Description is required" : ""}
      >
        <Textarea
          data-cy="test-description-input"
          value={formData.testDescription}
          onChange={({ detail }) => {
            if (detail.value.length <= 1000) {
              updateFormData({ testDescription: detail.value });
            }
          }}
          rows={4}
          invalid={showValidationErrors && !formData.testDescription?.trim()}
        />
      </FormField>

      <FormField
        label="Healthy threshold (%)"
        description="Minimum percentage of ECS tasks that must remain healthy across all regions. If failures cause the healthy percentage to drop below this value, the test is automatically marked as failed."
        constraintText="Integer between 0 and 100. Default: 90"
        errorText={
          showValidationErrors &&
          (isNaN(Number(formData.healthyThreshold)) ||
            Number(formData.healthyThreshold) < 0 ||
            Number(formData.healthyThreshold) > 100 ||
            !Number.isInteger(Number(formData.healthyThreshold)))
            ? "Must be an integer between 0 and 100"
            : ""
        }
      >
        <Box margin={{ top: "xxs" }}>
          <Input
            data-cy="healthy-threshold-input"
            type="number"
            value={formData.healthyThreshold}
            onChange={({ detail }) => {
              updateFormData({ healthyThreshold: detail.value });
            }}
            inputMode="numeric"
            invalid={
              showValidationErrors &&
              (isNaN(Number(formData.healthyThreshold)) ||
                Number(formData.healthyThreshold) < 0 ||
                Number(formData.healthyThreshold) > 100 ||
                !Number.isInteger(Number(formData.healthyThreshold)))
            }
          />
        </Box>
      </FormField>
    </SpaceBetween>
  </Container>
);
