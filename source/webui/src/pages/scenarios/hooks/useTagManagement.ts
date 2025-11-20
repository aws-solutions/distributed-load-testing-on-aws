// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Custom hook for managing tag addition and removal logic

import { useState } from "react";
import { FormData } from "../types";

export const useTagManagement = (formData: FormData, updateFormData: (updates: Partial<FormData>) => void) => {
  const [newTag, setNewTag] = useState("");
  const [tagError, setTagError] = useState("");

  const addTag = () => {
    const trimmedTag = newTag.trim();
    const tagExists = formData.tags.some((tag) => tag.label.toLowerCase() === trimmedTag.toLowerCase());

    if (!trimmedTag) {
      setTagError("");
      return;
    }

    if (tagExists) {
      setTagError("This tag already exists.");
      return;
    }

    if (formData.tags.length >= 5) {
      setTagError("Maximum 5 tags allowed.");
      return;
    }

    updateFormData({
      tags: [...formData.tags, { label: trimmedTag, dismissLabel: `Remove ${trimmedTag} tag` }],
    });
    setNewTag("");
    setTagError("");
  };

  const removeTag = (index: number) => {
    updateFormData({
      tags: formData.tags.filter((_, i) => i !== index),
    });
  };

  return { newTag, setNewTag, tagError, setTagError, addTag, removeTag };
};
