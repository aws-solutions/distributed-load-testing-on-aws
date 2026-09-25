// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Box, ColumnLayout, Container, CopyToClipboard, Header, SpaceBetween } from "@cloudscape-design/components";
import { formatToLocalTime } from "../../../utils/dateUtils";
import { TestRunDetails } from "../types/testResults";
import { LoadConfigurationTable } from "./LoadConfigurationTable";

interface ScenarioMetadataProps {
  testRun: TestRunDetails;
  testId: string;
  testRunId: string;
}

export function ScenarioMetadata({ testRun, testId, testRunId }: ScenarioMetadataProps) {
  const formatTimestamp = (timestamp: string) =>
    formatToLocalTime(timestamp, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });

  const execution = testRun?.testScenario?.execution?.[0];
  const rampUp = execution?.["ramp-up"] || "-";
  const holdFor = execution?.["hold-for"] || "-";
  const configs = testRun.testTaskConfigs ?? [];

  return (
    <SpaceBetween size="l">
      {/* Run Overview */}
      <Container header={<Header variant="h2" description={testRun.testDescription || undefined}>Run Overview</Header>}>
        <ColumnLayout columns={4}>
          <div>
            <Box variant="awsui-key-label">Scenario ID</Box>
            <SpaceBetween direction="horizontal" size="xxs">
              <Box>{testId}</Box>
              <CopyToClipboard
                copyButtonAriaLabel="Copy Scenario ID"
                copyErrorText="Scenario ID failed to copy"
                copySuccessText="Scenario ID copied"
                textToCopy={testId}
                variant="icon"
              />
            </SpaceBetween>
          </div>
          <div>
            <Box variant="awsui-key-label">Test Run ID</Box>
            <SpaceBetween direction="horizontal" size="xxs">
              <Box>{testRunId}</Box>
              <CopyToClipboard
                copyButtonAriaLabel="Copy Test Run ID"
                copyErrorText="Test Run ID failed to copy"
                copySuccessText="Test Run ID copied"
                textToCopy={testRunId}
                variant="icon"
              />
            </SpaceBetween>
          </div>
          <div>
            <Box variant="awsui-key-label">Started</Box>
            <Box>{testRun.startTime ? formatTimestamp(testRun.startTime) : "-"}</Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Ended</Box>
            <Box>{testRun.endTime ? formatTimestamp(testRun.endTime) : "-"}</Box>
          </div>
        </ColumnLayout>
      </Container>

      {/* Load Configuration */}
      <LoadConfigurationTable
        configs={configs}
        nativeRunMode={testRun.nativeRunMode}
        rampUp={rampUp}
        holdFor={holdFor}
        emptyText="No regional configuration available"
      />
    </SpaceBetween>
  );
}
