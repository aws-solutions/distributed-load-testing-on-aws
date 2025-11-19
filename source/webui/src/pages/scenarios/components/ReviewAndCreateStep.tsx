// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Badge,
  Box,
  Button,
  ColumnLayout,
  Container,
  Grid,
  Header,
  SpaceBetween,
  Table,
} from "@cloudscape-design/components";
import { isScriptTestType } from "../../../utils/scenarioUtils";
import { FormData } from "../types";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  onEdit: (stepIndex: number) => void;
  onCancel: () => void;
}

export const ReviewAndCreateStep = ({ formData, updateFormData, onEdit, onCancel }: Props) => (
  <SpaceBetween direction="vertical" size="l">
    <Container
      header={
        <Header variant="h2" actions={<Button onClick={() => onEdit(0)}>Edit</Button>}>
          Test Configuration
        </Header>
      }
    >
      <ColumnLayout columns={2} variant="text-grid">
        <div>
          <Box variant="awsui-key-label">Name</Box>
          <div>{formData.testName || "-"}</div>
        </div>
        <div>
          <Box variant="awsui-key-label">Tags</Box>
          {formData.tags && formData.tags.length > 0 ? (
            <SpaceBetween direction="horizontal" size="xs">
              {formData.tags.map((tag, index) => (
                <Badge color="severity-neutral" key={index}>
                  {tag.label}
                </Badge>
              ))}
            </SpaceBetween>
          ) : (
            <div>-</div>
          )}
        </div>
        <div>
          <Box variant="awsui-key-label">Description</Box>
          <div>{formData.testDescription || "-"}</div>
        </div>
        <div>
          <Box variant="awsui-key-label">Test Id</Box>
          <div>{formData.testId || "-"}</div>
        </div>
        <div>
          <Box variant="awsui-key-label">Schedule</Box>
          {formData.executionTiming === "run-now" ? (
            <div>Run Now - Execute the load test immediately after creation</div>
          ) : formData.executionTiming === "run-once" ? (
            <div>
              Run Once
              <div>
                {formData.scheduleTime} {formData.scheduleDate}
              </div>
            </div>
          ) : (
            <div>
              <div>
                cron ({formData.cronMinutes} {formData.cronHours} {formData.cronDayOfMonth} {formData.cronMonth}{" "}
                {formData.cronDayOfWeek})
              </div>
            </div>
          )}
        </div>
        <div>
          <Box variant="awsui-key-label">Include Live Data</Box>
          <div>{formData.showLive ? "Yes" : "No"}</div>
        </div>
      </ColumnLayout>
    </Container>

    <Container
      header={
        <Header variant="h2" actions={<Button onClick={() => onEdit(1)}>Edit</Button>}>
          Scenario Configuration
        </Header>
      }
    >
      <SpaceBetween direction="vertical" size="s">
        <div>
          <Box variant="awsui-key-label">Test Type</Box>
          <div>{formData.testType || "-"}</div>
        </div>
        {isScriptTestType(formData.testType) ? (
          <div>
            <div>
              <Box variant="awsui-key-label">Script File</Box>
              <div>{formData.scriptFile[0].name || "-"}</div>
            </div>
          </div>
        ) : (
          <div>
            <div>
              <Box variant="awsui-key-label">HTTP Endpoint</Box>
              <div>{formData.httpEndpoint}</div>
            </div>
            <div>
              <Box variant="awsui-key-label">HTTP Method</Box>
              <div>{formData.httpMethod.value}</div>
            </div>
            <div>
              <Box variant="awsui-key-label">Request Header</Box>
              <div>{formData.requestHeaders || "-"}</div>
            </div>
            <div>
              <Box variant="awsui-key-label">Body Payload</Box>
              <div>{formData.bodyPayload || "-"}</div>
            </div>
          </div>
        )}
      </SpaceBetween>
    </Container>

    <Container
      header={
        <Header variant="h2" actions={<Button onClick={() => onEdit(2)}>Edit</Button>}>
          Traffic Configuration
        </Header>
      }
    >
      <SpaceBetween direction="vertical" size="s">
        <Grid gridDefinition={[{ colspan: 6 }, { colspan: 6 }]}>
          <div>
            <Box variant="awsui-key-label">Ramp Up</Box>
            <div>
              {formData.rampUpValue} {formData.rampUpUnit}
            </div>
          </div>
          <div>
            <Box variant="awsui-key-label">Hold For</Box>
            <div>
              {formData.holdForValue} {formData.holdForUnit}
            </div>
          </div>
        </Grid>

        <Table
          columnDefinitions={[
            {
              id: "region",
              header: "Region",
              cell: (item) => item.region,
            },
            {
              id: "taskCount",
              header: "Task Count",
              cell: (item) => item.taskCount,
            },
            {
              id: "concurrency",
              header: "Concurrency",
              cell: (item) => item.concurrency,
            },
          ]}
          items={formData.regions || []}
          variant="borderless"
        />
      </SpaceBetween>
    </Container>
  </SpaceBetween>
);
