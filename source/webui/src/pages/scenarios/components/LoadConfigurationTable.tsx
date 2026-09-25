// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Box, Container, Header, SpaceBetween, Table, TableProps } from "@cloudscape-design/components";
import { TRAFFIC_SHAPE_LABELS } from "@amzn/dlt-common/traffic-shape";
import { fromSeconds } from "../utils/duration";

/** Per-region load config row. Accepts string or number fields (scenario config vs run details). */
export type LoadConfigRegion = { region: string; taskCount?: number | string; concurrency?: number | string };

interface LoadConfigurationTableProps {
  configs: LoadConfigRegion[];
  /** Presence marks a native run; native runs are duration-driven with no per-user concurrency. */
  nativeRunMode?: { maxTestDurationSeconds?: number | string } | null;
  rampUp: string;
  holdFor: string;
  /** Optional healthy-threshold %, appended to the summary when provided. */
  threshold?: number;
  emptyText: string;
}

/**
 * Shared "Load Configuration" section for the Scenario Details and Test Run Details
 * pages. Native runs are duration-driven and have no per-user concurrency (payload
 * uses a placeholder of 1), so for them the summary reports max duration and the
 * table/footer drop the Concurrent Users and Total VUs columns.
 */
export function LoadConfigurationTable({
  configs,
  nativeRunMode,
  rampUp,
  holdFor,
  threshold,
  emptyText,
}: Readonly<LoadConfigurationTableProps>) {
  const isNativeMode = !!nativeRunMode;

  const maxDurationLabel = () => {
    const seconds = Number(nativeRunMode?.maxTestDurationSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return "-";
    const { value, unit } = fromSeconds(seconds);
    return `${value} ${unit}`;
  };

  const regionVUs = (config: LoadConfigRegion) => (Number(config.taskCount) || 0) * (Number(config.concurrency) || 0);
  const totalTasks = configs.reduce((sum, config) => sum + (Number(config.taskCount) || 0), 0);
  const totalVUs = configs.reduce((sum, config) => sum + regionVUs(config), 0);

  const thresholdPart = threshold === undefined ? "" : ` · ${threshold}% healthy threshold`;
  // Both branches name their mode, and both take the name from the shared module
  // so this summary cannot drift from the rest of the console. Naming only Native
  // would leave every existing customer's runs unlabeled, with no signal that
  // Standard is the mode they have been using since before v4.3.0.
  //
  // Native keeps its trailing "Mode" word: that phrasing shipped before v4.3.0 and
  // the acceptance criteria marks this summary "(No change)", so only the Standard
  // branch is new. The rendered Native text is byte-identical to what it was.
  const configSummary = isNativeMode
    ? `${TRAFFIC_SHAPE_LABELS.native} Mode · ${maxDurationLabel()} max duration${thresholdPart}`
    : `${TRAFFIC_SHAPE_LABELS.standard} · ${rampUp} ramp-up · ${holdFor} hold${thresholdPart} · ${totalVUs.toLocaleString()} virtual users`;

  const columnDefinitions: TableProps.ColumnDefinition<LoadConfigRegion>[] = [
    { id: "region", header: "Region", cell: (item) => item.region },
    { id: "taskCount", header: "Tasks", cell: (item) => item.taskCount },
    ...(isNativeMode
      ? []
      : [
          { id: "concurrency", header: "Concurrent Users", cell: (item: LoadConfigRegion) => item.concurrency },
          { id: "totalVUs", header: "Total VUs", cell: (item: LoadConfigRegion) => regionVUs(item).toLocaleString() },
        ]),
  ];

  return (
    <Container header={<Header variant="h2" description={configSummary}>Load Configuration</Header>}>
      <Table
        variant="embedded"
        items={configs}
        columnDefinitions={columnDefinitions}
        empty={emptyText}
        footer={
          totalTasks > 0 ? (
            <SpaceBetween direction="horizontal" size="l">
              <span>
                <Box variant="awsui-key-label" display="inline">
                  Total tasks:{" "}
                </Box>
                {totalTasks.toLocaleString()}
              </span>
              {!isNativeMode && (
                <span>
                  <Box variant="awsui-key-label" display="inline">
                    Total VUs:{" "}
                  </Box>
                  {totalVUs.toLocaleString()}
                </span>
              )}
            </SpaceBetween>
          ) : undefined
        }
      />
    </Container>
  );
}
