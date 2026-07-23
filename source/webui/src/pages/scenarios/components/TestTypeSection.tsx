// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Test type selection and the framework-specific security alerts.
// Extracted from the former ScenarioConfigurationStep for the single-page form.

import { Alert, Box, ColumnLayout, ExpandableSection, FormField, Link, RadioGroup, SpaceBetween } from "@cloudscape-design/components";
import jmeter from "../../../../../../jmeter.json";
import k6 from "../../../../../../k6.json";
import locust from "../../../../../../locust.json";
import { TestTypeLabels, TestTypes } from "../constants";
import { FormData } from "../types";
import { FormSection } from "./FormSection";
import { SECTION_IDS } from "../utils/scenarioValidation";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  onTestTypeChange?: () => void;
}

export const TestTypeSection = ({ formData, updateFormData, onTestTypeChange }: Props) => (
  <FormSection sectionId={SECTION_IDS.TEST_TYPE} headerText="Test Type">
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

      <FormField>
        <RadioGroup
          onChange={({ detail }) => {
            updateFormData({
              testType: detail.value as TestTypes,
              scriptFile: [],
              fileError: "",
              k6LicenseAcknowledged: false,
            });
            onTestTypeChange?.();
          }}
          value={formData.testType}
          items={TestTypeLabels}
        />
      </FormField>

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

                <div>This ensures consistent, predictable test execution with plugins from your trusted sources.</div>
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
    </SpaceBetween>
  </FormSection>
);
