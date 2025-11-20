// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Container, ContentLayout, Header } from "@cloudscape-design/components";
import { Route, Routes } from "react-router-dom";
import Layout from "./Layout.tsx";
import IntroductionPage from "./pages/introduction/IntroductionPage.tsx";
import McpServerPage from "./pages/mcp-server/McpServerPage.tsx";
import CreateTestScenarioPage from "./pages/scenarios/CreateTestScenarioPage.tsx";
import ScenarioDetailsPage from "./pages/scenarios/ScenarioDetailsPage.tsx";
import ScenariosPage from "./pages/scenarios/ScenariosPage.tsx";
import TestRunDetailsPage from "./pages/scenarios/TestResultsDetailsPage.tsx";

export const AppRoutes = () => (
  <Routes>
    <Route path={"/*"} element={<Layout />}>
      <Route index element={<IntroductionPage />} />
      <Route path="scenarios" element={<ScenariosPage />} />
      <Route path="scenarios/:testId" element={<ScenarioDetailsPage />} />
      <Route path="scenarios/:testId/testruns/:testRunId" element={<TestRunDetailsPage />} />
      <Route path="create-scenario" element={<CreateTestScenarioPage />} />
      <Route path="mcp-server" element={<McpServerPage />} />
      {/* Add more child routes that use the same Layout here */}
      <Route
        path="*"
        element={
          <ContentLayout header={<Header>Error</Header>}>
            <Container header={<Header>Page not found 😿</Header>}></Container>
          </ContentLayout>
        }
      />
    </Route>
    {/* Add another set of routes with a different layout here */}
  </Routes>
);
