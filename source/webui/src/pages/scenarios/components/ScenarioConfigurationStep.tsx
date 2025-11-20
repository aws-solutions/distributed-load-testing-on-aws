// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Second wizard step for test type selection and configuration

import {
  Container,
  FormField,
  Header,
  Input,
  RadioGroup,
  Select,
  SpaceBetween,
  Textarea,
} from "@cloudscape-design/components";
import { isValidJSON } from "../../../utils/jsonValidator";
import { isScriptTestType } from "../../../utils/scenarioUtils";
import { HttpMethodOptions, TestTypeLabels, TestTypes } from "../constants";
import { FormData } from "../types";
import { FileUploadSection } from "./FileUploadSection";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  onTestTypeChange?: () => void;
  showValidationErrors?: boolean;
}

export const ScenarioConfigurationStep = ({
  formData,
  updateFormData,
  onTestTypeChange,
  showValidationErrors = false,
}: Props) => {
  const isHeadersValid = isValidJSON(formData.requestHeaders || "");
  const isBodyValid = isValidJSON(formData.bodyPayload || "");

  return (
    <SpaceBetween direction="vertical" size="l">
      <Container header={<Header variant="h2">Test Type</Header>}>
        <SpaceBetween direction="vertical" size="s">
          <FormField>
            <RadioGroup
              onChange={({ detail }) => {
                updateFormData({ testType: detail.value as TestTypes });
                onTestTypeChange?.();
              }}
              value={formData.testType}
              items={TestTypeLabels}
            />
          </FormField>
        </SpaceBetween>
      </Container>

      {isScriptTestType(formData.testType) ? (
        <FileUploadSection
          formData={formData}
          updateFormData={updateFormData}
          showValidationErrors={showValidationErrors}
        />
      ) : (
        <Container
          header={
            <Header variant="h2" description="Define the endpoint to be tested">
              HTTP Endpoint Configuration
            </Header>
          }
        >
          <SpaceBetween direction="vertical" size="m">
            <FormField
              label="HTTP Endpoint"
              description="The endpoint that will be tested"
              errorText={showValidationErrors && !formData.httpEndpoint ? "HTTP endpoint is required" : undefined}
            >
              <Input
                value={formData.httpEndpoint}
                onChange={({ detail }) => updateFormData({ httpEndpoint: detail.value })}
                placeholder="http://www.example.com"
                invalid={showValidationErrors && !formData.httpEndpoint}
              />
            </FormField>

            <FormField label="HTTP Method" description="The HTTP method to use for requests">
              <Select
                selectedOption={formData.httpMethod}
                onChange={({ detail }) =>
                  updateFormData({ httpMethod: detail.selectedOption as { label: string; value: string } })
                }
                options={HttpMethodOptions}
              />
            </FormField>

            <FormField
              label="Request Header (Optional)"
              info="Add custom headers to your HTTP requests"
              errorText={!isHeadersValid ? "WARNING: headers text is not valid JSON" : undefined}
            >
              <Textarea
                value={formData.requestHeaders}
                onChange={({ detail }) => updateFormData({ requestHeaders: detail.value })}
                rows={10}
                invalid={!isHeadersValid}
              />
            </FormField>

            <FormField
              label="Body Payload (Optional)"
              info="Add custom body to your HTTP requests"
              errorText={!isBodyValid ? "WARNING: body payload text is not valid JSON" : undefined}
            >
              <Textarea
                value={formData.bodyPayload}
                onChange={({ detail }) => updateFormData({ bodyPayload: detail.value })}
                rows={10}
                invalid={!isBodyValid}
              />
            </FormField>
          </SpaceBetween>
        </Container>
      )}
    </SpaceBetween>
  );
};
