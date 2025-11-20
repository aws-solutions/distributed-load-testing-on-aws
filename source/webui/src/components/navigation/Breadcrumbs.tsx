// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { BreadcrumbGroup } from "@cloudscape-design/components";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useGetScenarioDetailsQuery, useGetTestRunDetailsQuery } from "../../store/scenariosApiSlice";
import { createBreadcrumbs } from "./create-breadcrumbs.ts";

export const Breadcrumbs = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;
  const { testId, testRunId } = useParams<{ testId: string; testRunId: string }>();
  
  // Fetch scenario name for /scenario/{testId} endpoints in order to display scenario name in breadcrumb
  const { data: scenario } = useGetScenarioDetailsQuery(
    { testId: testId || "" },
    { skip: !testId }
  );
  
  // Fetch test run for /scenario/{testId}/testruns/{testRunId} endpoints in order to display test run date in breadcrumb
  const { data: testRun } = useGetTestRunDetailsQuery(
    { testId: testId || "", testRunId: testRunId || "" },
    { skip: !testId || !testRunId }
  );

  // Only use scenario name when we're actually on a scenario route
  const isScenarioRoute = path.includes('/scenarios/');
  const scenarioName = isScenarioRoute ? scenario?.testName : undefined;
  
  const breadCrumbItems = createBreadcrumbs(
    path, 
    scenarioName, 
    testRunId,
    testId,
    testRun?.startTime
  );

  return (
    <BreadcrumbGroup
      onFollow={function (e: CustomEvent) {
        e.preventDefault();
        navigate(e.detail.href);
      }}
      items={breadCrumbItems}
    />
  );
};
