// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useGetScenariosQuery } from "../../store/scenariosApiSlice.ts";
import ScenariosContent from "./ScenariosContent.tsx";
import { usePageLoadMetric } from "../../hooks/usePageLoadMetric";
import { PageLoadingState, PageErrorState } from "../../components/common";

export default function ScenariosPage() {
  const { data, isLoading, isFetching, error, refetch } = useGetScenariosQuery();
  usePageLoadMetric("Scenarios", { dataReady: !isLoading && !error });
  const scenariosArray = data?.Items || [];
  const scenariosContent = <ScenariosContent scenarios={scenariosArray} refetch={refetch} isFetching={isFetching} />;

  if (isLoading) {
    return <PageLoadingState title="Test Scenarios" />;
  }

  if (error) {
    return (
      <PageErrorState
        title="Test Scenarios"
        message="Failed to load test scenarios"
        actions={[{ label: "Retry", onClick: refetch }]}
      />
    );
  }

  return scenariosContent;
}
