// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Component for test scenario name and description configuration

import { Box, FormField, Input, SpaceBetween, Textarea, TokenGroup, Button } from "@cloudscape-design/components";
import { FormData } from "../types";
import { FormSection } from "./FormSection";
import { SECTION_IDS } from "../utils/scenarioValidation";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
  newTag: string;
  setNewTag: (tag: string) => void;
  tagError: string;
  setTagError: (error: string) => void;
  addTag: () => void;
  removeTag: (index: number) => void;
}

export const TestConfigurationSection = ({ formData, updateFormData, showValidationErrors = false, newTag, setNewTag, tagError, setTagError, addTag, removeTag }: Props) => {
  const canAddTag = newTag.trim() && formData.tags.length < 5;
  return (
    <FormSection sectionId={SECTION_IDS.TEST_CONFIG} headerText="Test Configuration">
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

        {/* Tags */}
        <FormField
          label="Tags"
          description="Tags are labels you assign to test scenarios that allow you to manage, identify, organize, search for, and
          filter Distributed Load Testing scenarios."
          errorText={tagError} constraintText={`${newTag.length}/50 characters`}
        >
          <SpaceBetween direction="vertical" size="s">
              <TokenGroup items={formData.tags} onDismiss={({ detail }) => removeTag(detail.itemIndex)} />
              <SpaceBetween direction="horizontal" size="s" alignItems="end">
                <Input
                  data-cy="tag-input"
                  value={newTag}
                  onChange={({ detail }) => {
                    if (detail.value.length <= 50) {
                      setNewTag(detail.value);
                      setTagError("");
                    }
                  }}
                  onKeyDown={({ detail }) => {
                    if (detail.key === "Enter" && canAddTag) {
                      addTag();
                    }
                  }}
                  placeholder="Enter tag name"
                  invalid={!!tagError}
                />
                <Button data-cy="add-tag-btn" onClick={addTag} disabled={!canAddTag}>
                  Add
                </Button>
              </SpaceBetween>
          </SpaceBetween>
        </FormField>

        <Box variant="small">
          You can add {5 - formData.tags.length} more {5 - formData.tags.length === 1 ? "tag" : "tags"}.
        </Box>
      </SpaceBetween>
    </FormSection>
  );
};
