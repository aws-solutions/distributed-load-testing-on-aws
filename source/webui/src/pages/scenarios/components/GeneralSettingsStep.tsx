// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// First wizard step for test scenario general settings

import { SpaceBetween } from "@cloudscape-design/components";
import { FormData } from "../types";
import { useTagManagement } from "../hooks/useTagManagement";
import { TestConfigurationSection } from "./TestConfigurationSection";
import { TagsSection } from "./TagsSection";
import { ScheduleSection } from "./ScheduleSection";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
}

export const GeneralSettingsStep = ({ formData, updateFormData, showValidationErrors }: Props) => {
  const { newTag, setNewTag, tagError, setTagError, addTag, removeTag } = useTagManagement(formData, updateFormData);

  return (
    <SpaceBetween direction="vertical" size="l">
      <TestConfigurationSection
        formData={formData}
        updateFormData={updateFormData}
        showValidationErrors={showValidationErrors}
      />
      <TagsSection
        formData={formData}
        newTag={newTag}
        setNewTag={setNewTag}
        tagError={tagError}
        setTagError={setTagError}
        addTag={addTag}
        removeTag={removeTag}
      />
      <ScheduleSection formData={formData} updateFormData={updateFormData} showValidationErrors={showValidationErrors} />
    </SpaceBetween>
  );
};
