// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http } from "msw";
import { renderAppContent } from "../test-utils";
import { MOCK_SERVER_URL, server } from "../server";
import { ApiEndpoints } from "../../store/solutionApi";
import { ok } from "../../mocks/handlers";

// A complete, valid simple-HTTP scenario used to pre-populate the form via the
// clone route (?cloneFrom=). The default scenario-details handler returns this.
const validScenario = {
  testId: "abc1234567",
  testName: "Submit Test",
  testDescription: "A test description",
  testType: "simple",
  showLive: false,
  tags: [],
  testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
  testScenario: {
    execution: [{ "ramp-up": "1m", "hold-for": "2m", scenario: "Submit Test" }],
    scenarios: { "Submit Test": { requests: [{ url: "https://example.com", method: "GET", headers: {} }] } },
  },
};

const useScenarioHandler = (scenario: object) =>
  server.use(http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", async () => (await ok(scenario)) as Response));

// The regions slice marks a region incompatible unless the /regions response
// flags compatible:true. Override the default handler so us-east-1 is usable.
const useCompatibleRegions = () =>
  server.use(
    http.get(MOCK_SERVER_URL + ApiEndpoints.REGIONS, async () =>
      (await ok({
        regions: [{ region: "us-east-1", compatible: true, version: "v4.1.0", deploymentDate: "2025-01-01" }],
      })) as Response
    )
  );

describe("CreateTestScenarioPage (single page)", () => {
  beforeAll(() => {
    // jsdom doesn't implement scrollIntoView; scroll-to-error calls it.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders all sections without a wizard", async () => {
    renderAppContent({ initialRoute: "/scenarios/create" });

    // Title appears in both the H1 and the breadcrumb; assert the heading specifically.
    expect(await screen.findByRole("heading", { level: 1, name: "Create Test Scenario" })).toBeInTheDocument();
    expect(screen.getByText("Test Configuration")).toBeInTheDocument();
    expect(screen.getByText("Schedule")).toBeInTheDocument();
    expect(screen.getByText("Test Type")).toBeInTheDocument();
    expect(screen.getByText("Multi-Region Traffic Configuration")).toBeInTheDocument();
    expect(screen.getByText("Test Duration")).toBeInTheDocument();
    expect(screen.getByText("Tags")).toBeInTheDocument();
    // Default create mode runs immediately, so the primary action reads "Run Now".
    expect(screen.getByRole("button", { name: "Run Now" })).toBeInTheDocument();
  });

  it("blocks submit and surfaces validation errors when the form is empty", async () => {
    let postCalled = false;
    server.use(
      http.post(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS, async () => {
        postCalled = true;
        return (await ok({ testId: "abc123" })) as Response;
      })
    );

    renderAppContent({ initialRoute: "/scenarios/create" });
    await screen.findByRole("heading", { level: 1, name: "Create Test Scenario" });

    screen.getByRole("button", { name: "Run Now" }).click();

    // Inline validation error appears and the API is not called.
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(postCalled).toBe(false);
  });

  it("submits a valid scenario (cloned) and calls the create API", async () => {
    let postBody: unknown = null;
    server.use(
      http.post(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS, async ({ request }) => {
        postBody = await request.json();
        return (await ok({ testId: "abc123" })) as Response;
      })
    );
    useScenarioHandler(validScenario);
    useCompatibleRegions();

    renderAppContent({ initialRoute: "/scenarios/create?cloneFrom=abc1234567" });

    // Clone pre-populates the name with the "(Copy)" suffix.
    await waitFor(() => {
      expect(screen.getByDisplayValue("Submit Test (Copy)")).toBeInTheDocument();
    });

    screen.getByRole("button", { name: "Run Now" }).click();

    await waitFor(() => {
      expect(postBody).not.toBeNull();
      expect((postBody as any).testName).toBe("Submit Test (Copy)");
      expect((postBody as any).testType).toBe("simple");
    });
  });

  it("pre-populates the edit route and labels the submit button 'Update'", async () => {
    useScenarioHandler(validScenario);

    renderAppContent({ initialRoute: "/scenarios/abc1234567/edit" });

    expect(await screen.findByRole("heading", { level: 1, name: "Edit Test Scenario" })).toBeInTheDocument();
    // Edit preserves the original name (no "(Copy)" suffix).
    await waitFor(() => {
      expect(screen.getByDisplayValue("Submit Test")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("prompts to discard unsaved changes when cancelling a dirty form", async () => {
    renderAppContent({ initialRoute: "/scenarios/create" });
    await screen.findByRole("heading", { level: 1, name: "Create Test Scenario" });

    // Dirty the form (first text input is the test name).
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "My scenario" } });
    screen.getByRole("button", { name: "Cancel" }).click();

    expect(await screen.findByText("Discard changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });
});
