// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Multi-region traffic configuration. A single table lists every deployed
// region with native multi-row selection; selecting a region's row includes it
// in the load test and enables its per-region task count / concurrency inputs.
// Incompatible regions are disabled and greyed out.

import { Box, FormField, Input, Link, SpaceBetween, StatusIndicator, Table } from "@cloudscape-design/components";
import { ReactElement, useEffect, useMemo } from "react";
import { useSelector } from "react-redux";
import { RegionalStackInfo, useGetRegionsQuery } from "../../../store/regionsSlice";
import { RootState } from "../../../store/store";
import { VALIDATION_LIMITS, WARNING_THRESHOLDS } from "../constants";
import { FormData, RegionConfig } from "../types";
import { getRegionName } from "../../../utils/regions";
import { FormSection } from "./FormSection";
import { SECTION_IDS } from "../utils/scenarioValidation";
import "./MultiRegionConfigSection.css";

interface RegionRow {
  region: string;
  incompatible: boolean;
}

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
}

const taskCountError = (region: RegionConfig, showValidationErrors: boolean) =>
  showValidationErrors && !region.taskCount
    ? "Task count is required"
    : region.taskCount && Number(region.taskCount) < VALIDATION_LIMITS.TASK_COUNT.MIN
      ? `Task count must be ≥${VALIDATION_LIMITS.TASK_COUNT.MIN}`
      : undefined;

const concurrencyError = (region: RegionConfig, showValidationErrors: boolean) =>
  showValidationErrors && !region.concurrency
    ? "Concurrency is required"
    : region.concurrency && Number(region.concurrency) < VALIDATION_LIMITS.CONCURRENCY.MIN
      ? `Concurrency must be ≥${VALIDATION_LIMITS.CONCURRENCY.MIN}`
      : undefined;

const thresholdWarning = (value: string, limit: number, kind: string) =>
  value && Number(value) > limit ? (
    <>
      {kind} exceeds recommended limit of {limit}. Refer to{" "}
      <Link
        external
        href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/determine-number-of-users.html"
      >
        Implementation Guide
      </Link>{" "}
      for more details.
    </>
  ) : undefined;

const regionLabel = (region: string) => {
  const name = getRegionName(region);
  return name === region ? region : `${region} — ${name}`;
};

export const MultiRegionConfigSection = ({ formData, updateFormData, showValidationErrors = false }: Props) => {
  const regions: RegionConfig[] = formData.regions || [];

  const { isLoading } = useGetRegionsQuery();
  const regionsData = useSelector((state: RootState) => state.regions.regionNames);
  const regionalStacks = useSelector((state: RootState) => state.regions.regionalStacks);
  const availableRegions = regionsData ?? [];

  const incompatibleRegions = useMemo(
    () =>
      new Set(
        (regionalStacks ?? []).filter((s: RegionalStackInfo) => !s.compatible).map((s: RegionalStackInfo) => s.region)
      ),
    [regionalStacks]
  );

  const items: RegionRow[] = availableRegions.map((region) => ({
    region,
    incompatible: incompatibleRegions.has(region),
  }));

  const configByRegion = useMemo(() => new Map(regions.map((r) => [r.region, r])), [regions]);

  // Auto-select region if only one compatible region is available
  useEffect(() => {
    const compatibleRegions = availableRegions.filter((r) => !incompatibleRegions.has(r));
    if (compatibleRegions.length === 1 && regions.length === 0) {
      updateFormData({ regions: [{ region: compatibleRegions[0], taskCount: "", concurrency: "" }] });
    }
  }, [availableRegions, incompatibleRegions, regions.length, updateFormData]);

  // Reconcile the table's selected rows back into form regions, preserving the
  // task count / concurrency already entered for regions that stay selected.
  const onSelectionChange = (selected: RegionRow[]) => {
    updateFormData({
      regions: selected.map(
        (item) => configByRegion.get(item.region) ?? { region: item.region, taskCount: "", concurrency: "" }
      ),
    });
  };

  const updateRegion = (region: string, field: keyof RegionConfig, value: string) => {
    updateFormData({ regions: regions.map((r) => (r.region === region ? { ...r, [field]: value } : r)) });
  };

  const atCap = regions.length >= VALIDATION_LIMITS.MAX_REGIONS;

  const isDisabled = (item: RegionRow) => item.incompatible || (!configByRegion.has(item.region) && atCap);

  const selectedItems = items.filter((item) => configByRegion.has(item.region));

  // Toggle a region when its row is clicked. Mirrors the native selection
  // checkbox so the whole row is a click target, not just the checkbox.
  const onRowClick = (item: RegionRow) => {
    if (isDisabled(item)) return;
    onSelectionChange(
      configByRegion.has(item.region) ? selectedItems.filter((s) => s.region !== item.region) : [...selectedItems, item]
    );
  };

  // Stop row clicks on the input cells so editing a value doesn't toggle the row.
  const stopRowToggle = (cell: ReactElement) => <div onClick={(e) => e.stopPropagation()}>{cell}</div>;

  const renderRegion = (item: RegionRow) =>
    item.incompatible ? (
      <SpaceBetween direction="horizontal" size="xs">
        <Box color="text-status-inactive">{regionLabel(item.region)}</Box>
        <StatusIndicator type="warning">Incompatible — update regional stack</StatusIndicator>
      </SpaceBetween>
    ) : (
      regionLabel(item.region)
    );

  const renderTaskCount = (item: RegionRow) => {
    const config = configByRegion.get(item.region);
    return (
      <FormField
        errorText={config && taskCountError(config, showValidationErrors)}
        warningText={config && thresholdWarning(config.taskCount, WARNING_THRESHOLDS.TASK_COUNT, "Task count")}
      >
        <Input
          data-cy={`task-count-input-${item.region}`}
          value={config?.taskCount || ""}
          onChange={({ detail }) => updateRegion(item.region, "taskCount", detail.value)}
          invalid={!!config && !!taskCountError(config, showValidationErrors)}
          disabled={!config}
          type="number"
        />
      </FormField>
    );
  };

  const renderConcurrency = (item: RegionRow) => {
    const config = configByRegion.get(item.region);
    return (
      <FormField
        errorText={config && concurrencyError(config, showValidationErrors)}
        warningText={config && thresholdWarning(config.concurrency, WARNING_THRESHOLDS.CONCURRENCY, "Concurrency")}
      >
        <Input
          data-cy={`concurrency-input-${item.region}`}
          value={config?.concurrency || ""}
          onChange={({ detail }) => updateRegion(item.region, "concurrency", detail.value)}
          invalid={!!config && !!concurrencyError(config, showValidationErrors)}
          disabled={!config}
          type="number"
        />
      </FormField>
    );
  };

  return (
    <FormSection
      sectionId={SECTION_IDS.MULTI_REGION}
      headerText="Multi-Region Traffic Configuration"
      headerDescription="Define the traffic parameters for your load test"
    >
      <SpaceBetween direction="vertical" size="xs">
        <Box variant="p" color="text-body-secondary">
          Enable the regions to include in your load test, then set the number of tasks and concurrent users for each.
          Task count determines the number of Fargate containers launched; concurrent users sets the number of virtual
          users per container. Enable between 1 and {VALIDATION_LIMITS.MAX_REGIONS} regions.
        </Box>
        {showValidationErrors && regions.length === 0 && (
          <StatusIndicator type="error">Please select at least one region</StatusIndicator>
        )}
        <div className="region-table">
          <Table
            variant="embedded"
            items={items}
            loading={isLoading}
            loadingText="Loading deployed regions"
            empty="No deployed regions available"
            selectionType="multi"
            trackBy="region"
            selectedItems={selectedItems}
            onSelectionChange={({ detail }) => onSelectionChange(detail.selectedItems)}
            onRowClick={({ detail }) => onRowClick(detail.item)}
            isItemDisabled={isDisabled}
            ariaLabels={{
              itemSelectionLabel: (_data, item) => `Include ${item.region}`,
              selectionGroupLabel: "Regions to include",
            }}
            columnDefinitions={[
              { id: "region", header: "Region", cell: renderRegion },
              { id: "taskCount", header: "Number of tasks", cell: (item) => stopRowToggle(renderTaskCount(item)) },
              { id: "concurrency", header: "Concurrent users", cell: (item) => stopRowToggle(renderConcurrency(item)) },
            ]}
          />
        </div>
        {atCap && (
          <Box variant="small" color="text-status-warning">
            Maximum of {VALIDATION_LIMITS.MAX_REGIONS} regions reached. Deselect a region to choose another.
          </Box>
        )}
      </SpaceBetween>
    </FormSection>
  );
};
