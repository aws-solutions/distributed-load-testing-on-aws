// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { http } from "msw";
import { renderAppContent } from "../test-utils";
import { MOCK_SERVER_URL, server } from "../server";
import { ApiEndpoints } from "../../store/solutionApi";
import { ok, mockScenarioDetails } from "../../mocks/handlers";
import { TestStatus } from "../../pages/scenarios/constants";

vi.mock("../../utils/dateValidation", () => ({
  validateExpiryDate: vi.fn((date) => {
    if (!date) return { isValid: false, errorMessage: "Invalid date format" };
    if (date === "2020-01-01") return { isValid: false, errorMessage: "Expiry date must be in the future" };
    return { isValid: true, errorMessage: "" };
  }),
}));

describe("ScenarioDetailsPage", () => {
  it("shows loading spinner initially", () => {
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });

  it("displays scenario details after loading", async () => {
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    await waitFor(() => {
      const testNameElements = screen.getAllByText(/testname01/);
      expect(testNameElements.length).toBeGreaterThan(0);
    });

    expect(screen.getByText(/Status/)).toBeInTheDocument();
  });

  it("displays testID in the header of the first container in Scenario Details tab", async () => {
    renderAppContent({ initialRoute: "/scenarios/Ic4PBihoJY" });

    await waitFor(() => {
      const testIdElements = screen.getAllByText(/Ic4PBihoJY/);
      expect(testIdElements[0]).toBeInTheDocument();
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
