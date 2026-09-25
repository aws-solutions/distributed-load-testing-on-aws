// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// HTTP endpoint configuration (simple test type). Extracted from the former
// ScenarioConfigurationStep. On-blur validation: the endpoint error appears once
// the field is touched or a submit has been attempted (showValidationErrors).

import { Container, FormField, Header, Input, Select, SpaceBetween, Textarea } from "@cloudscape-design/components";
import { isValidJSON } from "../../../utils/jsonValidator";
import { HttpMethodOptions } from "../constants";
import { useFieldReveal } from "../hooks/useFieldReveal";
import { FormData } from "../types";
import { httpEndpointError } from "../utils/scenarioValidation";
import { InfoLink } from "../../../help";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
}

export const HttpEndpointSection = ({ formData, updateFormData, showValidationErrors = false }: Props) => {
  const { markTouched, isRevealed } = useFieldReveal(showValidationErrors);
  const isHeadersValid = isValidJSON(formData.requestHeaders || "");
  const isBodyValid = isValidJSON(formData.bodyPayload || "");

  // Validation rule from the shared validator;
  // error reveals once the field is touched or a submit is attempted.
  const endpointError = httpEndpointError(formData.httpEndpoint, isRevealed("httpEndpoint"));

  return (
    // Plain Container (not a collapsible FormSection) because the HTTP/Upload
    // pair is swapped in-place by the page based on test type; the page owns the
    // section-level data-section-id wrapper for scroll-to-error.
    <Container
      header={
        <Header variant="h2" description="Define the endpoint to be tested" info={<InfoLink topicId="http-endpoint" />}>
          HTTP Endpoint Configuration
        </Header>
      }
    >
      <SpaceBetween direction="vertical" size="m">
        <FormField
          label="HTTP Endpoint"
          description="The endpoint that will be tested"
          errorText={endpointError}
        >
          <Input
            data-cy="http-endpoint-input"
            value={formData.httpEndpoint}
            onChange={({ detail }) => updateFormData({ httpEndpoint: detail.value })}
            onBlur={() => markTouched("httpEndpoint")}
            placeholder="http://www.example.com"
            invalid={!!endpointError}
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
