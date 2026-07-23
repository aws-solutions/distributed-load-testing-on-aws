// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// HTTP endpoint configuration (simple test type). Extracted from the former
// ScenarioConfigurationStep. On-blur validation: the endpoint error appears once
// the field is touched or a submit has been attempted (showValidationErrors).

import { Container, FormField, Header, Input, Select, SpaceBetween, Textarea } from "@cloudscape-design/components";
import { useState } from "react";
import { isValidJSON } from "../../../utils/jsonValidator";
import { isValidUri } from "../../../utils/uriValidator";
import { HttpMethodOptions } from "../constants";
import { FormData } from "../types";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
}

export const HttpEndpointSection = ({ formData, updateFormData, showValidationErrors = false }: Props) => {
  const [endpointTouched, setEndpointTouched] = useState(false);
  const isHeadersValid = isValidJSON(formData.requestHeaders || "");
  const isBodyValid = isValidJSON(formData.bodyPayload || "");
  const uriValidation = formData.httpEndpoint ? isValidUri(formData.httpEndpoint) : { isValid: true, errorMessage: "" };

  const showEndpointError = endpointTouched || showValidationErrors;
  const endpointMissing = showEndpointError && !formData.httpEndpoint?.trim();
  const endpointInvalid = !!formData.httpEndpoint && !uriValidation.isValid;

  return (
    // Plain Container (not a collapsible FormSection) because the HTTP/Upload
    // pair is swapped in-place by the page based on test type; the page owns the
    // section-level data-section-id wrapper for scroll-to-error.
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
          errorText={
            endpointMissing
              ? "HTTP endpoint is required"
              : endpointInvalid
                ? uriValidation.errorMessage
                : undefined
          }
        >
          <Input
            data-cy="http-endpoint-input"
            value={formData.httpEndpoint}
            onChange={({ detail }) => updateFormData({ httpEndpoint: detail.value })}
            onBlur={() => setEndpointTouched(true)}
            placeholder="http://www.example.com"
            invalid={endpointMissing || endpointInvalid}
          />
        </FormField>

        <FormField label="HTTP Method" description="The HTTP method to use for requests">
          <Select
            data-cy="http-method-select"
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
            data-cy="request-headers-input"
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
            data-cy="body-payload-input"
            value={formData.bodyPayload}
            onChange={({ detail }) => updateFormData({ bodyPayload: detail.value })}
            rows={10}
            invalid={!isBodyValid}
          />
        </FormField>
      </SpaceBetween>
    </Container>
  );
};
