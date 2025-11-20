// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Container, ContentLayout, CopyToClipboard, Header, SpaceBetween, Box, ColumnLayout, Button, Link, Icon, Spinner, ExpandableSection } from "@cloudscape-design/components";
import { useGetStackInfoQuery } from "../../store/stackInfoApiSlice";
import { useGetRegionsQuery } from "../../store/regionsSlice";
import { useSelector } from "react-redux";
import { RootState } from "../../store/store";
import { useNavigate } from "react-router-dom";

export default function IntroductionPage() {
  const navigate = useNavigate();
  const { data: stackInfo } = useGetStackInfoQuery();
  const { data: regionsResponse, isLoading } = useGetRegionsQuery();
  const regionsData = useSelector((state: RootState) => state.regions.data);
  const availableRegions = regionsData ?? [];
  const regionalTemplateUrl = regionsResponse?.url || "";

  return (
    <ContentLayout header={<Header variant="h1">Distributed Load Testing Solution on AWS</Header>}>
      <Container header={<Header variant="h2">Solution Overview</Header>}>
        <SpaceBetween size="m">
          <Box variant="p">
           The Distributed Load Testing Solution utilizes fully managed, highly available, and seamlessly scalable AWS services to effortlessly simulate thousands of concurrent users, generating a configurable number of transactions per second.
          </Box>
          
          <Container header={<Header variant="h3">Current deployment</Header>}>
            <Box variant="small" color="text-body-secondary">Your solution is deployed and ready to use.</Box>
            {stackInfo && (
              <ColumnLayout columns={3} variant="text-grid">
                <div>
                  <Box variant="awsui-key-label">Solution version</Box>
                  <Box>{stackInfo.version}</Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Deployment date</Box>
                  <Box>{new Date(stackInfo.created_time).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</Box>
                </div>
                <div>
                  <Box variant="awsui-key-label">Region</Box>
                  <Box>{stackInfo.region}</Box>
                </div>
              </ColumnLayout>
            )}
          </Container>

          <Container header={<Header variant="h3">Key features</Header>}>
            <ColumnLayout columns={3} variant="text-grid">
              <div>
                <Box variant="h4" padding={{ bottom: "xs" }}>Scalable load generation</Box>
                <Box variant="p">Generate thousands of concurrent virtual users across multiple AWS regions to simulate real-world traffic patterns.</Box>
              </div>
              <div>
                <Box variant="h4" padding={{ bottom: "xs" }}>Real-time monitoring</Box>
                <Box variant="p">Monitor test progress and results with comprehensive dashboards and metrics.</Box>
              </div>
              <div>
                <Box variant="h4" padding={{ bottom: "xs" }}>Agentic integration</Box>
                <Box variant="p">Use the Distributed Load Testing MCP Server to analyze your test results data using natural language.</Box>
              </div>
            </ColumnLayout>
          </Container>

          <Container header={<Header variant="h3" actions={<Button variant="primary" onClick={() => navigate('/create-scenario')}>+ New Test Scenario</Button>}>Getting started</Header>}>
            <Box variant="p" padding={{ bottom: "s" }}>Follow these steps to run your first load test:</Box>
            <SpaceBetween size="xs">
              <Box><Icon name="status-positive" /> Create a test scenario</Box>
              <Box padding={{ left: "l" }} color="text-body-secondary">Define your test parameters including target endpoint, number of virtual users, and test duration.</Box>
              <Box><Icon name="status-positive" /> Configure test</Box>
              <Box padding={{ left: "l" }} color="text-body-secondary">Set up load patterns, ramp-up times, and specify the regions to run tests from.</Box>
              <Box><Icon name="status-positive" /> Run your test</Box>
              <Box padding={{ left: "l" }} color="text-body-secondary">Execute the test and monitor real-time results through the dashboard.</Box>
              <Box><Icon name="status-positive" /> Analyze results</Box>
              <Box padding={{ left: "l" }} color="text-body-secondary">Review test results via the UI, test run artifacts, and the MCP Server to understand your application's performance.</Box>
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h3">Multi-region setup</Header>}>
            <Box variant="p" padding={{ bottom: "s" }}>Expand your testing capabilities by adding additional regions for comprehensive global load testing.</Box>
            
            {isLoading ? (
              <Spinner />
            ) : availableRegions.length > 0 && (
              <>
                <Box variant="h4" padding={{ bottom: "xs", top: "s" }}>Available Regions:</Box>
                <SpaceBetween size="xs" direction="horizontal">
                  {availableRegions.map((region) => (
                    <Button key={region} variant="normal" iconName="status-positive">{region}</Button>
                  ))}
                </SpaceBetween>
              </>
            )}

            <ExpandableSection headerText="Add A Region" variant="footer">
              <SpaceBetween size="s">
                <Box variant="p">Add a new region to enable multi-region load testing.</Box>
                <ul>
                  <li>Copy the S3 link for the regional CloudFormation template</li>
                  <li>Navigate to <Link href="https://console.aws.amazon.com/cloudformation" external>CloudFormation in the AWS console</Link></li>
                  <li>Select the region from the dropdown menu in the upper right hand corner</li>
                  <li>Create a new Stack and paste the S3 link in the Amazon S3 URL field</li>
                  <li>Launch the CloudFormation Stack</li>
                </ul>
                {regionalTemplateUrl && (
                  <Box>
                    <Box variant="awsui-key-label">Regional Deployment CloudFormation Template URL:</Box>
                    <CopyToClipboard
                      copyButtonAriaLabel="Copy URL"
                      copyErrorText="URL failed to copy"
                      copySuccessText="URL copied"
                      textToCopy={regionalTemplateUrl}
                      variant="inline"
                    />
                  </Box>
                )}
              </SpaceBetween>
            </ExpandableSection>

            <ExpandableSection headerText="Delete A Region" variant="footer">
              <SpaceBetween size="s">
                <Box variant="p">Remove a region.</Box>
                <ul>
                  <li>Navigate to <Link href="https://console.aws.amazon.com/cloudformation" external>the CloudFormation console</Link></li>
                  <li>Select the appropriate region from the dropdown menu in the upper right hand corner</li>
                  <li>Select the appropriate CloudFormation stack and click the Delete button to delete the regional deployment</li>
                </ul>
              </SpaceBetween>
            </ExpandableSection>
          </Container>
        </SpaceBetween>
      </Container>
    </ContentLayout>
  );
}
