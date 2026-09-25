// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Box, Container, Header, Icon, KeyValuePairs } from "@cloudscape-design/components";

const guideLabel = (text: string) => (
  <Box variant="awsui-key-label">
    <Icon name="status-positive" variant="success" /> {text}
  </Box>
);

export const NativeModeReview = () => (
  <Container
    data-cy="native-mode-review"
    header={
      <Header
        variant="h2"
        description={
          <>
            Your test script controls <strong>traffic</strong> and <strong>duration</strong>. Each task runs it
            independently.
          </>
        }
      >
        Native Mode Checklist
      </Header>
    }
  >
    <KeyValuePairs
      columns={1}
      items={[
        {
          label: guideLabel("Ensure each task can run your script’s full workload"),
          value: <Box padding={{ left: "l" }}>Each task provides 2 vCPUs · 4 GiB memory · 20 GiB disk space.</Box>,
        },
        {
          label: guideLabel("Start with a moderate per-task load"),
          value: (
            <Box padding={{ left: "l" }}>
              Begin with about <strong>200 virtual users or 200 requests per second per task</strong>. Use Amazon ECS
              task resource utilization metrics to tune subsequent runs for cost and performance.
            </Box>
          ),
        },
        {
          label: guideLabel("Scale traffic with task count"),
          value: (
            <Box padding={{ left: "l" }}>
              Each task runs the load defined by your test script. Increase the task count to increase total traffic.
            </Box>
          ),
        },
        {
          label: guideLabel("Set a safety duration"),
          value: (
            <Box padding={{ left: "l" }}>
              Choose a value longer than your script’s expected runtime. DLT automatically stops the test when it
              reaches this limit.
            </Box>
          ),
        },
        {
          label: guideLabel("Validate before scaling"),
          value: (
            <Box padding={{ left: "l" }}>
              Run a short test in one Region with one task to confirm the test starts, generates the expected traffic,
              and completes successfully.
            </Box>
          ),
        },
      ]}
    />
  </Container>
);
