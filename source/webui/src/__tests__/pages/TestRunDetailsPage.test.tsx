// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { ok } from "../../mocks/handlers";
import { ApiEndpoints } from "../../store/solutionApi";
import { MOCK_SERVER_URL, server } from "../server";
import { generateMockTestRunDetails } from "../test-data-factory";
import { renderAppContent } from "../test-utils";
import type { FrameworkExitSummary } from "../../pages/scenarios/types/testResults";

const ROUTE = "/scenarios/MockTestId123/testruns/MockRunId456";

const makeFrameworkExitSummary = (entryCount: number): FrameworkExitSummary => {
  const top = Array.from({ length: entryCount }, (_, index) => ({
    framework: "k6" as const,
    exitCode: 90 + index,
    message: `framework message ${index + 1}`,
    count: index + 1,
  }));
  return {
    totalCount: top.reduce((sum, entry) => sum + entry.count, 0),
    artifactKey: "results/MockTestId123/ts_MockRunId456/framework-exits/framework-exits.jsonl",
    top,
  };
};

describe("TestRunDetailsPage", () => {
  it("renders test run details with tabs", async () => {
    renderAppContent({ initialRoute: ROUTE });

    expect(await screen.findByText("Test Run Results")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Errors" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Artifacts" })).toBeInTheDocument();
  });

  it("renders old test runs without a framework-exit warning", async () => {
    renderAppContent({ initialRoute: ROUTE });

    await screen.findByText("Test Run Results");
    expect(screen.queryByText(/reported errors in/)).not.toBeInTheDocument();
  });

  it.each([1, 2, 3])("shows a complete run's total and %i most frequent framework exits", async (entryCount) => {
    const frameworkExitSummary = makeFrameworkExitSummary(entryCount);
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns/:testRunId", () =>
        ok({ ...generateMockTestRunDetails(), frameworkExitSummary })
      )
    );

    renderAppContent({ initialRoute: ROUTE });

    const warningHeader = await screen.findByText(
      new RegExp(`^${frameworkExitSummary.top[0].framework} reported errors in`)
    );
    expect(warningHeader).toHaveTextContent(
      `${frameworkExitSummary.top[0].framework} reported errors in ${frameworkExitSummary.totalCount} task${frameworkExitSummary.totalCount === 1 ? "" : "s"}`
    );
    expect(screen.queryByText("Most Common Failures")).not.toBeInTheDocument();
    for (const entry of frameworkExitSummary.top) {
      expect(screen.getByText(new RegExp(`^${entry.count} tasks?`)).parentElement).toHaveTextContent(
        `${entry.count} ${entry.count === 1 ? "task" : "tasks"} · Exit Code ${entry.exitCode}`
      );
      expect(screen.getByText(String(entry.exitCode), { selector: "code" })).toBeInTheDocument();
      expect(screen.getByText(entry.message, { selector: "pre" })).toBeInTheDocument();
    }
  });

  it("labels the displayed failures as most common when additional failures are omitted", async () => {
    const frameworkExitSummary = makeFrameworkExitSummary(3);
    frameworkExitSummary.totalCount += 1;
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns/:testRunId", () =>
        ok({ ...generateMockTestRunDetails(), frameworkExitSummary })
      )
    );

    renderAppContent({ initialRoute: ROUTE });

    expect(await screen.findByText("Most Common Failures")).toBeInTheDocument();
  });

  it.each(["running", "cancelled"] as const)("does not show framework exits for a %s run", async (status) => {
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns/:testRunId", () =>
        ok({
          ...generateMockTestRunDetails(),
          status,
          frameworkExitSummary: makeFrameworkExitSummary(1),
        })
      )
    );

    renderAppContent({ initialRoute: ROUTE });

    expect(await screen.findByText("Test Run Results")).toBeInTheDocument();
    expect(screen.queryByText(/reported errors in/)).not.toBeInTheDocument();
  });

  it("renders a negative non-zero exit code without interpreting it", async () => {
    const frameworkExitSummary = makeFrameworkExitSummary(1);
    frameworkExitSummary.top[0].exitCode = -1;
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns/:testRunId", () =>
        ok({ ...generateMockTestRunDetails(), frameworkExitSummary })
      )
    );

    renderAppContent({ initialRoute: ROUTE });

    expect(await screen.findByText("-1", { selector: "code" })).toBeInTheDocument();
  });

  it("opens and scrolls to the Artifacts tab from the framework-exit warning", async () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns/:testRunId", () =>
        ok({
          ...generateMockTestRunDetails(),
          frameworkExitSummary: makeFrameworkExitSummary(1),
        })
      )
    );

    renderAppContent({ initialRoute: ROUTE });

    await userEvent.click(await screen.findByRole("button", { name: "View full report" }));
    expect(screen.getByRole("tab", { name: "Artifacts" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" })
    );
  });

  it("titles the page with the scenario name", async () => {
    renderAppContent({ initialRoute: ROUTE });

    // "testname01" is the scenario name in the mocked scenario details response.
    expect(await screen.findByRole("heading", { level: 1, name: /testname01/ })).toBeInTheDocument();
  });

  it("shows the run start time and status in the header", async () => {
    renderAppContent({ initialRoute: ROUTE });

    // The mock run starts 2025-09-27 and is complete. The formatted time is
    // timezone-dependent, so assert on the date parts that do not shift.
    expect(await screen.findByText(/^Started .*2025/)).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("does not render a redundant Back to Scenario button", async () => {
    renderAppContent({ initialRoute: ROUTE });

    await screen.findByText("Test Run Results");
    expect(screen.queryByRole("button", { name: "Back to Scenario" })).not.toBeInTheDocument();
  });

  it("renders the dashboard immediately, without requiring a row click", async () => {
    renderAppContent({ initialRoute: ROUTE });

    expect(await screen.findByText("Test Run Metrics Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Overall performance metrics across all endpoints")).toBeInTheDocument();
    expect(screen.queryByText("Select a test result row to view detailed metrics")).not.toBeInTheDocument();
  });

  it("falls back to the dashboard empty state when the run has no results to aggregate", async () => {
    // transformToOverall returns no rows without label data, so there is nothing to
    // pre-select — the page must still render rather than break.
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns/:testRunId", () =>
        ok({ ...generateMockTestRunDetails(), results: {} })
      )
    );

    renderAppContent({ initialRoute: ROUTE });

    await waitFor(() => {
      expect(screen.getByText("Select a test result row to view detailed metrics")).toBeInTheDocument();
    });
  });

  it("surfaces the failure reason for a failed run", async () => {
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns/:testRunId", () =>
        ok({
          ...generateMockTestRunDetails(),
          status: "failed",
          errorReason: "Task provisioning timed out",
          frameworkExitSummary: makeFrameworkExitSummary(1),
        })
      )
    );

    renderAppContent({ initialRoute: ROUTE });

    expect(await screen.findByText("Task provisioning timed out")).toBeInTheDocument();
    expect(screen.getByText("This test run did not complete successfully")).toBeInTheDocument();
    expect(screen.getByText(/^k6 reported errors in/)).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("renders a long summary message", async () => {
    const longMessage = "long framework diagnostic ".repeat(20).trim();
    const frameworkExitSummary = makeFrameworkExitSummary(1);
    frameworkExitSummary.top[0] = {
      ...frameworkExitSummary.top[0],
      message: longMessage,
    };
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns/:testRunId", () =>
        ok({ ...generateMockTestRunDetails(), frameworkExitSummary })
      )
    );

    renderAppContent({ initialRoute: ROUTE });

    expect(await screen.findByText(longMessage, { selector: "pre" })).toBeInTheDocument();
  });

  it("shows an error state with Retry and Back to Scenario actions when the run fails to load", async () => {
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns/:testRunId", () =>
        new Response(null, { status: 500 })
      )
    );

    renderAppContent({ initialRoute: ROUTE });

    expect(await screen.findByText("Failed to load test run details")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Scenario" })).toBeInTheDocument();

    // Clicking Retry re-issues the request; it fails again here, so the error state persists.
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Failed to load test run details")).toBeInTheDocument();
  });
});
