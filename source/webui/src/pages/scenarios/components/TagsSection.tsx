// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Component for managing test scenario tags

import {
  Box,
  Button,
  Container,
  FormField,
  Header,
  Input,
  SpaceBetween,
  TokenGroup,
} from "@cloudscape-design/components";
import { FormData } from "../types";

interface Props {
  formData: FormData;
  newTag: string;
  setNewTag: (tag: string) => void;
  tagError: string;
  setTagError: (error: string) => void;
  addTag: () => void;
  removeTag: (index: number) => void;
}

export const TagsSection = ({ formData, newTag, setNewTag, tagError, setTagError, addTag, removeTag }: Props) => {
  const canAddTag = newTag.trim() && formData.tags.length < 5;

  return (
    <Container header={<Header variant="h2">Tags </Header>}>
      <SpaceBetween direction="vertical" size="s">
        <Box variant="small">
          Tags are labels you assign to test scenarios that allow you to manage, identify, organize, search for, and
          filter Distributed Load Testing scenarios.
        </Box>

        <TokenGroup items={formData.tags} onDismiss={({ detail }) => removeTag(detail.itemIndex)} />

        <FormField errorText={tagError} constraintText={`${newTag.length}/50 characters`}>
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
        </FormField>

        <Box variant="small">
          You can add {5 - formData.tags.length} more {5 - formData.tags.length === 1 ? "tag" : "tags"}.
        </Box>
      </SpaceBetween>
    </Container>
  );
};
