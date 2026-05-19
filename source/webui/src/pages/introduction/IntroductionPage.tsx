// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect } from "react";
import { getUrl } from "aws-amplify/storage";

import {
  Alert,
  Box,
  Button,
  ColumnLayout,
  Container,
  ContentLayout,
  CopyToClipboard,
  Header,
  Icon,
  Link,
  SpaceBetween,
  Spinner,
  Table,
  TextContent,
} from "@cloudscape-design/components";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import jmeterConfig from "../../../../../jmeter.json";
import k6Config from "../../../../../k6.json";
import locustConfig from "../../../../../locust.json";
import { useGetRegionsQuery } from "../../store/regionsSlice";
import { STACK_INFO_CACHE_SECONDS, useGetStackInfoQuery } from "../../store/stackInfoApiSlice";
import type { StackInfo } from "../../store/stackInfoApiSlice";
import { RootState } from "../../store/store";
import { getRegionName } from "../../utils/regions";
import { getConsoleDomain } from "../../utils/aws-console";
import { usePageLoadMetric } from "../../hooks/usePageLoadMetric";
import { sendConsoleMetric } from "../../utils/consoleMetrics";

const HUB_STACK_UPGRADE_GUIDES = {
  cloudformation: {
    steps: [
      "Copy the S3 URL or download the CloudFormation template.",
      "Open CloudFormation and choose Update stack.",
      "Choose Replace existing template and paste the template URL or upload the new CloudFormation template.",
      "Follow the remaining prompts to complete the update.",
    ],
    docsUrl:
      "https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/update-using-aws-cloudformation.html",
    docsLabel: "Learn more about upgrading via CloudFormation",
  },
  "launch-wizard": {
    steps: [
      "Open your deployment in the AWS Launch Wizard console.",
      "Choose Update and follow the guided workflow.",
    ],
    docsUrl:
      "https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/deploy-using-aws-launch-wizard.html",
    docsLabel: "Learn more about upgrading via Launch Wizard",
  },
} as const;

const HUB_TEMPLATE_URL_BASE = "https://solutions-reference.s3.amazonaws.com/distributed-load-testing-on-aws/latest";

const HUB_TEMPLATE_FILENAMES: Record<NonNullable<StackInfo["solution_template"]>, string> = {
  cloudfront: "distributed-load-testing-on-aws.template",
  "alb-ecs": "distributed-load-testing-on-aws-alb-ecs.template",
  headless: "distributed-load-testing-on-aws-headless.template",
};

function getHubTemplateUrl(solutionTemplate: StackInfo["solution_template"]): string {
  return `${HUB_TEMPLATE_URL_BASE}/${HUB_TEMPLATE_FILENAMES[solutionTemplate]}`;
}

function getConsoleUpdateCta(deploymentMethod: StackInfo["deployment_method"], region: string, stackId: string) {
  const consoleDomain = getConsoleDomain(region);
  if (deploymentMethod === "launch-wizard") {
    return {
      href: `https://${region}.${consoleDomain}/launchwizard/home?region=${region}#/deployment/list/`,
      label: "Open Launch Wizard",
    };
  }
  return {
    href: `https://${region}.${consoleDomain}/cloudformation/home?region=${region}#/stacks/stackinfo?stackId=${encodeURIComponent(stackId)}`,
    label: "Open CloudFormation",
  };
}

export default function IntroductionPage() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { data: stackInfo, isLoading: isStackInfoLoading, error: stackInfoError } = useGetStackInfoQuery(undefined, { refetchOnMountOrArgChange: STACK_INFO_CACHE_SECONDS });
  const { data: regionsData, isLoading, error } = useGetRegionsQuery();
  usePageLoadMetric("Dashboard", { dataReady: !isLoading && !error && !isStackInfoLoading && !stackInfoError });

  // Handle URL fragments (e.g. #header-id) for section navigation
  useEffect(() => {
    if (hash) {
      document.getElementById(hash.substring(1))?.scrollIntoView({ behavior: "smooth" });
    }
  }, [hash]);
  const regionalStacks = useSelector((state: RootState) => state.regions.regionalStacks);
  const regionalTemplateUrl = regionsData?.url || "";

  const handleTemplateDownload = useCallback(async () => {
    if (!regionalTemplateUrl) return;
    try {
      // Extract the S3 object key from the path-style URL (https://s3.region.amazonaws.com/bucket/key)
      const s3Key = new URL(regionalTemplateUrl).pathname.split("/").slice(2).join("/");
      const { url } = await getUrl({ path: s3Key });
      window.open(url, "_blank");
    } catch (error) {
      console.error("Error downloading template:", error);
    }
  }, [regionalTemplateUrl]);

  // Check if there are any incompatible regions (exclude hub region)
  const hasIncompatibleRegions =
    regionalStacks?.some((stack) => stack.region !== stackInfo?.region && !stack.compatible) ?? false;
  const hasIncompatibleWithoutStackId =
    regionalStacks?.some((stack) => stack.region !== stackInfo?.region && !stack.compatible && !stack.stackId) ?? false;

  // Check if there is an available update for the hub stack
  const isHubUpdateAvailable = stackInfo?.is_update_available === true;

  const deploymentTable: Array<{
    type: string;
    region: string;
    formattedRegion: string;
    version: string;
    deploymentDate: string;
    compatible: boolean;
    stackId?: string;
    isUpdateAvailable?: boolean;
  }> = [];
  
  // Hub row
  if (stackInfo) {
    deploymentTable.push({
      type: "Hub",
      region: stackInfo.region,
      formattedRegion: `${stackInfo.region} (${getRegionName(stackInfo.region)})`,
      version: stackInfo.version,
      deploymentDate: new Date(stackInfo.created_time).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      compatible: true,
      isUpdateAvailable: isHubUpdateAvailable,
    });
  }

  // Add Spoke rows (exclude hub region since it already has local infrastructure)
  if (regionalStacks && stackInfo) {
    regionalStacks
      .filter((stack) => stack.region !== stackInfo.region)
      .forEach((stack) => {
      deploymentTable.push({
        type: "Spoke",
        region: stack.region,
        formattedRegion: `${stack.region} (${getRegionName(stack.region)})`,
        version: stack.version || "unknown",
        deploymentDate: new Date(stack.deploymentDate).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        compatible: stack.compatible,
        stackId: stack.stackId,
      });
    });
  }


  return (
    <ContentLayout header={<Header variant="h1">Distributed Load Testing Solution on AWS</Header>}>
      <SpaceBetween size="m">
          <Box variant="p">
            Distributed Load Testing (DLT) leverages fully managed, highly available, and scalable AWS services to
            simulate thousands of concurrent users, generating a configurable number of transactions per second.
          </Box>

          <Container header={<Header variant="h3">Current Deployment</Header>}>
            {stackInfo && (
              <SpaceBetween size="l">
                <ColumnLayout columns={3} variant="text-grid">
                  <div>
                    <Box variant="awsui-key-label">Solution Version</Box>
                    <Box>{stackInfo.version}</Box>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">Deployment Date</Box>
                    <Box>
                      {new Date(stackInfo.created_time).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </Box>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">Primary Region</Box>
                    <Box>{stackInfo.region}</Box>
                  </div>
                </ColumnLayout>
                <ColumnLayout columns={3} variant="text-grid">
                  <div>
                    <Box variant="awsui-key-label">JMeter Version</Box>
                    <Box>{jmeterConfig.version}</Box>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">K6 Version</Box>
                    <Box>{k6Config.version}</Box>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">Locust Version</Box>
                    <Box>{locustConfig.version}</Box>
                  </div>
                </ColumnLayout>
              </SpaceBetween>
            )}
          </Container>

          <Container header={<Header variant="h3">Key Features</Header>}>
            <ColumnLayout columns={3} variant="text-grid">
              <div>
                <Box variant="h4" padding={{ bottom: "xs" }}>
                  Scalable load generation
                </Box>
                <Box variant="p">
                  Generate thousands of concurrent virtual users across multiple AWS regions to simulate real-world
                  traffic patterns.
                </Box>
              </div>
              <div>
                <Box variant="h4" padding={{ bottom: "xs" }}>
                  Real-time monitoring
                </Box>
                <Box variant="p">Monitor test progress and results with comprehensive dashboards and metrics.</Box>
              </div>
              <div>
                <Box variant="h4" padding={{ bottom: "xs" }}>
                  Agentic integration
                </Box>
                <Box variant="p">
                  Use the Distributed Load Testing MCP Server to analyze your test results data using natural language.
                </Box>
              </div>
            </ColumnLayout>
          </Container>

          <Container
            header={
              <Header
                variant="h3"
                actions={
                  <Button variant="primary" onClick={() => {
                    sendConsoleMetric("ButtonClick", { Page: "Dashboard", Action: "NewScenario" });
                    navigate("/create-scenario");
                  }} data-cy="intro-new-scenario-btn">
                    + New Test Scenario
                  </Button>
                }
              >
                Getting Started
              </Header>
            }
          >
            <Box variant="p" padding={{ bottom: "s" }}>
              Follow these steps to run your first load test:
            </Box>
            <SpaceBetween size="xs">
              <Box>
                <Icon name="status-positive" /> Create a test scenario
              </Box>
              <Box padding={{ left: "l" }} color="text-body-secondary">
                Define your test parameters including target endpoint, number of virtual users, and test duration.
              </Box>
              <Box>
                <Icon name="status-positive" /> Configure test
              </Box>
              <Box padding={{ left: "l" }} color="text-body-secondary">
                Set up load patterns, ramp-up times, and specify the regions to run tests from.
              </Box>
              <Box>
                <Icon name="status-positive" /> Run your test
              </Box>
              <Box padding={{ left: "l" }} color="text-body-secondary">
                Execute the test and monitor real-time results through the dashboard.
              </Box>
              <Box>
                <Icon name="status-positive" /> Analyze results
              </Box>
              <Box padding={{ left: "l" }} color="text-body-secondary">
                Review test results via the UI, test run artifacts, and the MCP Server to understand your application's
                performance.
              </Box>
            </SpaceBetween>
          </Container>

          <div id="deployment-setup">
            <Container header={<Header variant="h3">Multi-Region Deployments</Header>}>
              <SpaceBetween size="l">
                {isHubUpdateAvailable && stackInfo && (() => {
                  const cta = getConsoleUpdateCta(
                    stackInfo.deployment_method,
                    stackInfo.region,
                    stackInfo.stack_id,
                  );
                  const templateUrl = getHubTemplateUrl(stackInfo.solution_template);
                  const guide = HUB_STACK_UPGRADE_GUIDES[stackInfo.deployment_method];
                  const showTemplateSection =
                    stackInfo.deployment_method === "cloudformation" &&
                    stackInfo.solution_template === "cloudfront";
                  return (
                    <Alert type="warning" header="A newer version of Distributed Load Testing is available">
                      <SpaceBetween size="s">
                        <Box>
                          Your hub is running {stackInfo.version} in {stackInfo.region}. The latest
                          version is v{stackInfo.latest_version}.
                        </Box>
                        {showTemplateSection && (
                          <SpaceBetween size="xs">
                            <Box variant="strong">Hub template</Box>
                            <SpaceBetween size="xs" direction="horizontal">
                              <CopyToClipboard
                                copyButtonAriaLabel="Copy hub template URL"
                                copyButtonText="Copy S3 URL"
                                copyErrorText="Failed to copy"
                                copySuccessText="Copied"
                                textToCopy={templateUrl}
                                variant="button"
                              />
                              <Button variant="normal" iconName="download" href={templateUrl} target="_blank">
                                Download template
                              </Button>
                            </SpaceBetween>
                          </SpaceBetween>
                        )}
                        <Box variant="strong">How to update:</Box>
                        <TextContent>
                          <ol>
                            {guide.steps.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                        </TextContent>
                        <SpaceBetween size="xs" direction="horizontal">
                          <Button
                            variant="primary"
                            iconAlign="right"
                            iconName="external"
                            href={cta.href}
                            target="_blank"
                          >
                            {cta.label}
                          </Button>
                          <Button
                            variant="normal"
                            iconAlign="right"
                            iconName="external"
                            href={guide.docsUrl}
                            target="_blank"
                          >
                            {guide.docsLabel}
                          </Button>
                        </SpaceBetween>
                      </SpaceBetween>
                    </Alert>
                  );
                })()}
                {hasIncompatibleRegions ? (
                  <Alert type="warning" header="Spoke version incompatibility detected">
                    <SpaceBetween size="s">
                      <Box>
                        Your hub is running version {stackInfo?.version} but some multi-region deployments (spokes) are
                        running incompatible versions. Update each incompatible spoke to restore compatibility.
                      </Box>
                      {regionalTemplateUrl && (
                        <SpaceBetween size="xs">
                          <Box variant="strong">Regional template</Box>
                          <SpaceBetween size="xs" direction="horizontal">
                            <CopyToClipboard
                              copyButtonAriaLabel="Copy regional template URL"
                              copyButtonText="Copy S3 URL"
                              copyErrorText="Failed to copy"
                              copySuccessText="Copied"
                              textToCopy={regionalTemplateUrl}
                              variant="button"
                            />
                            <Button variant="normal" iconName="download" onClick={handleTemplateDownload}>
                              Download template
                            </Button>
                          </SpaceBetween>
                        </SpaceBetween>
                      )}
                      <Box variant="strong">How to update a spoke:</Box>
                      <TextContent>
                        <ol>
                          <li>Copy or download the regional template above.</li>
                          <li>Click "update stack" on the incompatible spoke below to open the CloudFormation console.</li>
                          {hasIncompatibleWithoutStackId && (
                            <li>Select the regional CloudFormation stack for the spoke you are updating.</li>
                          )}
                          <li>Choose Update stack, then Create a change set to preview changes.</li>
                          <li>Select Replace existing template, paste the S3 URL, and submit the change set.</li>
                          <li>Follow the remaining prompts to complete the update.</li>
                        </ol>
                      </TextContent>
                      <Box>
                        <Link href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/update-using-aws-cloudformation.html" external>
                          Learn more about upgrading
                        </Link>
                      </Box>
                    </SpaceBetween>
                  </Alert>
                ) : (
                  <Box variant="p">
                    View your hub deployment and multi-region deployments (spokes). Expand your testing capabilities by
                    adding additional regions for comprehensive global load testing.{" "}
                    <Link href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/update-using-aws-cloudformation.html" external>
                      Learn more about upgrading
                    </Link>
                  </Box>
                )}

                {isLoading ? (
                  <Spinner />
                ) : (
                  <Table
                    columnDefinitions={[
                      {
                        id: "type",
                        header: "Type",
                        cell: (item) => item.type,
                        width: 80,
                      },
                      {
                        id: "region",
                        header: "Region",
                        cell: (item) => item.formattedRegion,
                      },
                      {
                        id: "version",
                        header: "Version",
                        cell: (item) => item.version,
                      },
                      {
                        id: "deploymentDate",
                        header: "Deployment date",
                        cell: (item) => item.deploymentDate,
                      },
                      {
                        id: "compatibility",
                        header: "Compatibility",
                        cell: (item) => {
                          if (item.isUpdateAvailable) {
                            return (
                              <span>
                                <Icon name="status-warning" variant="warning" /> Update available
                              </span>
                            );
                          }
                          if (item.compatible) {
                            return (
                              <span>
                                <Icon name="status-positive" variant="success" /> Compatible
                              </span>
                            );
                          }
                          const itemConsoleDomain = getConsoleDomain(item.region);
                          const cfnUrl = item.stackId
                            ? `https://${item.region}.${itemConsoleDomain}/cloudformation/home?region=${item.region}#/stacks/stackinfo?stackId=${encodeURIComponent(item.stackId)}`
                            : `https://${item.region}.${itemConsoleDomain}/cloudformation/home?region=${item.region}`;
                          return (
                            <span>
                              <Icon name="status-warning" variant="warning" /> Incompatible —{" "}
                              <Link href={cfnUrl} external>
                                update stack
                              </Link>
                            </span>
                          );
                        },
                      },
                    ]}
                    items={deploymentTable}
                    variant="embedded"
                    empty={
                      <Box textAlign="center" color="inherit">
                        <b>No regions configured</b>
                        <Box padding={{ bottom: "s" }} variant="p" color="inherit">
                          Deploy regional stacks to enable multi-region testing.
                        </Box>
                      </Box>
                    }
                  />
                )}

                <SpaceBetween size="s">
                  <Box variant="h4">Deploy Regional Stack</Box>
                  <Box variant="p">
                    Deploy regional stacks to enable load testing from distributed geographic locations.
                  </Box>
                  <TextContent>
                    <ol>
                      <li>Click "Deploy regional stack" to open the CloudFormation console.</li>
                      <li>Select the target region from the navigation bar before creating the stack.</li>
                      <li>Review the parameters and launch the stack.</li>
                    </ol>
                  </TextContent>
                  {regionalTemplateUrl ? (
                    <SpaceBetween size="xs" direction="horizontal">
                      <Button
                        variant="normal"
                        iconName="external"
                        href={`https://${getConsoleDomain(stackInfo?.region)}/cloudformation/home#/stacks/create/review?templateURL=${encodeURIComponent(regionalTemplateUrl)}`}
                        target="_blank"
                      >
                        Deploy regional stack
                      </Button>
                      <Button variant="normal" iconName="download" onClick={handleTemplateDownload}>
                        Download template
                      </Button>
                      <CopyToClipboard
                        data-cy="regional-template-url"
                        copyButtonAriaLabel="Copy regional template S3 URL"
                        copyButtonText="Copy S3 URL"
                        copyErrorText="Failed to copy"
                        copySuccessText="Copied"
                        textToCopy={regionalTemplateUrl}
                        variant="button"
                      />
                    </SpaceBetween>
                  ) : null}
                </SpaceBetween>

                <SpaceBetween size="s">
                  <Box variant="h4">Delete Regional Stack</Box>
                  <TextContent>
                    <ol>
                      <li>
                        Navigate to the{" "}
                        <Link href={`https://${getConsoleDomain(stackInfo?.region)}/cloudformation`} external>
                          CloudFormation console
                        </Link>{" "}
                        and select the target region from the navigation bar.
                      </li>
                      <li>Select the regional CloudFormation stack and choose Delete.</li>
                      <li>Confirm the deletion when prompted.</li>
                    </ol>
                  </TextContent>
                </SpaceBetween>
              </SpaceBetween>
            </Container>
          </div>
        </SpaceBetween>
    </ContentLayout>
  );
}
