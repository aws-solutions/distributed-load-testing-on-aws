// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Button,
  ColumnLayout,
  Container,
  KeyValuePairs,
  SpaceBetween,
  Table
} from "@cloudscape-design/components";
import { TestRunDetails } from "../types/testResults";

interface ScenarioMetadataProps {
  testRun: TestRunDetails;
  testId: string;
  testRunId: string;
}

export function ScenarioMetadata({ testRun, testId, testRunId }: ScenarioMetadataProps) {
  // Helper function to format timestamps to local time
  const formatTimestamp = (timestamp: string) => {
    if (!timestamp) return '-';
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch {
      return timestamp;
    }
  };

  // Helper function to get execution details
  const getExecutionDetails = () => {
    if (!testRun?.testScenario?.execution?.[0]) return { rampUp: '', holdFor: '' };
    
    const execution = testRun.testScenario.execution[0];
    return {
      rampUp: execution['ramp-up'] || '',
      holdFor: execution['hold-for'] || ''
    };
  };

  const executionDetails = getExecutionDetails();

  // Prepare regional configuration table data
  const regionalConfigItems = testRun.testTaskConfigs?.map(config => ({
    region: config.region,
    taskCount: config.taskCount,
    concurrency: config.concurrency
  })) || [];

  return (
    <Container>
      <SpaceBetween size="l">
        {/* Group 1: Scenario ID + Test Run ID */}
        <ColumnLayout columns={2} variant="text-grid">
          <KeyValuePairs
            columns={1}
            items={[
              {
                label: "Test Scenario ID",
                value: (
                  <SpaceBetween size="xxs" direction="horizontal">
                    <span>{testId}</span>
                    <Button
                      variant="inline-icon"
                      iconName="copy"
                      ariaLabel="Copy test scenario ID"
                      onClick={() => navigator.clipboard.writeText(testId || '')}
                    />
                  </SpaceBetween>
                )
              }
            ]}
          />
          <KeyValuePairs
            columns={1}
            items={[
              {
                label: "Test Run ID",
                value: (
                  <SpaceBetween size="xxs" direction="horizontal">
                    <span>{testRunId}</span>
                    <Button
                      variant="inline-icon"
                      iconName="copy"
                      ariaLabel="Copy test run ID"
                      onClick={() => navigator.clipboard.writeText(testRunId || '')}
                    />
                  </SpaceBetween>
                )
              }
            ]}
          />
        </ColumnLayout>

        {/* Group 2: Name + Description */}
        <ColumnLayout columns={2} variant="text-grid">
          <KeyValuePairs
            columns={1}
            items={[
              {
                label: "Name",
                value: testRun.testScenario?.execution?.[0]?.scenario || '-'
              }
            ]}
          />
          <KeyValuePairs
            columns={1}
            items={[
              {
                label: "Description",
                value: testRun.testDescription || '-'
              }
            ]}
          />
        </ColumnLayout>

        {/* Group 3: Start Time + End Time */}
        <ColumnLayout columns={2} variant="text-grid">
          <KeyValuePairs
            columns={1}
            items={[
              {
                label: "Started At",
                value: formatTimestamp(testRun.startTime)
              }
            ]}
          />
          <KeyValuePairs
            columns={1}
            items={[
              {
                label: "Ended At",
                value: formatTimestamp(testRun.endTime)
              }
            ]}
          />
        </ColumnLayout>

        {/* Group 4: Ramp Up + Hold For */}
        <ColumnLayout columns={2} variant="text-grid">
          <KeyValuePairs
            columns={1}
            items={[
              {
                label: "Ramp Up",
                value: executionDetails.rampUp || '-'
              }
            ]}
          />
          <KeyValuePairs
            columns={1}
            items={[
              {
                label: "Hold For",
                value: executionDetails.holdFor || '-'
              }
            ]}
          />
        </ColumnLayout>

        {/* Group 5: Table with Task Count + Concurrency (per region) */}
        <div>
          <Table
            columnDefinitions={[
              {
                id: "region",
                header: "Region",
                cell: item => item.region
              },
              {
                id: "taskCount",
                header: "Task Count",
                cell: item => item.taskCount
              },
              {
                id: "concurrency",
                header: "Concurrency",
                cell: item => item.concurrency
              }
            ]}
            items={regionalConfigItems}
            variant="embedded"
            empty={
              <div style={{ textAlign: 'center', padding: '20px' }}>
                No regional configuration available
              </div>
            }
          />
        </div>
      </SpaceBetween>
    </Container>
  );
}
