// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Badge,
  Box,
  ColumnLayout,
  Container,
  CopyToClipboard,
  Header,
  Icon,
  Link,
  Popover,
  SpaceBetween,
  Spinner,
  StatusIndicator,
} from "@cloudscape-design/components";
import { Amplify } from "aws-amplify";
import { getUrl } from "aws-amplify/storage";
import { formatToLocalTime } from "../../../utils/dateUtils";
import { getConsoleDomain } from "../../../utils/aws-console";
import { getStatusConfig, getTestTypeLabel } from "../constants";
import { ACTIVE_RUN_STATUSES, isTerminalRunStatus, TestStatus } from "@amzn/dlt-common/validation";
import type { ScenarioDefinition, TestRun } from "../types";
import { useInView } from "../hooks/useInView";
import { LoadConfigurationTable } from "./LoadConfigurationTable";
import { TaskStatus } from "./TaskStatus";
import { TestLifecycleSteps } from "./TestLifecycleSteps";

import { TestRuns } from "./TestRuns";

/** Type guard that checks whether a status string is a valid TestStatus enum value. */
const isTestStatus = (status: string): status is TestStatus =>
  (Object.values(TestStatus) as ReadonlyArray<string>).includes(status);

interface ScenarioDetailsContentProps {
  readonly scenario_definition: ScenarioDefinition;
  readonly latestTestRun?: TestRun;
}

/**
 * Keywords sit on their own full-width row below the overview grid so long lists wrap
 * instead of crowding the header actions.
 *
 * A helper rather than a component so the empty case yields `null` directly: SpaceBetween
 * wraps each element child in a flex item and would pay the row gap for a component that
 * renders nothing, leaving a blank strip under the grid.
 */
const renderKeywordsRow = (tags?: string[]) => {
  if (!tags?.length) return null;

  return (
    <div>
      <Box variant="awsui-key-label">Keywords</Box>
      {/* Badges have no leading whitespace of their own, unlike the plain-text values
          in the grid above, so add the gap under the key label. */}
      <Box padding={{ top: "xxs" }}>
        <SpaceBetween direction="horizontal" size="xs">
          {tags.map((tag) => (
            <Badge color="severity-neutral" key={tag}>
              {tag}
            </Badge>
          ))}
        </SpaceBetween>
      </Box>
    </div>
  );
};

export function ScenarioDetailsContent({
  scenario_definition,
  latestTestRun,
}: ScenarioDetailsContentProps) {
  const schedule = scenario_definition.cronValue ? "cron" : scenario_definition.scheduleRecurrence || "Run Once";

  const handleFullTestDataLocation = async () => {
    try {
      const s3Config = Amplify.getConfig().Storage?.S3;
      const consoleDomain = getConsoleDomain(s3Config?.region);
      const url = `https://${consoleDomain}/s3/buckets/${
        s3Config?.bucket
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
    
    const config = getStatusConfig(status);
    return <StatusIndicator type={config.type}>{config.label}</StatusIndicator>;
  };

  const hasScript = Boolean(scenario_definition.testScenario?.scenarios?.[scenario_definition.testName]?.script);

  // Load configuration is derived from the scenario config (not run results), so it
  // renders for never-run scenarios too.
  const execution = scenario_definition.testScenario?.execution?.[0];
  const rampUp = execution?.["ramp-up"] || "-";
  const holdFor = execution?.["hold-for"] || "-";
  const threshold = scenario_definition.healthyThreshold ?? 90;
  const regionConfigs = scenario_definition.testTaskConfigs ?? [];

  const showTaskStatus =
    isTestStatus(scenario_definition.status) &&
    (ACTIVE_RUN_STATUSES.has(scenario_definition.status) || isTerminalRunStatus(scenario_definition.status));

  // Test Runs stays in the page but only mounts (and fetches run history) once it
  // scrolls near the viewport, so opening the page to run/read config costs nothing.
  const { ref: testRunsRef, inView: showTestRuns } = useInView<HTMLDivElement>();

  return (
    <SpaceBetween size="l">
      {/* Scenario Overview */}
      <Container
        header={
          <Header
            variant="h2"
            description={scenario_definition.testDescription || undefined}
            actions={
              <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                {isTestStatus(scenario_definition.status) &&
                !isTerminalRunStatus(scenario_definition.status) &&
                scenario_definition.status !== TestStatus.CANCELLING ? (
                  <Popover
                    header="Test lifecycle"
                    content={<TestLifecycleSteps status={scenario_definition.status} />}
                    triggerType="text"
                    size="medium"
                  >
                    {getStatusIndicator(scenario_definition.status)}
                  </Popover>
                ) : scenario_definition.status === TestStatus.FAILED && scenario_definition.errorReason ? (
                  <Popover
                    header="Error details"
                    content={<StatusIndicator type="error">{scenario_definition.errorReason}</StatusIndicator>}
                    triggerType="text"
                    size="medium"
                  >
                    {getStatusIndicator(scenario_definition.status)}
                  </Popover>
                ) : (
                  getStatusIndicator(scenario_definition.status)
                )}
              </SpaceBetween>
            }
          >
            Scenario Overview
          </Header>
        }
      >
        <SpaceBetween size="l">
          <ColumnLayout columns={4}>
            <div>
              <Box variant="awsui-key-label">Scenario ID</Box>
              <SpaceBetween direction="horizontal" size="xxs">
                <Box>{scenario_definition.testId}</Box>
                <CopyToClipboard
                  copyButtonAriaLabel="Copy Scenario ID"
                  copyErrorText="Scenario ID failed to copy"
                  copySuccessText="Scenario ID copied"
                  textToCopy={scenario_definition.testId}
                  variant="icon"
                />
              </SpaceBetween>
            </div>
            <div>
              <Box variant="awsui-key-label">Test Type</Box>
              <Box>{scenario_definition.testType ? getTestTypeLabel(scenario_definition.testType) : "--"}</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Test Script</Box>
              {hasScript ? (
                <Link onFollow={handleScriptDownload}>
                  <Icon name="download" /> {getFilename()}
                </Link>
              ) : (
                <Box>--</Box>
              )}
            </div>
            <div>
              <Box variant="awsui-key-label">Results</Box>
              <Link external onFollow={handleFullTestDataLocation}>
                S3 Results Bucket
              </Link>
            </div>
            <div>
              <Box variant="awsui-key-label">Schedule</Box>
              <Box>{schedule}</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Last Run</Box>
              <Box>{formatToLocalTime(scenario_definition.startTime, { timeZoneName: "short" })}</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Next Run</Box>
              <Box>
                {formatToLocalTime(
                  scenario_definition.nextRun,
                  { timeZoneName: "short" },
                  scenario_definition.scheduleTimezone,
                )}
              </Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Total Runs</Box>
              <Box>{scenario_definition.totalTestRuns ?? "--"}</Box>
            </div>
          </ColumnLayout>
          {renderKeywordsRow(scenario_definition.tags)}
        </SpaceBetween>
      </Container>

      {/* Load Configuration — always visible, sourced from scenario config */}
      <LoadConfigurationTable
        configs={regionConfigs}
        nativeRunMode={scenario_definition.nativeRunMode}
        rampUp={rampUp}
        holdFor={holdFor}
        threshold={threshold}
        emptyText="No regions configured"
      />

      {showTaskStatus ? <TaskStatus scenario_definition={scenario_definition} /> : null}

      {/* Test Runs — always in the page; mounts and loads history when scrolled near. */}
      <div ref={testRunsRef}>
        {showTestRuns ? (
          <TestRuns
            testId={scenario_definition.testId}
            latestTestRun={latestTestRun}
          />
        ) : (
          <Box textAlign="center" padding="l">
            <Spinner />
          </Box>
        )}
      </div>
    </SpaceBetween>
  );
}
