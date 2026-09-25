// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { rootReducer } from "../../store/store";
import { solutionApi } from "../../store/solutionApi";
import {
  InvestigationsTable,
  INVESTIGATION_STATUS_INDICATOR_MAP,
  getInvestigationStatusConfig,
} from "../../pages/scenarios/components/InvestigationsTable";
import { server } from "../server";
import type { Investigation, InvestigationStatusResponse } from "../../models/investigation";
import { InvestigationStatus } from "../../models/investigation";
import { StatusIndicatorType } from "../../pages/scenarios/constants";

const MOCK_SERVER_URL = "http://localhost:3001/";

const testId = "test-123";
const testRunId = "run-456";

function renderWithProviders(ui: ReactElement) {
  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(solutionApi.middleware),
  });

  return render(
    <MemoryRouter>
      <Provider store={store}>{ui}</Provider>
    </MemoryRouter>
  );
}

function makeInvestigation(overrides: Partial<Investigation> = {}): Investigation {
  return {
    investigationId: "task-001",
    executionId: "exec-001",
    agentSpaceId: "as-001",
    agentSpaceApiId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    agentSpaceName: "Production Agent Space",
    createdAt: "2026-06-01T12:00:00.000Z",
    archived: false,
    ...overrides,
  };
}

function overrideHandlers(options: {
  investigations?: Investigation[];
  status?: Partial<InvestigationStatusResponse>;
  statusError?: boolean;
}) {
  const investigations = options.investigations ?? [makeInvestigation()];
  const statusResp: InvestigationStatusResponse = {
    investigationId: "task-001",
    status: InvestigationStatus.IN_PROGRESS,
    statusReason: null,
    createdAt: "2026-06-01T12:00:00.000Z",
    agentSpaceName: "Production Agent Space",
    ...options.status,
  };

  server.use(
    http.get(`${MOCK_SERVER_URL}/scenarios/:testId/testruns/:testRunId/investigations`, () =>
      HttpResponse.json(investigations, { status: 200 })
    ),
    http.get(`${MOCK_SERVER_URL}/scenarios/:testId/testruns/:testRunId/investigations/:investigationId/status`, () =>
      options.statusError
        ? HttpResponse.json({ message: "boom" }, { status: 500 })
        : HttpResponse.json(statusResp, { status: 200 })
    )
  );
}

describe("INVESTIGATION_STATUS_INDICATOR_MAP", () => {
  const cases: Array<[InvestigationStatus, StatusIndicatorType, string]> = [
    [InvestigationStatus.COMPLETED, StatusIndicatorType.SUCCESS, "Completed"],
    [InvestigationStatus.FAILED, StatusIndicatorType.ERROR, "Failed"],
    [InvestigationStatus.TIMED_OUT, StatusIndicatorType.ERROR, "Timed out"],
    [InvestigationStatus.CANCELED, StatusIndicatorType.STOPPED, "Canceled"],
    [InvestigationStatus.IN_PROGRESS, StatusIndicatorType.IN_PROGRESS, "In progress"],
    [InvestigationStatus.PENDING_CUSTOMER_APPROVAL, StatusIndicatorType.PENDING, "Awaiting approval"],
    [InvestigationStatus.PENDING_TRIAGE, StatusIndicatorType.PENDING, "Pending triage"],
    [InvestigationStatus.PENDING_START, StatusIndicatorType.PENDING, "Pending start"],
    [InvestigationStatus.LINKED, StatusIndicatorType.PENDING, "Linked"],
  ];

  it.each(cases)("maps %s to indicator %s labelled %s", (status, type, label) => {
    expect(INVESTIGATION_STATUS_INDICATOR_MAP[status]).toEqual({ type, label });
  });

  it("covers every status in the enum", () => {
    expect(Object.keys(INVESTIGATION_STATUS_INDICATOR_MAP).sort()).toEqual(Object.values(InvestigationStatus).sort());
  });

  // The API forwards unrecognized statuses from DevOps Agent verbatim, so the
  // lookup has to degrade instead of returning undefined.
  it("falls back to an info indicator for a status it does not know", () => {
    const unknown = "SOME_NEW_STATE" as InvestigationStatus;

    expect(getInvestigationStatusConfig(unknown)).toEqual({
      type: StatusIndicatorType.INFO,
      label: "SOME_NEW_STATE",
    });
  });
});

describe("InvestigationsTable status column", () => {
  it("renders a Status column header", async () => {
    overrideHandlers({});

    renderWithProviders(<InvestigationsTable testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("Status", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("drops the Execution ID column and puts Status in its place", async () => {
    overrideHandlers({});

    renderWithProviders(<InvestigationsTable testId={testId} testRunId={testRunId} />);

    await screen.findByText("Status", {}, { timeout: 5000 });

    expect(screen.queryByText("Execution ID")).not.toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent?.trim());
    expect(headers).toEqual(["Created", "Agent Space", "Investigation ID", "Status", "State"]);
  });

  it("renders the live status for a running investigation", async () => {
    overrideHandlers({ status: { status: InvestigationStatus.IN_PROGRESS } });

    renderWithProviders(<InvestigationsTable testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("In progress", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("renders a terminal status for a completed investigation", async () => {
    overrideHandlers({ status: { status: InvestigationStatus.COMPLETED } });

    renderWithProviders(<InvestigationsTable testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("Completed", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("falls back to Unavailable when the status request fails", async () => {
    overrideHandlers({ statusError: true });

    renderWithProviders(<InvestigationsTable testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("Unavailable", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("still shows status for an archived investigation", async () => {
    overrideHandlers({
      investigations: [makeInvestigation({ archived: true })],
      status: { status: InvestigationStatus.CANCELED },
    });

    renderWithProviders(<InvestigationsTable testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("Canceled", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("renders an unrecognized status instead of crashing the row", async () => {
    overrideHandlers({ status: { status: "SOME_NEW_STATE" as InvestigationStatus } });

    renderWithProviders(<InvestigationsTable testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("SOME_NEW_STATE", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("renders the empty state when there are no investigations", async () => {
    overrideHandlers({ investigations: [] });

    renderWithProviders(<InvestigationsTable testId={testId} testRunId={testRunId} />);

    await waitFor(
      () => {
        expect(screen.getByText("No investigations for this test run")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });
});
