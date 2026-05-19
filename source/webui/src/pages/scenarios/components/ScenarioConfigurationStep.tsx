// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Second wizard step for test type selection and configuration

import {
  Alert,
  Box,
  ColumnLayout,
  Container,
  ExpandableSection,
  FormField,
  Header,
  Input,
  Link,
  RadioGroup,
  Select,
  SpaceBetween,
  Textarea,
} from "@cloudscape-design/components";
import jmeter from "../../../../../../jmeter.json";
import k6 from "../../../../../../k6.json";
import locust from "../../../../../../locust.json";
import { isValidJSON } from "../../../utils/jsonValidator";
import { isScriptTestType } from "../../../utils/scenarioUtils";
import { isValidUri } from "../../../utils/uriValidator";
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
  const uriValidation = formData.httpEndpoint ? isValidUri(formData.httpEndpoint) : { isValid: true, errorMessage: "" };

  return (
    <SpaceBetween direction="vertical" size="l">
      <Alert type="info" header="Third-Party Testing Frameworks">
        Distributed Load Testing on AWS bundles three third-party testing frameworks. Under the{" "}
        <Link external href="https://aws.amazon.com/compliance/shared-responsibility-model/">
          AWS shared responsibility model
        </Link>
        , you are responsible for evaluating whether these frameworks and their bundled versions meet your
        organization&apos;s security requirements before running load tests. The solution distributes each framework
        without modification and verifies the bundled binaries using checksums at build time and runtime. See the{" "}
        <Link
          external
          href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/solution-overview.html"
        >
          Implementation Guide
        </Link>{" "}
        for more details.
      </Alert>

      <Container header={<Header variant="h2">Test Type</Header>}>
        <SpaceBetween direction="vertical" size="s">
          <FormField>
            <RadioGroup
              onChange={({ detail }) => {
                updateFormData({ testType: detail.value as TestTypes, scriptFile: [], fileError: "", k6LicenseAcknowledged: false });
                onTestTypeChange?.();
              }}
              value={formData.testType}
              items={TestTypeLabels}
            />
          </FormField>
        </SpaceBetween>
      </Container>

      {formData.testType === TestTypes.JMETER &&
        (() => {
          const plugins = Object.entries(jmeter.plugins);
          const midpoint = Math.ceil(plugins.length / 2);
          const leftColumn = plugins.slice(0, midpoint);
          const rightColumn = plugins.slice(midpoint);

          return (
            <Alert type="info" header={`Apache JMeter ${jmeter.version}`}>
              <SpaceBetween direction="vertical" size="s">
                <div>
                  This version has known security vulnerabilities that cannot be fully patched externally due to
                  compatibility constraints with the testing framework. You can supply a patched JMeter binary by
                  including it in your test archive, or review known issues on the{" "}
                  <Link external href="https://jmeter.apache.org/security.html">
                    Apache JMeter security page
                  </Link>
                  .
                </div>

                <ExpandableSection headerText={`Pre-installed Plugins (${plugins.length} available)`} variant="footer">
                  <Box padding={{ top: "s" }}>
                    <ColumnLayout columns={2} variant="text-grid">
                      <div>
                        {leftColumn.map(([name, version]) => (
                          <div key={name}>
                            • {name}{" "}
                            <Box variant="small" display="inline" color="text-body-secondary">
                              v{version}
                            </Box>
                          </div>
                        ))}
                      </div>
                      <div>
                        {rightColumn.map(([name, version]) => (
                          <div key={name}>
                            • {name}{" "}
                            <Box variant="small" display="inline" color="text-body-secondary">
                              v{version}
                            </Box>
                          </div>
                        ))}
                      </div>
                    </ColumnLayout>
                  </Box>
                </ExpandableSection>

                <div>
                  <strong>Need additional plugins?</strong> Include them in a{" "}
                  <Box variant="code" display="inline">
                    plugins/
                  </Box>{" "}
                  subdirectory of your uploaded test zip file:
                </div>

                <Box padding={{ left: "m", top: "xs", bottom: "xs" }}>
                  <Box variant="pre">
                    {`my-test.zip/
├── my-test.jmx          # Your test plan
├── test-data.csv        # Optional data files
└── plugins/             # Custom plugins directory
    ├── my-sampler.jar   # Plugin JAR files
    └── my-library.jar`}
                  </Box>
                </Box>

                <div>
                  This ensures consistent, predictable test execution with plugins from your trusted sources.
                </div>
              </SpaceBetween>
            </Alert>
          );
        })()}

      {formData.testType === TestTypes.SIMPLE && (
        <Alert type="info" header={`Apache JMeter ${jmeter.version}`}>
          This test uses Apache JMeter {jmeter.version} to execute your request. This version has known security
          vulnerabilities that cannot be fully patched externally due to compatibility constraints with the testing
          framework. Review known issues on the{" "}
          <Link external href="https://jmeter.apache.org/security.html">
            Apache JMeter security page
          </Link>
          .
        </Alert>
      )}

      {formData.testType === TestTypes.K6 && (
        <Alert type="info" header={`K6 ${k6.version}`}>
          No known security vulnerabilities have been identified in this version at the time of release. DLT does not
          guarantee ongoing vulnerability monitoring of this third-party component. Review the{" "}
          <Link external href="https://github.com/grafana/k6/security/policy">
            K6 security policy
          </Link>{" "}
          for reporting and disclosure information.
        </Alert>
      )}

      {formData.testType === TestTypes.LOCUST && (
        <Alert type="info" header={`Locust ${locust.version}`}>
          No known security vulnerabilities have been identified in this version at the time of release. DLT does not
          guarantee ongoing vulnerability monitoring of this third-party component. Review the{" "}
          <Link external href="https://github.com/locustio/locust/security">
            Locust security page
          </Link>{" "}
          for advisories and reporting information.
        </Alert>
      )}

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
              errorText={
                showValidationErrors && !formData.httpEndpoint
                  ? "HTTP endpoint is required"
                  : formData.httpEndpoint && !uriValidation.isValid
                    ? uriValidation.errorMessage
                    : undefined
              }
            >
              <Input
                data-cy="http-endpoint-input"
                value={formData.httpEndpoint}
                onChange={({ detail }) => updateFormData({ httpEndpoint: detail.value })}
                placeholder="http://www.example.com"
                invalid={
                  (showValidationErrors && !formData.httpEndpoint) ||
                  (!!formData.httpEndpoint && !uriValidation.isValid)
                }
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
      )}
    </SpaceBetween>
  );
};
