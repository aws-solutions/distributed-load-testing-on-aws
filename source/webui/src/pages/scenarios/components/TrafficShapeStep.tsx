// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Box,
  Button,
  Container,
  FormField,
  Grid,
  Header,
  Input,
  Link,
  Multiselect,
  Select,
  SpaceBetween,
  Table,
} from "@cloudscape-design/components";
import { useEffect } from "react";
import { useSelector } from "react-redux";
import { useGetRegionsQuery } from "../../../store/regionsSlice";
import { RootState } from "../../../store/store";
import { FormData } from "../types";
import { solutionApi } from "../../../store/solutionApi";
import { WARNING_THRESHOLDS } from "../constants";

interface RegionConfig {
  region: string;
  taskCount: string;
  concurrency: string;
}

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
}

const vCPUDetailsApi = solutionApi.injectEndpoints({
  endpoints: (builder) => ({
    getVCPUDetails: builder.query<any, void>({
      query: () => "/vCPUDetails",
    }),
  }),
});

export const { useGetVCPUDetailsQuery } = vCPUDetailsApi;

export const TrafficShapeStep = ({ formData, updateFormData, showValidationErrors = false }: Props) => {
  const regions: RegionConfig[] = formData.regions || [];

  const { isLoading } = useGetRegionsQuery();
  const { data: vCPUData } = useGetVCPUDetailsQuery();
  const regionsData = useSelector((state: RootState) => state.regions.data);
  const availableRegions = regionsData ?? [];

  // Auto-select region if only one region is available
  useEffect(() => {
    if (availableRegions.length === 1 && regions.length === 0) {
      updateFormData({
        regions: [
          {
            region: availableRegions[0],
            taskCount: "",
            concurrency: "",
          },
        ],
      });
    }
  }, [availableRegions, regions.length, updateFormData]);

  const selectedRegions = regions.map((r) => ({ label: r.region, value: r.region }));
  const regionOptions = availableRegions.map((region) => ({ label: region, value: region }));

  const handleRegionSelection = (selectedOptions: any[]) => {
    const newRegions = selectedOptions.map((option) => ({
      region: option.value,
      taskCount: "",
      concurrency: "",
    }));
    updateFormData({ regions: newRegions });
  };

  const updateRegion = (index: number, field: keyof RegionConfig, value: string) => {
    const updatedRegions = [...regions];
    updatedRegions[index] = { ...updatedRegions[index], [field]: value };
    updateFormData({ regions: updatedRegions });
  };

  const removeRegion = (index: number) => {
    const updatedRegions = regions.filter((_, i) => i !== index);
    updateFormData({ regions: updatedRegions });
  };

  return (
    <SpaceBetween direction="vertical" size="l">
      <Container
        header={
          <Header variant="h2" description="Define the traffic parameters for your load test">
            Multi-Region Traffic Configuration
          </Header>
        }
      >
        <SpaceBetween direction="vertical" size="m">
          <FormField
            label="Select Regions"
            errorText={
              regions.length > 5
                ? "Maximum 5 regions allowed"
                : showValidationErrors && regions.length === 0
                  ? "Please select at least one region"
                  : undefined
            }
          >
            <Multiselect
              selectedOptions={selectedRegions}
              onChange={({ detail }) => {
                if (detail.selectedOptions.length <= 5) {
                  handleRegionSelection([...detail.selectedOptions]);
                }
              }}
              options={regionOptions}
              placeholder="Choose regions"
              statusType={isLoading ? "loading" : undefined}
              invalid={showValidationErrors && regions.length === 0}
              inlineTokens
              loadingText="Loading deployed regions"
            />
          </FormField>
          {regions.map((region, index) => (
            <Container key={index}>
              <Grid gridDefinition={[{ colspan: 10 }, { colspan: 2 }]}>
                <Box>
                  <SpaceBetween direction="vertical" size="s">
                    <Header variant="h3" description="The region to launch the given task count and concurrency">
                      {region.region}
                    </Header>

                    <FormField
                      label="Task Count"
                      description="Number of containers that will be launched in the Fargate cluster to run the test scenario. Additional tasks will not be created once the account limit on Fargate resources has been reached."
                      errorText={
                        showValidationErrors && !region.taskCount
                          ? "Task count is required"
                          : showValidationErrors && Number(region.taskCount) < 1
                            ? "Task count must be ≥1"
                            : undefined
                      }
                      warningText={
                        region.taskCount && Number(region.taskCount) > WARNING_THRESHOLDS.TASK_COUNT ? (
                          <>
                            Task count exceeds recommended limit of {WARNING_THRESHOLDS.TASK_COUNT}. This may exceed
                            account limits. Refer to{" "}
                            <Link
                              external
                              href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/determine-number-of-users.html"
                            >
                              Implementation Guide
                            </Link>{" "}
                            for more details.
                          </>
                        ) : undefined
                      }
                    >
                      <Input
                        value={region.taskCount || ""}
                        onChange={({ detail }) => updateRegion(index, "taskCount", detail.value)}
                        invalid={
                          !!(showValidationErrors && !region.taskCount) ||
                          !!(region.taskCount && Number(region.taskCount) < 1)
                        }
                        type="number"
                      />
                    </FormField>

                    <FormField
                      label="Concurrency"
                      description="The number of concurrent virtual users generated per task. The recommended limit based on default settings is 200 virtual users. Concurrency is limited by CPU and Memory."
                      errorText={
                        showValidationErrors && !region.concurrency
                          ? "Concurrency is required"
                          : region.concurrency && Number(region.concurrency) < 1
                            ? "Concurrency must be ≥1"
                            : undefined
                      }
                      warningText={
                        region.concurrency && Number(region.concurrency) > WARNING_THRESHOLDS.CONCURRENCY ? (
                          <>
                            Concurrency exceeds recommended limit of {WARNING_THRESHOLDS.CONCURRENCY}. This may impact
                            performance or cause resource constraints. Refer to{" "}
                            <Link
                              external
                              href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/determine-number-of-users.html"
                            >
                              Implementation Guide
                            </Link>{" "}
                            for more details.
                          </>
                        ) : undefined
                      }
                    >
                      <Input
                        value={region.concurrency || ""}
                        onChange={({ detail }) => updateRegion(index, "concurrency", detail.value)}
                        invalid={
                          !!(showValidationErrors && !region.concurrency) ||
                          !!(region.concurrency && Number(region.concurrency) < 1)
                        }
                        type="number"
                      />
                    </FormField>
                  </SpaceBetween>
                </Box>

                <Box textAlign="right">
                  <Button variant="normal" onClick={() => removeRegion(index)}>
                    Remove
                  </Button>
                </Box>
              </Grid>
            </Container>
          ))}

          {availableRegions.length > 0 && (
            <Container
              header={
                <Header variant="h3" description="Available Containers and Concurrency per Region">
                  Table of Available Tasks
                </Header>
              }
            >
              <Table
                columnDefinitions={[
                  {
                    id: "region",
                    header: "Region",
                    cell: (item: any) => item.region,
                  },
                  {
                    id: "vCPUsPerTask",
                    header: "vCPUs per Task",
                    cell: (item: any) => vCPUData?.[item.region]?.vCPUsPerTask || "-",
                  },
                  {
                    id: "vCPULimit",
                    header: "DLT Task Limit",
                    cell: (item: any) => {
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
                    cell: (item: any) => {
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
            </Container>
          )}
        </SpaceBetween>
      </Container>

      <Container
        header={
          <Header variant="h2" description="Define how long your load test will run">
            Test Duration
          </Header>
        }
      >
        <SpaceBetween direction="vertical" size="m">
          <FormField
            label="Ramp Up"
            description="The time to reach target concurrency"
            errorText={showValidationErrors && !formData.rampUpValue ? "Ramp up time is required" : undefined}
          >
            <Grid disableGutters gridDefinition={[{ colspan: 3 }, { colspan: 6 }]}>
              <Box padding={"xxs"}>
                <Input
                  value={formData.rampUpValue || ""}
                  onChange={({ detail }) => updateFormData({ rampUpValue: detail.value })}
                  invalid={showValidationErrors && !formData.rampUpValue}
                  type="number"
                />
              </Box>
              <Box padding={"xxs"}>
                <Select
                  selectedOption={{ label: formData.rampUpUnit || "minutes", value: formData.rampUpUnit || "minutes" }}
                  onChange={({ detail }) => updateFormData({ rampUpUnit: detail.selectedOption.value })}
                  options={[
                    { label: "seconds", value: "seconds" },
                    { label: "minutes", value: "minutes" },
                  ]}
                />
              </Box>
            </Grid>
          </FormField>

          <FormField
            label="Hold For"
            description="The duration to maintain target load"
            errorText={showValidationErrors && !formData.holdForValue ? "Hold for time is required" : undefined}
          >
            <Grid disableGutters gridDefinition={[{ colspan: 3 }, { colspan: 6 }]}>
              <Box padding={"xxs"}>
                <Input
                  value={formData.holdForValue || ""}
                  onChange={({ detail }) => updateFormData({ holdForValue: detail.value })}
                  invalid={showValidationErrors && !formData.holdForValue}
                  type="number"
                />
              </Box>
              <Box padding={"xxs"}>
                <Select
                  selectedOption={{
                    label: formData.holdForUnit || "minutes",
                    value: formData.holdForUnit || "minutes",
                  }}
                  onChange={({ detail }) => updateFormData({ holdForUnit: detail.selectedOption.value })}
                  options={[
                    { label: "seconds", value: "seconds" },
                    { label: "minutes", value: "minutes" },
                  ]}
                />
              </Box>
            </Grid>
          </FormField>
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
};
