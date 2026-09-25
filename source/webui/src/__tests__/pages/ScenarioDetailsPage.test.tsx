// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { afterEach, vi } from "vitest";
import { http } from "msw";
import { renderAppContent } from "../test-utils";
import { MOCK_SERVER_URL, server } from "../server";
import { ApiEndpoints } from "../../store/solutionApi";
import { ok, mockScenarioDetails } from "../../mocks/handlers";
import { TestStatus } from "@amzn/dlt-common/validation";

vi.mock("../../utils/dateValidation", () => ({
  validateExpiryDate: vi.fn((date) => {
    if (!date) return { isValid: false, errorMessage: "Invalid date format" };
    if (date === "2020-01-01") return { isValid: false, errorMessage: "Expiry date must be in the future" };
    return { isValid: true, errorMessage: "" };
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ScenarioDetailsPage", () => {
  it("shows loading spinner initially", () => {
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("displays scenario details after loading", async () => {
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    await waitFor(() => {
      const testNameElements = screen.getAllByText(/testname01/);
      expect(testNameElements.length).toBeGreaterThan(0);
    });

    // Single-scroll layout shows the Scenario Overview and Load Configuration sections.
    expect(screen.getByText("Scenario Overview")).toBeInTheDocument();
    expect(screen.getByText("Load Configuration")).toBeInTheDocument();
  });

  it("refetches test runs without replacing loaded scenario content", async () => {
    let scenarioRequests = 0;
    let testRunRequests = 0;
    let resolveScenarioRefresh: (() => void) | undefined;
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", async () => {
        if (scenarioRequests++ > 0) {
          await new Promise<void>((resolve) => {
            resolveScenarioRefresh = resolve;
          });
        }
        return ok({ ...mockScenarioDetails, status: "draft" }, 0);
      }),
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns", () => {
        testRunRequests += 1;
        return ok({ testRuns: [], pagination: {} }, 0);
      }),
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/baseline", () =>
        ok({ baselineId: null }, 0),
      ),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    await screen.findByText("Auto Refresh");
    await screen.findByText("No test runs found");
    const initialTestRunRequests = testRunRequests;

    const refreshDropdown = createWrapper(document.body)
      .findAllButtonDropdowns()
      .find((dropdown) => dropdown.findMainAction());
    refreshDropdown!.findMainAction()!.click();

    await waitFor(() => {
      expect(resolveScenarioRefresh).toBeDefined();
      expect(testRunRequests).toBe(initialTestRunRequests + 1);
    });
    expect(screen.getByText("Scenario ID")).toBeInTheDocument();
    resolveScenarioRefresh!();
  });

  it.each([
    ["active scenario and active latest run", TestStatus.RUNNING, TestStatus.RUNNING],
    ["active scenario and missing latest run", TestStatus.RUNNING, undefined],
    ["terminal scenario and active latest run", TestStatus.COMPLETE, TestStatus.RUNNING],
    ["terminal scenario and missing latest run", TestStatus.COMPLETE, undefined],
    ["active scenario and terminal latest run", TestStatus.RUNNING, TestStatus.COMPLETE],
  ])("keeps polling with %s while Test Runs is offscreen", async (_label, scenarioStatus, latestStatus) => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    let scenarioRequests = 0;
    let latestRequests = 0;
    let historyRequests = 0;
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () =>
        ok({
          ...mockScenarioDetails,
          status: scenarioRequests++ === 0 ? TestStatus.RUNNING : scenarioStatus,
        }, 0),
      ),
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns", ({ request }) => {
        if (new URL(request.url).searchParams.get("latest") !== "true") {
          historyRequests += 1;
          return ok({ testRuns: [], pagination: {} }, 0);
        }
        latestRequests += 1;
        return ok({
          testRuns: latestStatus ? [{
            testRunId: "run-current",
            startTime: "2026-09-04 01:00:05",
            status: latestStatus,
          }] : [],
          pagination: { total_count: 1 },
        }, 0);
      }),
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/baseline", () =>
        ok({ baselineId: null }, 0),
      ),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    await waitFor(() => {
      expect(createWrapper(document.body).findProgressBar()).not.toBeNull();
    });
    const initialProgressTimers = setIntervalSpy.mock.calls.filter(([, delay]) => delay === 100).length;

    const refreshDropdown = createWrapper(document.body)
      .findAllButtonDropdowns()
      .find((dropdown) => dropdown.findMainAction());
    refreshDropdown!.findMainAction()!.click();

    await waitFor(() => {
      expect(scenarioRequests).toBeGreaterThan(1);
      expect(latestRequests).toBe(1);
      expect(createWrapper(document.body).findProgressBar()).not.toBeNull();
    });
    await waitFor(() => {
      const progressTimers = setIntervalSpy.mock.calls.filter(([, delay]) => delay === 100).length;
      expect(progressTimers).toBeGreaterThan(initialProgressTimers);
    });
    expect(historyRequests).toBe(0);
  });

  it("stops polling when the scenario and latest run are terminal while Test Runs is offscreen", async () => {
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    let scenarioRequests = 0;
    let latestRequests = 0;
    let historyRequests = 0;
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () =>
        ok({
          ...mockScenarioDetails,
          status: scenarioRequests++ === 0 ? TestStatus.RUNNING : TestStatus.COMPLETE,
        }, 0),
      ),
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns", ({ request }) => {
        if (new URL(request.url).searchParams.get("latest") !== "true") {
          historyRequests += 1;
          return ok({ testRuns: [], pagination: {} }, 0);
        }
        latestRequests += 1;
        return ok({
          testRuns: [{
            testRunId: "run-current",
            startTime: "2026-09-04 01:00:05",
            status: TestStatus.COMPLETE,
          }],
          pagination: { total_count: 1 },
        }, 0);
      }),
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/baseline", () =>
        ok({ baselineId: null }, 0),
      ),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    await waitFor(() => {
      expect(createWrapper(document.body).findProgressBar()).not.toBeNull();
    });

    const refreshDropdown = createWrapper(document.body)
      .findAllButtonDropdowns()
      .find((dropdown) => dropdown.findMainAction());
    refreshDropdown!.findMainAction()!.click();

    await waitFor(() => {
      expect(scenarioRequests).toBeGreaterThan(1);
      expect(latestRequests).toBe(1);
      expect(createWrapper(document.body).findProgressBar()).toBeNull();
    });
    expect(historyRequests).toBe(0);
  });

  it("waits for the paired latest-run response before deciding to stop polling", async () => {
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    let scenarioRequests = 0;
    let latestRequests = 0;
    let resolveLatestRun: (() => void) | undefined;
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () =>
        ok({
          ...mockScenarioDetails,
          status: scenarioRequests++ < 2 ? TestStatus.RUNNING : TestStatus.COMPLETE,
        }, 0),
      ),
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns", async ({ request }) => {
        if (new URL(request.url).searchParams.get("latest") !== "true") {
          return ok({ testRuns: [], pagination: {} }, 0);
        }
        latestRequests += 1;
        if (latestRequests === 2) {
          await new Promise<void>((resolve) => {
            resolveLatestRun = resolve;
          });
        }
        return ok({
          testRuns: [{
            testRunId: "run-current",
            startTime: "2026-09-04 01:00:05",
            status: latestRequests === 1 ? TestStatus.COMPLETE : TestStatus.RUNNING,
          }],
          pagination: { total_count: 1 },
        }, 0);
      }),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    await waitFor(() => {
      expect(createWrapper(document.body).findProgressBar()).not.toBeNull();
    });

    const refreshDropdown = createWrapper(document.body)
      .findAllButtonDropdowns()
      .find((dropdown) => dropdown.findMainAction());
    refreshDropdown!.findMainAction()!.click();
    await waitFor(() => {
      expect(latestRequests).toBe(1);
    });

    refreshDropdown!.findMainAction()!.click();
    await waitFor(() => {
      expect(scenarioRequests).toBe(3);
      expect(resolveLatestRun).toBeDefined();
    });
    expect(createWrapper(document.body).findProgressBar()).not.toBeNull();

    resolveLatestRun!();
    await waitFor(() => {
      expect(createWrapper(document.body).findProgressBar()).not.toBeNull();
    });
  });

  it("keeps polling when the paired latest-run refresh fails", async () => {
    vi.stubGlobal("IntersectionObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    let scenarioRequests = 0;
    let latestRequests = 0;
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () =>
        ok({
          ...mockScenarioDetails,
          status: scenarioRequests++ < 2 ? TestStatus.RUNNING : TestStatus.COMPLETE,
        }, 0),
      ),
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns", ({ request }) => {
        if (new URL(request.url).searchParams.get("latest") !== "true") {
          return ok({ testRuns: [], pagination: {} }, 0);
        }
        latestRequests += 1;
        if (latestRequests === 2) return new Response(null, { status: 500 });
        return ok({
          testRuns: [{
            testRunId: "run-current",
            startTime: "2026-09-04 01:00:05",
            status: TestStatus.COMPLETE,
          }],
          pagination: { total_count: 1 },
        }, 0);
      }),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    await waitFor(() => {
      expect(createWrapper(document.body).findProgressBar()).not.toBeNull();
    });

    const refreshDropdown = createWrapper(document.body)
      .findAllButtonDropdowns()
      .find((dropdown) => dropdown.findMainAction());
    refreshDropdown!.findMainAction()!.click();
    await waitFor(() => {
      expect(latestRequests).toBe(1);
    });

    refreshDropdown!.findMainAction()!.click();
    await waitFor(() => {
      expect(scenarioRequests).toBe(3);
      expect(latestRequests).toBe(2);
      expect(createWrapper(document.body).findProgressBar()).not.toBeNull();
    });
  });

  it("does not start polling from empty terminal history", async () => {
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () =>
        ok({ ...mockScenarioDetails, status: TestStatus.COMPLETE }, 0),
      ),
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns", () =>
        ok({ testRuns: [], pagination: {} }, 0),
      ),
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/baseline", () =>
        ok({ baselineId: null }, 0),
      ),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    await screen.findByText("No test runs found");
    expect(createWrapper(document.body).findProgressBar()).toBeNull();
  });

  it("keeps polling when the user enables it on a terminal scenario", async () => {
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () =>
        ok({ ...mockScenarioDetails, status: TestStatus.COMPLETE }, 0),
      ),
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/testruns", () =>
        ok({
          testRuns: [{
            testRunId: "run-complete",
            startTime: "2026-09-08 17:00:00",
            status: TestStatus.COMPLETE,
          }],
          pagination: { total_count: 1 },
        }, 0),
      ),
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId/baseline", () =>
        ok({ baselineId: null }, 0),
      ),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    await screen.findByText("run-complete");
    const refreshDropdown = createWrapper(document.body)
      .findAllButtonDropdowns()
      .find((dropdown) => dropdown.findMainAction());
    refreshDropdown!.openDropdown();
    refreshDropdown!.findItemById("5s")!.click();

    await waitFor(() => {
      expect(createWrapper(document.body).findProgressBar()).not.toBeNull();
    });
  });

  it("displays the scenario ID in the Scenario Overview grid", async () => {
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    await waitFor(() => {
      const testIdElements = screen.getAllByText(/Ic4PBihoJY/);
      expect(testIdElements[0]).toBeInTheDocument();
    });
  });

  // Keywords belong on their own row in the Scenario Overview body, not in the
  // header actions where a long list gets squeezed.
  it("renders keywords on a row inside the Scenario Overview body", async () => {
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () =>
        ok({ ...mockScenarioDetails, tags: ["checkout", "nightly-regression"] }),
      ),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    const label = await screen.findByText("Keywords");
    // Same row as the label — proves the badges moved out of the header actions.
    expect(label.parentElement).toContainElement(screen.getByText("checkout"));
    expect(label.parentElement).toContainElement(screen.getByText("nightly-regression"));
  });

  it("omits the Keywords row entirely when the scenario has no keywords", async () => {
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () => ok({ ...mockScenarioDetails, tags: [] })),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    // Wait for the overview body (not just its header) so the assertion can't pass
    // vacuously while the grid is still loading.
    await screen.findByText("Total Runs");
    expect(screen.queryByText("Keywords")).not.toBeInTheDocument();
  });

  // The loaded state must keep an h1 to match the loading/error states — no
  // missing-h1 gap or skipped heading level once data arrives.
  it("keeps an h1 page heading in the loaded state", async () => {
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Scenario Details" })).toBeInTheDocument();
    });
  });

  // --- Button rendering by status ---

  it("shows Edit Scenario button for scheduled (non-active) status", async () => {
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });
    expect(await screen.findByText("Edit Scenario")).toBeInTheDocument();
  });

  it("shows Copy Scenario and Run Scenario buttons", async () => {
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });
    expect(await screen.findByText("Copy Scenario")).toBeInTheDocument();
    expect(screen.getByText("Run Scenario")).toBeInTheDocument();
  });

  it("shows Cancel button for running scenario", async () => {
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () =>
        ok({ ...mockScenarioDetails, status: TestStatus.RUNNING }),
      ),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    const cancelButtons = await screen.findAllByText("Cancel");
    expect(cancelButtons.length).toBeGreaterThan(0);
    expect(cancelButtons[0]!.closest("button")).toBeInTheDocument();
    expect(screen.queryByText("Edit Scenario")).not.toBeInTheDocument();
  });

  it("shows disabled Cancelling button when status is cancelling", async () => {
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () =>
        ok({ ...mockScenarioDetails, status: TestStatus.CANCELLING }),
      ),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    const btn = await screen.findByText("Cancelling…");
    expect(btn.closest("button")).toBeDisabled();
  });

  it.each([
    ["cleaning up", TestStatus.CLEANING_UP],
    ["parsing results", TestStatus.PARSING_RESULTS],
  ])("shows a disabled Cancel button for %s (finishing, no longer cancelable)", async (_label, status) => {
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () => ok({ ...mockScenarioDetails, status })),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    const cancelButtons = await screen.findAllByText("Cancel");
    expect(cancelButtons[0]!.closest("button")).toBeDisabled();
    // Not cancelable, but also not terminal — Edit must not be offered here.
    expect(screen.queryByText("Edit Scenario")).not.toBeInTheDocument();
  });

  it("disables Run Scenario button when test is active", async () => {
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () =>
        ok({ ...mockScenarioDetails, status: TestStatus.RUNNING }),
      ),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    const runBtn = await screen.findByText("Run Scenario");
    expect(runBtn.closest("button")).toBeDisabled();
  });

  // --- Error states ---

  it("shows error alert when API returns 500", async () => {
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () => new Response(null, { status: 500 })),
    );
    renderAppContent({ initialRoute: "/scenarios/test-err" });

    expect(await screen.findByText("Failed to load scenario details")).toBeInTheDocument();
  });

  // --- Delete button ---

  it("shows Delete Scenario button for non-active scenario", async () => {
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });
    expect(await screen.findByText("Delete Scenario")).toBeInTheDocument();
  });

  it("Delete Scenario button is enabled when scenario is not active", async () => {
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });
    const deleteBtn = await screen.findByText("Delete Scenario");
    expect(deleteBtn.closest("button")).not.toBeDisabled();
  });

  it("disables Delete Scenario button when scenario is running", async () => {
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () =>
        ok({ ...mockScenarioDetails, status: TestStatus.RUNNING }),
      ),
    );
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    const deleteBtn = await screen.findByText("Delete Scenario");
    expect(deleteBtn.closest("button")).toBeDisabled();
  });

  it("opens confirmation modal when Delete Scenario button is clicked", async () => {
    const user = userEvent.setup();
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    const deleteBtn = await screen.findByText("Delete Scenario");
    await user.click(deleteBtn);

    expect(await screen.findByText("Delete scenario")).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete the scenario/)).toBeInTheDocument();
  });

  it("can dismiss confirmation modal", async () => {
    const user = userEvent.setup();
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    const deleteBtn = await screen.findByText("Delete Scenario");
    await user.click(deleteBtn);

    // Modal should be visible with the confirmation content
    const confirmBtn = await screen.findByTestId("confirm-delete-btn");
    expect(confirmBtn).toBeInTheDocument();

    // Verify the close button exists (aria-label="Close modal")
    const closeBtn = screen.getByLabelText("Close modal");
    expect(closeBtn).toBeInTheDocument();
  });

  it("navigates to scenarios list after successful delete", async () => {
    const user = userEvent.setup();
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    const deleteBtn = await screen.findByText("Delete Scenario");
    await user.click(deleteBtn);

    await screen.findByText("Delete scenario");
    const confirmBtn = screen.getByTestId("confirm-delete-btn");
    await user.click(confirmBtn);

    // After successful delete, the app navigates to /scenarios (the list page)
    await waitFor(() => {
      expect(screen.getByText("Test Scenarios")).toBeInTheDocument();
    });
  });

  // --- Auto-refresh ---

  // Regression: a manual refresh used to clear the progress timer and rely on the
  // main effect to restart it, but none of that effect's deps changed on a manual
  // refresh, so auto-refresh died permanently. The manual handler now bumps
  // refreshTrigger, so polling must continue after a manual refresh.
  it("keeps auto-refresh polling after a manual refresh", async () => {
    let scenarioFetchCount = 0;
    server.use(
      http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () => {
        scenarioFetchCount++;
        return ok({ ...mockScenarioDetails, status: TestStatus.RUNNING });
      }),
    );

    const user = userEvent.setup();
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    // RUNNING status auto-enables refresh (5s default interval).
    const refreshBtn = await screen.findByRole("button", { name: "Refresh now" });

    const afterManual = await waitFor(() => {
      expect(scenarioFetchCount).toBeGreaterThan(0);
      return scenarioFetchCount;
    });

    // Manual refresh clears the progress timer, then bumps refreshTrigger so the
    // main effect restarts it — auto-refresh must keep polling afterwards.
    await user.click(refreshBtn);
    await waitFor(() => expect(scenarioFetchCount).toBeGreaterThan(afterManual));
    const afterClick = scenarioFetchCount;

    // Wait past the 5s polling interval: another automatic refresh must fire.
    await waitFor(() => expect(scenarioFetchCount).toBeGreaterThan(afterClick), { timeout: 8000 });
  }, 15000);

  it("shows error notification when delete API fails", async () => {
    server.use(
      http.delete(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", () => new Response(null, { status: 500 })),
    );
    const user = userEvent.setup();
    const { store } = renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    const deleteBtn = await screen.findByText("Delete Scenario");
    await user.click(deleteBtn);

    await screen.findByText("Delete scenario");
    const confirmBtn = screen.getByTestId("confirm-delete-btn");
    await user.click(confirmBtn);

    // Verify an error notification was dispatched to the store
    await waitFor(() => {
      const notifications = store.getState().notifications.notifications;
      const deleteError = notifications.find((n: { id: string }) => n.id.startsWith("delete-error-"));
      expect(deleteError).toBeDefined();
      expect(deleteError!.type).toBe("error");
      expect(deleteError!.content).toContain("Failed to delete scenario");
    });

    // Modal should still be visible (confirm button still in DOM)
    expect(screen.getByTestId("confirm-delete-btn")).toBeInTheDocument();
  });
});
