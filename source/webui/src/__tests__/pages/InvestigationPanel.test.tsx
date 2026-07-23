// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, it, expect } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { rootReducer } from "../../store/store";
import { solutionApi } from "../../store/solutionApi";
import { InvestigationPanel } from "../../pages/scenarios/components/InvestigationPanel";
import { server } from "../server";
import type {
  Investigation,
  InvestigationStatusResponse,
  InvestigationFindingsResponse,
} from "../../models/investigation";

const MOCK_SERVER_URL = "http://localhost:3001/";

function renderWithProviders(ui: ReactElement) {
  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(solutionApi.middleware),
  });

  return {
    ...render(
      <MemoryRouter>
        <Provider store={store}>{ui}</Provider>
      </MemoryRouter>
    ),
    store,
  };
}

const testId = "test-123";
const testRunId = "run-456";

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
  findings?: InvestigationFindingsResponse;
}) {
  const investigations = options.investigations ?? [makeInvestigation()];
  const statusResp: InvestigationStatusResponse = {
    investigationId: "task-001",
    status: "IN_PROGRESS",
    statusReason: null,
    createdAt: "2026-06-01T12:00:00.000Z",
    agentSpaceName: "Production Agent Space",
    ...options.status,
  };

  const handlers = [
    http.get(`${MOCK_SERVER_URL}/scenarios/:testId/testruns/:testRunId/investigations`, () => {
      return HttpResponse.json(investigations, { status: 200 });
    }),
    http.get(`${MOCK_SERVER_URL}/scenarios/:testId/testruns/:testRunId/investigations/:investigationId/status`, () => {
      return HttpResponse.json(statusResp, { status: 200 });
    }),
  ];

  if (options.findings) {
    handlers.push(
      http.get(
        `${MOCK_SERVER_URL}/scenarios/:testId/testruns/:testRunId/investigations/:investigationId/findings`,
        () => {
          return HttpResponse.json(options.findings!, { status: 200 });
        }
      )
    );
  }

  server.use(...handlers);
}

describe("InvestigationPanel", () => {
  it("renders nothing when no active investigation exists", async () => {
    overrideHandlers({ investigations: [] });

    const { container } = renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    await waitFor(
      () => {
        expect(container.querySelector('[class*="container"]')).toBeNull();
      },
      { timeout: 3000 }
    );
  });

  it("renders nothing when all investigations are archived", async () => {
    overrideHandlers({ investigations: [makeInvestigation({ archived: true })] });

    const { container } = renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    await waitFor(
      () => {
        expect(container.textContent).toBe("");
      },
      { timeout: 3000 }
    );
  });

  it("renders in-progress status with cancel button", async () => {
    overrideHandlers({ status: { status: "IN_PROGRESS" } });

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("Investigation (in progress)", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText("Cancel investigation")).toBeInTheDocument();
    expect(screen.getByText("Open in DevOps Agent")).toBeInTheDocument();
  });

  it("does not show cancel button on terminal state", async () => {
    overrideHandlers({
      status: { status: "COMPLETED" },
      findings: {
        findings: "# Root Cause\n\nConnection pool exhausted.",
        recordType: "investigation_summary_md",
        recordId: "rec-001",
        createdAt: 1717243200,
      },
    });

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    await screen.findByText("Investigation (complete)", {}, { timeout: 5000 });
    expect(screen.queryByText("Cancel investigation")).not.toBeInTheDocument();
  });

  it("renders completed state with findings summary", async () => {
    overrideHandlers({
      status: { status: "COMPLETED" },
      findings: {
        findings: JSON.stringify({
          type: "investigation_summary",
          symptoms: [],
          findings: [
            {
              id: "cause-db-pool",
              title: "Database connection pool exhausted",
              description: "The database connection pool was exhausted.",
              type: "root_cause",
            },
          ],
          investigation_gaps: [],
        }),
        recordType: "investigation_summary",
        recordId: "rec-001",
        createdAt: 1717243200,
      },
    });

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("Investigation (root cause found)", {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("The database connection pool was exhausted.")).toBeInTheDocument();
    });
    expect(screen.getByText("Open in DevOps Agent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive investigation" })).toBeInTheDocument();
  });

  it("renders failed state with error message", async () => {
    overrideHandlers({ status: { status: "FAILED", statusReason: "Agent quota exceeded" } });

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    await waitFor(
      () => {
        expect(screen.getByText("Investigation failed")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    expect(screen.getByText("Agent quota exceeded")).toBeInTheDocument();
  });

  it("renders timed-out state", async () => {
    overrideHandlers({ status: { status: "TIMED_OUT" } });

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    await waitFor(
      () => {
        expect(screen.getByText("Investigation timed out")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it("calls cancel mutation when cancel button is clicked", async () => {
    const user = userEvent.setup();

    let cancelCalled = false;
    overrideHandlers({ status: { status: "IN_PROGRESS" } });
    server.use(
      http.put(`${MOCK_SERVER_URL}/scenarios/:testId/testruns/:testRunId/investigations/:investigationId`, () => {
        cancelCalled = true;
        return HttpResponse.json({ investigationId: "task-001", status: "CANCELED", archived: true }, { status: 200 });
      })
    );

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    const cancelButton = await screen.findByText("Cancel investigation", {}, { timeout: 5000 });
    await user.click(cancelButton);

    await waitFor(() => {
      expect(cancelCalled).toBe(true);
    });
  });

  it("shows archive confirmation modal when archive button is clicked", async () => {
    const user = userEvent.setup();

    overrideHandlers({
      status: { status: "COMPLETED" },
      findings: {
        findings: "# Findings\n\nSome findings here.",
        recordType: "investigation_summary_md",
        recordId: "rec-001",
        createdAt: 1717243200,
      },
    });

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    const archiveButton = await screen.findByText("Archive investigation", {}, { timeout: 5000 });
    await user.click(archiveButton);

    expect(
      await screen.findByText(
        "This will archive the investigation. Findings remain accessible in the DevOps Agent console. You can start a new investigation afterward."
      )
    ).toBeInTheDocument();
  });

  it("does not show mitigation step when completed", async () => {
    overrideHandlers({
      status: { status: "COMPLETED" },
      findings: {
        findings: "# Done\n\nRoot cause identified.",
        recordType: "investigation_summary_md",
        recordId: "rec-001",
        createdAt: 1717243200,
      },
    });

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    await waitFor(
      () => {
        expect(screen.getByText("Investigation (complete)")).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    expect(screen.queryByText("Mitigation plan")).not.toBeInTheDocument();
  });

  // ─── Parser robustness tests ──────────────────────────────────────────────

  it("renders completed-no-findings layout for healthy test run (all arrays empty)", async () => {
    overrideHandlers({
      status: { status: "COMPLETED" },
      findings: {
        findings: JSON.stringify({
          type: "investigation_summary",
          symptoms: [],
          findings: [],
          investigation_gaps: [],
        }),
        recordType: "investigation_summary",
        recordId: "rec-001",
        createdAt: 1717243200,
      },
    });

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("Investigation (complete)", {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/no issues found/i)).toBeInTheDocument();
    });
  });

  it("renders investigation_gaps even without root cause or symptoms", async () => {
    overrideHandlers({
      status: { status: "COMPLETED" },
      findings: {
        findings: JSON.stringify({
          type: "investigation_summary",
          symptoms: [],
          findings: [],
          investigation_gaps: [
            { title: "CloudFront metrics not enabled", description: "Enable additional metrics for visibility." },
          ],
        }),
        recordType: "investigation_summary",
        recordId: "rec-001",
        createdAt: 1717243200,
      },
    });

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("Investigation (complete)", {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("CloudFront metrics not enabled")).toBeInTheDocument();
    });
  });

  it("handles null findings response gracefully when completed", async () => {
    overrideHandlers({
      status: { status: "COMPLETED" },
      findings: { findings: null, recordType: null },
    });

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("Investigation (complete)", {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/no issues found/i)).toBeInTheDocument();
    });
  });

  it("preserves unknown finding types from the agent", async () => {
    overrideHandlers({
      status: { status: "COMPLETED" },
      findings: {
        findings: JSON.stringify({
          type: "investigation_summary",
          symptoms: [],
          findings: [
            {
              id: "obs-1",
              title: "All requests succeeded",
              description: "Zero failures detected across all layers.",
              type: "observation",
            },
          ],
          investigation_gaps: [],
        }),
        recordType: "investigation_summary",
        recordId: "rec-001",
        createdAt: 1717243200,
      },
    });

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("Investigation (complete)", {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("All requests succeeded")).toBeInTheDocument();
    });
  });

  it("accepts versioned recordType (forward-compatible)", async () => {
    overrideHandlers({
      status: { status: "COMPLETED" },
      findings: {
        findings: JSON.stringify({
          type: "investigation_summary_v2",
          symptoms: [{ title: "High latency detected", description: "P99 > 500ms" }],
          findings: [
            { id: "rc-1", title: "Cold start spike", description: "Lambda cold starts caused latency.", type: "root_cause" },
          ],
          investigation_gaps: [],
        }),
        recordType: "investigation_summary_v2",
        recordId: "rec-002",
        createdAt: 1717243200,
      },
    });

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("Investigation (root cause found)", {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Lambda cold starts caused latency.")).toBeInTheDocument();
    });
  });

  it("rejects non-summary recordType gracefully", async () => {
    overrideHandlers({
      status: { status: "COMPLETED" },
      findings: {
        findings: JSON.stringify({ type: "investigation_log", entries: [] }),
        recordType: "investigation_log",
        recordId: "rec-003",
        createdAt: 1717243200,
      },
    });

    renderWithProviders(<InvestigationPanel testId={testId} testRunId={testRunId} />);

    expect(await screen.findByText("Investigation (complete)", {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/no issues found/i)).toBeInTheDocument();
    });
  });
});
