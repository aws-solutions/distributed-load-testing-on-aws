// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Badge,
  Box,
  ColumnLayout,
  Container,
  CopyToClipboard,
  FormField,
  Header,
  Icon,
  Link,
  SpaceBetween,
  Spinner,
  StatusIndicator,
  Tabs,
} from "@cloudscape-design/components";
import { Amplify } from "aws-amplify";
import { getUrl } from "aws-amplify/storage";
import { formatToLocalTime } from "../../../utils/dateUtils";
import { STATUS_INDICATOR_MAP, TestStatus } from "../constants";
import { ScenarioDefinition } from "../types";
import { TaskStatus } from "./TaskStatus";
import { TestRuns } from "./TestRuns";

export function ScenarioDetailsContent({ scenario_definition, isRefreshing }: { scenario_definition: ScenarioDefinition; isRefreshing?: boolean }) {
  const schedule = scenario_definition.cronValue ? "cron" : scenario_definition.scheduleRecurrence || "Run Once";

  const handleFullTestDataLocation = async () => {
    try {
      const url = `https://console.aws.amazon.com/s3/buckets/${
        Amplify.getConfig().Storage?.S3?.bucket
      }?prefix=results/${scenario_definition.testId}/`;
      window.open(url, "_blank");
    } catch (error) {
      console.error("Failed to open S3 location for test run results", error);
    }
  };
  
  const getFilename = () => {
    let filename = scenario_definition.testScenario.scenarios[scenario_definition.testName].script;
    
    // Handle legacy ZIP files where the filename uses the extension for the underlying test framework instead of .zip (e.g. .jmx)
    if (scenario_definition.fileType === "zip" && !filename.endsWith(".zip")) {
      // Replace the file extension with .zip (e.g., test.jmx -> test.zip)
      const extensionIndex = filename.lastIndexOf('.');
      filename = filename.substring(0, extensionIndex) + '.zip';
    }
    
    return filename;
  };
  
  const handleScriptDownload = async () => {
    try {
      const filename = getFilename();
      const url = await getUrl({ path: `public/test-scenarios/${scenario_definition.testType.toLowerCase()}/${filename}` });
      window.open(url.url, "_blank");
    } catch (error) {
      console.error("Error", error);
    }
  };
  
  const getStatusIndicator = (status: string) => {
    if (!status) 
      return "--";
    
    const statusConfig = STATUS_INDICATOR_MAP[status as TestStatus];
    return statusConfig ? <StatusIndicator type={statusConfig.type}>{statusConfig.label}</StatusIndicator> : status;
  };

  return (
    <Tabs
      tabs={[
        {
          label: "Scenario Details",
          id: "scenario_details_tab",
          content: (
            <SpaceBetween size="l">
              <Container
                header={
                  <Header variant={"h2"}>
                    Scenario ID:
                    <CopyToClipboard
                      copyButtonAriaLabel="Copy Scenario ID"
                      copyErrorText="Scenario ID failed to copy"
                      copySuccessText="Scenario ID copied"
                      textToCopy={scenario_definition.testId}
                      variant="icon"
                    />
                    <span style={{ color: "#687078" }}>{scenario_definition.testId}</span>
                  </Header>
                }
              >
                {isRefreshing ? (
                  <Box textAlign="center" padding="xxl">
                    <Spinner size="large" />
                  </Box>
                ) : (
                <ColumnLayout borders="vertical" columns={3}>
                  <FormField label="Test Name">{scenario_definition.testName || "--"}</FormField>
                  <FormField label="Tags">
                    {scenario_definition.tags && scenario_definition.tags.length > 0 ? (
                      <SpaceBetween direction="horizontal" size="xs">
                        {scenario_definition.tags.map((tag, index) => (
                          <Badge color="severity-neutral" key={index}>{tag}</Badge>
                        ))}
                      </SpaceBetween>
                    ) : (
                      "-"
                    )}
                  </FormField>
                  <FormField label="Status">{getStatusIndicator(scenario_definition.status)}</FormField>
                  <FormField label="Test Type">{scenario_definition.testType || "--"}</FormField>
                  <FormField label="Schedule">{schedule}</FormField>
                  <FormField label="Last Run">{formatToLocalTime(scenario_definition.startTime)}</FormField>
                  <FormField label="Test Script">
                    {scenario_definition.testScenario.scenarios[scenario_definition.testName].script ? (
                      <Link onFollow={handleScriptDownload}>
                        <Icon name="download" />{" "}
                        <span style={{ fontWeight: "normal" }}>
                          {getFilename()}
                        </span>
                      </Link>
                    ) : (
                      "--"
                    )}
                  </FormField>
                  <FormField label="Raw Test Results">
                    <Link external onFollow={handleFullTestDataLocation}>
                      <span style={{ fontWeight: "normal" }}>S3 Results Bucket</span>
                    </Link>
                  </FormField>
                  <FormField label="Next Run">{formatToLocalTime(scenario_definition.nextRun)}</FormField>
                </ColumnLayout>
                )}
              </Container>
              {scenario_definition.status === "running" ? (
                <TaskStatus scenario_definition={scenario_definition} isRefreshing={isRefreshing} />
              ) : null}
            </SpaceBetween>
          ),
        },
        {
          label: "Test Runs",
          id: "test_runs_tab",
          content: <TestRuns testId={scenario_definition.testId} />,
        },
      ]}
    />
  );
}
