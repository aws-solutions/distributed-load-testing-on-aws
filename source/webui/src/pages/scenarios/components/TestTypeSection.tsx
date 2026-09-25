// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Test type + traffic shape selection and the framework-specific security alerts.

import {
  Alert,
  Badge,
  ExpandableSection,
  FormField,
  KeyValuePairs,
  Link,
  SegmentedControl,
  SpaceBetween,
} from "@cloudscape-design/components";
import { useState } from "react";
import jmeter from "../../../../../../jmeter.json";
import k6 from "../../../../../../k6.json";
import locust from "../../../../../../locust.json";
import { InfoLink } from "../../../help";
import { TestMode, TestModeLabels, TestTypeLabels, TestTypes } from "../constants";
import { FormData } from "../types";
import { SECTION_IDS } from "../utils/scenarioValidation";
import { FormSection } from "./FormSection";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  onModeChange: (mode: TestMode) => void;
}

// Persist the user's open/closed choice for the security details section per
// test framework. The section is shown expanded the first time a framework is
// selected (no stored value) so its disclosures are not hidden by default, then
// remembers the user's per-framework preference across reloads. Keying by
// framework means collapsing the banner for one framework does not hide it for
// another, so security messages that differ per framework are not missed.
const SECURITY_DETAILS_STORAGE_KEY = "security-framework-details-expanded";

type SecurityDetailsExpandedMap = Partial<Record<TestTypes, boolean>>;

const readSecurityDetailsExpandedMap = (): SecurityDetailsExpandedMap => {
  try {
    const stored = localStorage.getItem(SECURITY_DETAILS_STORAGE_KEY);
    if (stored === null) return {};
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === "object" ? (parsed as SecurityDetailsExpandedMap) : {};
  } catch {
    return {};
  }
};

const NATIVE_MODE_DESCRIPTION: Record<TestTypes, string> = {
  [TestTypes.SIMPLE]: "Not available for Simple HTTP Endpoint",
  [TestTypes.JMETER]: "DLT runs the JMeter test script as written.",
  [TestTypes.K6]: "DLT runs the k6 test script as written.",
  [TestTypes.LOCUST]: "DLT runs the Locust test script as written.",
};

export const TestTypeSection = ({ formData, updateFormData, onModeChange }: Props) => {
  const [expandedByType, setExpandedByType] = useState<SecurityDetailsExpandedMap>(readSecurityDetailsExpandedMap);
  // Default to expanded when this framework has no stored preference yet.
  const securityDetailsExpanded = expandedByType[formData.testType] ?? true;

  const isSimple = formData.testType === TestTypes.SIMPLE;
  const isNative = formData.testMode === TestMode.NATIVE;

  const handleTypeChange = (newType: TestTypes) => {
    // Switching to HTTP Endpoint while in native mode forces Standard — the two
    // are mutually exclusive because HTTP Endpoint has no user-defined script.
    if (newType === TestTypes.SIMPLE && isNative) {
      onModeChange(TestMode.STANDARD);
    }
    updateFormData({
      testType: newType,
      scriptFile: [],
      fileError: "",
      k6LicenseAcknowledged: false,
    });
  };

  return (
    <FormSection sectionId={SECTION_IDS.TEST_TYPE} headerText="Test Type">
      <SpaceBetween direction="vertical" size="l">
        <FormField>
          <SegmentedControl
            data-cy="test-type-segmented"
            selectedId={formData.testType}
            onChange={({ detail }) => handleTypeChange(detail.selectedId as TestTypes)}
            options={TestTypeLabels.map(({ label, value }) => ({ id: value, text: label }))}
          />
        </FormField>

        <FormField label="Traffic shape" info={<InfoLink topicId="traffic-shape" />}>
          <SpaceBetween direction="vertical" size="xs">
            <SegmentedControl
              data-cy="traffic-shape-segmented"
              selectedId={formData.testMode}
              onChange={({ detail }) => onModeChange(detail.selectedId as TestMode)}
              options={TestModeLabels.map(({ label, value }) => ({
                id: value,
                text: label,
                // Native needs an uploaded script, so it is unavailable for the
                // Simple HTTP Endpoint type. Standard is never disabled.
                disabled: value === TestMode.NATIVE && isSimple,
              }))}
            />
            <KeyValuePairs
              columns={2}
              items={[
                {
                  label: "Standard",
                  value: "DLT overrides all framework traffic and durations.",
                },
                {
                  label: (
                    <SpaceBetween direction="horizontal" size="xs">
                      <span>Native</span>
                      <Badge color="blue">Preview</Badge>
                    </SpaceBetween>
                  ),
                  value: NATIVE_MODE_DESCRIPTION[formData.testType],
                },
              ]}
            />
          </SpaceBetween>
        </FormField>

        <ExpandableSection
          headerText="Security and framework details"
          expanded={securityDetailsExpanded}
          onChange={({ detail }) => {
            const next = { ...expandedByType, [formData.testType]: detail.expanded };
            setExpandedByType(next);
            try {
              localStorage.setItem(SECURITY_DETAILS_STORAGE_KEY, JSON.stringify(next));
            } catch {
              /* ignore storage errors (e.g. private browsing) */
            }
          }}
        >
          <SpaceBetween direction="vertical" size="s">
            <Alert type="info" header="Third-Party Testing Frameworks">
              Distributed Load Testing on AWS bundles three third-party testing frameworks. Under the{" "}
              <Link external href="https://aws.amazon.com/compliance/shared-responsibility-model/">
                AWS shared responsibility model
              </Link>
              , you are responsible for evaluating whether these frameworks and their bundled versions meet your
              organization&apos;s security requirements before running load tests. The solution distributes each
              framework without modification and verifies the bundled binaries using checksums at build time and
              runtime. See the{" "}
              <Link
                external
                href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/solution-overview.html"
              >
                Implementation Guide
              </Link>{" "}
              for more details.
            </Alert>

            {formData.testType === TestTypes.JMETER && (
              <Alert type="info" header={`Apache JMeter ${jmeter.version}`}>
                This version has known security vulnerabilities that cannot be fully patched externally due to
                compatibility constraints with the testing framework. You can supply a patched JMeter binary by
                including it in your test archive, or review known issues on the{" "}
                <Link external href="https://jmeter.apache.org/security.html">
                  Apache JMeter security page
                </Link>
                .
              </Alert>
            )}

            {formData.testType === TestTypes.SIMPLE && (
              <Alert type="info" header={`Apache JMeter ${jmeter.version}`}>
                This test uses Apache JMeter {jmeter.version} to execute your request. This version has known security
                vulnerabilities that cannot be fully patched externally due to compatibility constraints with the
                testing framework. Review known issues on the{" "}
                <Link external href="https://jmeter.apache.org/security.html">
                  Apache JMeter security page
                </Link>
                .
              </Alert>
            )}

            {formData.testType === TestTypes.K6 && (
              <Alert type="info" header={`K6 ${k6.version}`}>
                No known security vulnerabilities have been identified in this version at the time of release. DLT does
                not guarantee ongoing vulnerability monitoring of this third-party component. Review the{" "}
                <Link external href="https://github.com/grafana/k6/security/policy">
                  K6 security policy
                </Link>{" "}
                for reporting and disclosure information.
              </Alert>
            )}

            {formData.testType === TestTypes.LOCUST && (
              <Alert type="info" header={`Locust ${locust.version}`}>
                No known security vulnerabilities have been identified in this version at the time of release. DLT does
                not guarantee ongoing vulnerability monitoring of this third-party component. Review the{" "}
                <Link external href="https://github.com/locustio/locust/security">
                  Locust security page
                </Link>{" "}
                for advisories and reporting information.
              </Alert>
            )}
          </SpaceBetween>
        </ExpandableSection>
      </SpaceBetween>
    </FormSection>
  );
};
