// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Multi-region traffic configuration. A single table lists every deployed
// region with native multi-row selection; selecting a region's row includes it
// in the load test and enables its per-region task count / concurrency inputs.
// Incompatible regions are disabled and greyed out.

import { Box, FormField, Input, Link, SpaceBetween, StatusIndicator, Table } from "@cloudscape-design/components";
import { useEffect, useMemo } from "react";
import { useSelector } from "react-redux";
import { RegionalStackInfo, useGetRegionsQuery } from "../../../store/regionsSlice";
import { RootState } from "../../../store/store";
import { getRegionName } from "../../../utils/regions";
import { TestMode, VALIDATION_LIMITS, WARNING_THRESHOLDS } from "../constants";
import { useFieldReveal } from "../hooks/useFieldReveal";
import { availableTasksDisplay, taskLimitDisplay, useGetVCPUDetailsQuery } from "../hooks/useVCPUDetails";
import { FormData, RegionConfig } from "../types";
import { concurrencyError, healthyThresholdError, SECTION_IDS, taskCountError } from "../utils/scenarioValidation";
import { FormSection } from "./FormSection";
import { InfoLink } from "../../../help";
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

const thresholdWarning = (value: string, limit: number, kind: string) =>
  value && Number(value) > limit ? (
    <>
      {kind} exceeds recommended limit of {limit}. Refer to{" "}
      <Link
        external
        href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/determine-number-of-users.html"
        // Stop the click from bubbling to the row's onRowClick, which would
        // deselect the region and discard its entered task count / virtual users.
        nativeAttributes={{ onClick: (event) => event.stopPropagation() }}
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
  const isNativeMode = formData.testMode === TestMode.NATIVE;

  // Per-region inputs are keyed "<region>:<field>" so each has its own reveal.
  const { markTouched, isRevealed } = useFieldReveal(showValidationErrors);

  const { isLoading } = useGetRegionsQuery();
  // Available-tasks capacity per region (standard mode only) — folded in from the
  // former standalone Regional Task Availability section.
  const { data: vCPUData } = useGetVCPUDetailsQuery();
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
    const error = config && taskCountError(config.taskCount, isRevealed(`${item.region}:taskCount`));
    return (
      <FormField
        errorText={error}
        warningText={config && thresholdWarning(config.taskCount, WARNING_THRESHOLDS.TASK_COUNT, "Task count")}
      >
        <Input
          data-cy={`task-count-input-${item.region}`}
          ariaLabel={`Tasks for ${item.region}`}
          value={config?.taskCount || ""}
          onChange={({ detail }) => updateRegion(item.region, "taskCount", detail.value)}
          onBlur={() => markTouched(`${item.region}:taskCount`)}
          nativeInputAttributes={{ onClick: (event) => event.stopPropagation() }}
          invalid={!!error}
          disabled={!config}
          type="text"
          inputMode="numeric"
        />
      </FormField>
    );
  };

  const renderConcurrency = (item: RegionRow) => {
    const config = configByRegion.get(item.region);
    // Native scripts define their own virtual users, so the field is read-only
    // and shows a placeholder rather than accepting input.
    if (isNativeMode) {
      return (
        <Input
          ariaLabel={`Traffic (virtual users) for ${item.region}`}
          value=""
          placeholder="Defined by script"
          onChange={() => {}}
          disabled
        />
      );
    }
    const error = config && concurrencyError(config.concurrency, isRevealed(`${item.region}:concurrency`));
    return (
      <FormField
        errorText={error}
        warningText={config && thresholdWarning(config.concurrency, WARNING_THRESHOLDS.CONCURRENCY, "Concurrency")}
      >
        <Input
          data-cy={`concurrency-input-${item.region}`}
          ariaLabel={`Traffic (virtual users) for ${item.region}`}
          value={config?.concurrency || ""}
          onChange={({ detail }) => updateRegion(item.region, "concurrency", detail.value)}
          onBlur={() => markTouched(`${item.region}:concurrency`)}
          nativeInputAttributes={{ onClick: (event) => event.stopPropagation() }}
          invalid={!!error}
          disabled={!config}
          type="text"
          inputMode="numeric"
        />
      </FormField>
    );
  };

  const regionTable = (
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
          // Read-only capacity is shown before the inputs so users size Tasks
          // against the Available headroom on the same row.
          {
            id: "taskLimit",
            header: "Task Limit",
            cell: (item: RegionRow) => taskLimitDisplay(vCPUData?.[item.region]),
          },
          {
            id: "availableTasks",
            header: "Available",
            cell: (item: RegionRow) => availableTasksDisplay(vCPUData?.[item.region]),
          },
          { id: "taskCount", header: "Tasks", cell: renderTaskCount },
          // In native mode the Traffic cell is read-only ("Defined by script")
          // since the script sets the virtual users.
          { id: "concurrency", header: "Traffic (virtual users)", cell: renderConcurrency },
        ]}
      />
    </div>
  );

  const selectError = showValidationErrors && regions.length === 0 && (
    <StatusIndicator type="error">Please select at least one region</StatusIndicator>
  );

  const capMessage = atCap && (
    <Box variant="small" color="text-status-warning">
      Maximum of {VALIDATION_LIMITS.MAX_REGIONS} regions reached. Deselect a region to choose another.
    </Box>
  );

  // Healthy threshold is a global run gate (not per-region), rendered below the
  // table in both modes.
  const thresholdError = healthyThresholdError(formData.healthyThreshold, isRevealed("healthyThreshold"));
  const healthyThresholdField = (
    <FormField
      label="Healthy threshold (%)"
      description="Prevents tests from running to completion when tasks fail to start, avoiding misleading results from partial load."
      constraintText="0–100. Default: 90"
      errorText={thresholdError}
    >
      <Input
        data-cy="healthy-threshold-input"
        type="text"
        inputMode="numeric"
        value={formData.healthyThreshold}
        onChange={({ detail }) => updateFormData({ healthyThreshold: detail.value })}
        onBlur={() => markTouched("healthyThreshold")}
        invalid={!!thresholdError}
      />
    </FormField>
  );

  // Both modes share the same columns and capacity guidance. The only difference
  // is the Traffic column: editable in standard mode, read-only ("Defined by
  // script") in native mode, where the script owns the virtual-user count.
  return (
    <FormSection
      sectionId={SECTION_IDS.MULTI_REGION}
      headerText="Multi-region traffic configuration"
      headerDescription="Define the traffic parameters for your load test"
    >
      <SpaceBetween direction="vertical" size="m">
        <Box variant="p" color="text-body-secondary">
          {isNativeMode
            ? "Enable the regions to include in your load test, then set the number of tasks for each. Task count determines the number of Fargate containers launched; your script sets the number of virtual users per container. "
            : "Enable the regions to include in your load test, then set the number of tasks and virtual users for each. Task count determines the number of Fargate containers launched; virtual users sets how many run in each container. "}
          Enable between 1 and {VALIDATION_LIMITS.MAX_REGIONS} regions. The availability columns show current Fargate
          capacity per region. <InfoLink topicId="regional-availability" text="Task availability info" />
        </Box>
        {selectError}
        {regionTable}
        <Box variant="small" color="text-body-secondary">
          Each task uses 2 vCPUs. Task limits and availability reflect current Fargate capacity.
        </Box>
        {capMessage}
        {healthyThresholdField}
      </SpaceBetween>
    </FormSection>
  );
};
