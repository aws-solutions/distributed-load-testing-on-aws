// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useGetScenariosQuery } from "../../store/scenariosApiSlice.ts";
import { Alert, StatusIndicator } from "@cloudscape-design/components";
import ScenariosContent from "./ScenariosContent.tsx";

export default function ScenariosPage() {
  const { data, isLoading, error } = useGetScenariosQuery();
  const scenariosArray = data?.Items || [];
  const scenariosContent = <ScenariosContent scenarios={scenariosArray} />;

  if (isLoading) {
    return <StatusIndicator type={isLoading ? "loading" : "error"}>Loading</StatusIndicator>;
  }

  if (error) {
    return <Alert type="error">Failed to load test scenarios</Alert>;
  }

  return scenariosContent;
}
