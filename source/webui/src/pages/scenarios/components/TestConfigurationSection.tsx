// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Component for test scenario name and description configuration

import { Box, FormField, Input, SpaceBetween, Textarea, TokenGroup, Button } from "@cloudscape-design/components";
import { FormData } from "../types";
import { FormSection } from "./FormSection";
import { useFieldReveal } from "../hooks/useFieldReveal";
import { SECTION_IDS, testDescriptionError, testNameError } from "../utils/scenarioValidation";
import { InfoLink } from "../../../help";

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
  const { markTouched, isRevealed } = useFieldReveal(showValidationErrors);
  // Rules + messages come from the shared field validators; errors reveal once
  // the field is touched or the form was submitted.
  // Validate the displayed name error against the trimmed value: we auto-trim on
  // blur, so the schema's "no leading/trailing whitespace" rule should never
  // surface as an error the user must fix. Length/content errors still reflect
  // the post-trim value (e.g. "  hi  " → "hi" is still too short).
  const nameError = testNameError(formData.testName.trim(), isRevealed("testName"));
  const descriptionError = testDescriptionError(formData.testDescription, isRevealed("testDescription"));
  return (
    <FormSection sectionId={SECTION_IDS.TEST_CONFIG} headerText="Test Configuration">
      <SpaceBetween direction="vertical" size="m">
        <FormField
          label="Name"
          description="The name of your load test which makes it easy to identify"
          constraintText={`${(formData.testName || "").length}/255 characters`}
          errorText={nameError}
        >
          <Input
            data-cy="test-name-input"
            value={formData.testName}
            onChange={({ detail }) => {
              if (detail.value.length <= 255) {
                updateFormData({ testName: detail.value });
              }
            }}
            // Auto-trim surrounding whitespace on blur (not while typing, which would
            // block spaces between words). The schema rejects leading/trailing
            // whitespace, so trimming fixes it for the user instead of erroring.
            onBlur={() => {
              const trimmed = formData.testName.trim();
              if (trimmed !== formData.testName) {
                updateFormData({ testName: trimmed });
              }
              markTouched("testName");
            }}
            invalid={!!nameError}
          />
        </FormField>

        <FormField
          label="Description"
          description="Short description of the load test"
          constraintText={`${(formData.testDescription || "").length}/60000 characters`}
          errorText={descriptionError}
        >
          <Textarea
            data-cy="test-description-input"
            value={formData.testDescription}
            onChange={({ detail }) => {
              if (detail.value.length <= 60000) {
                updateFormData({ testDescription: detail.value });
              }
            }}
            onBlur={() => markTouched("testDescription")}
            rows={4}
            invalid={!!descriptionError}
          />
        </FormField>

        {/* Search keywords — stored as the `tags` field on the scenario */}
        <FormField
          label="Search keywords"
          info={<InfoLink topicId="tags" />}
          description="Keywords you assign to test scenarios that help you quickly filter and find scenarios."
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
                  placeholder="Enter keyword"
                  invalid={!!tagError}
                />
                <Button data-cy="add-tag-btn" onClick={addTag} disabled={!canAddTag}>
                  Add
                </Button>
              </SpaceBetween>
          </SpaceBetween>
        </FormField>

        <Box variant="small">
          You can add {5 - formData.tags.length} more {5 - formData.tags.length === 1 ? "keyword" : "keywords"}.
        </Box>
      </SpaceBetween>
    </FormSection>
  );
};
