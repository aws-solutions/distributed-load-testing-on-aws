// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Read-only table of available Fargate tasks per region (FR-1.4).
// Extracted from the former TrafficShapeStep.

import { Table } from "@cloudscape-design/components";
import { useSelector } from "react-redux";
import { RootState } from "../../../store/store";
import { FormSection } from "./FormSection";
import { useGetVCPUDetailsQuery } from "../hooks/useVCPUDetails";
import { SECTION_IDS } from "../utils/scenarioValidation";

export const RegionalTaskAvailabilitySection = () => {
  const { data: vCPUData } = useGetVCPUDetailsQuery();
  const regionsData = useSelector((state: RootState) => state.regions.regionNames);
  const availableRegions = regionsData ?? [];

  if (availableRegions.length === 0) return null;

  return (
    <FormSection
      sectionId={SECTION_IDS.REGIONAL_AVAILABILITY}
      headerText="Regional Task Availability"
      headerDescription="Available containers and concurrency per region"
    >
      <Table
        columnDefinitions={[
          {
            id: "region",
            header: "Region",
            cell: (item: { region: string }) => item.region,
          },
          {
            id: "vCPUsPerTask",
            header: "vCPUs per Task",
            cell: (item: { region: string }) => vCPUData?.[item.region]?.vCPUsPerTask || "-",
          },
          {
            id: "vCPULimit",
            header: "DLT Task Limit",
            cell: (item: { region: string }) => {
              const limit = vCPUData?.[item.region]?.vCPULimit;
              const perTask = vCPUData?.[item.region]?.vCPUsPerTask;
              if (limit && perTask) {
                const taskLimit = Math.floor(limit / perTask);
                return isNaN(taskLimit) ? "ERROR" : taskLimit;
              }
              return "-";
            },
          },
          {
            id: "availableTasks",
            header: "Available DLT Tasks",
            cell: (item: { region: string }) => {
              const limit = vCPUData?.[item.region]?.vCPULimit;
              const perTask = vCPUData?.[item.region]?.vCPUsPerTask;
              const inUse = vCPUData?.[item.region]?.vCPUsInUse;
              if (limit && perTask && inUse !== undefined) {
                const available = Math.floor((limit - inUse) / perTask);
                return isNaN(available) ? "ERROR" : Math.max(0, available);
              }
              return "-";
            },
          },
        ]}
        items={availableRegions.map((region) => ({ region }))}
        empty="No regional data available"
        variant="embedded"
      />
    </FormSection>
  );
};
