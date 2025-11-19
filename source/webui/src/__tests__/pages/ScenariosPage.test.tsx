// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @fileoverview Unit tests for ScenariosPage component
 *
 * Tests the scenarios page functionality including:
 * - Empty state rendering when no scenarios are available
 * - Loading state display during API calls
 * - Successful data rendering with scenario count and details
 * - Error state handling when API calls fail
 * - Proper display of individual scenario information
 *
 * Uses MSW (Mock Service Worker) to mock API responses and tests
 * integration with Redux store and React Router.
 */

import { screen, waitForElementToBeRemoved, within } from "@testing-library/react";
import { renderAppContent } from "../test-utils.tsx";
import { generateTestScenarios } from "../test-data-factory.ts";
import { MOCK_SERVER_URL, server } from "../server.ts";
import { http } from "msw";
import { ApiEndpoints } from "../../store/solutionApi.ts";
import { ok } from "../../mocks/handlers.ts";
import { vi } from "vitest";

it("renders an empty scenarios page", async () => {
  // GIVEN the backend returns no scenarios
  server.use(http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS, async () => await ok({ Items: [] })));

  // WHEN rendering the /scenarios route
  renderAppContent({
    initialRoute: "/scenarios",
  });

  // THEN wait for loading to complete and check for empty table
  const withinMain = within(screen.getByTestId("main-content"));
  expect(await withinMain.findByText("Test Scenarios")).toBeInTheDocument();
  expect(await withinMain.findByText("(0)")).toBeInTheDocument();
});

it("renders scenarios page with loading state spinner", async () => {
  // GIVEN the backend is slow to respond
  server.use(
    http.get(
      MOCK_SERVER_URL + ApiEndpoints.SCENARIOS,
      async () => await ok({ Items: [] }, 1000) // 1 second delay
    )
  );

  // WHEN rendering the /scenarios route
  renderAppContent({
    initialRoute: "/scenarios",
  });

  // THEN expect to see loading indicator (no heading during loading)
  const withinMain = within(screen.getByTestId("main-content"));
  expect(await withinMain.findByText("Loading")).toBeInTheDocument();
});

it("renders scenarios page with scenarios data", async () => {
  // GIVEN the backend returns 3 scenarios
  const num_scenarios = 3;
  const scenarios = generateTestScenarios(num_scenarios);
  server.use(http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS, async () => await ok({ Items: scenarios })));

  // WHEN rendering the /scenarios route
  renderAppContent({
    initialRoute: "/scenarios",
  });

  // THEN wait for loading to complete and check for data
  const withinMain = within(screen.getByTestId("main-content"));
  expect(await withinMain.findByText("Test Scenarios")).toBeInTheDocument();
  expect(await withinMain.findByText("(3)")).toBeInTheDocument();
});

it("renders error with 'Failed' when API returns 500", async () => {
  // Suppress console.error for this test
  const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  // GIVEN the backend returns a 500 error
  server.use(
    http.get(
      MOCK_SERVER_URL + ApiEndpoints.SCENARIOS,
      () =>
        new Response(JSON.stringify({ error: "Internal Server Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
    )
  );

  // WHEN rendering the /scenarios route
  renderAppContent({
    initialRoute: "/scenarios",
  });

  // THEN expect to see error with "Failed" text (no heading during error state)
  const withinMain = within(screen.getByTestId("main-content"));
  expect(await withinMain.findByText(/Failed/)).toBeInTheDocument();

  // Restore console.error
  consoleSpy.mockRestore();
});

it("validates data exists in the table", async () => {
  // GIVEN the backend returns scenarios with specific data
  const scenarios = generateTestScenarios(2);
  server.use(http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS, async () => await ok({ Items: scenarios })));

  // WHEN rendering the /scenarios route
  renderAppContent({
    initialRoute: "/scenarios",
  });

  // THEN expect table to contain scenario data
  const withinMain = within(screen.getByTestId("main-content"));
  await waitForElementToBeRemoved(await withinMain.findByText("Loading"));

  const table = withinMain.getByRole("table");
  expect(within(table).getByText(scenarios[0].testName)).toBeInTheDocument();
  expect(within(table).getByText(scenarios[1].testName)).toBeInTheDocument();
});
