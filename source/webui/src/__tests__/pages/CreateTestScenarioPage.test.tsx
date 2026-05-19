// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { http } from "msw";
import { renderAppContent } from "../test-utils";
import { MOCK_SERVER_URL, server } from "../server";
import { ApiEndpoints } from "../../store/solutionApi";
import { ok } from "../../mocks/handlers";

describe("CreateTestScenarioPage", () => {
  const renderPage = () => {
    const { renderResult } = renderAppContent({ initialRoute: "/create-scenario" });
    const wrapper = createWrapper(renderResult.container);
    return { wrapper };
  };

  it("renders the wizard with all four steps", async () => {
    const { wrapper } = renderPage();

    expect(await screen.findByText("Create Test Scenario")).toBeInTheDocument();

    const wizard = wrapper.findWizard()!;
    expect(wizard).toBeTruthy();
    expect(wizard.findMenuNavigationLink(1, "active")).toBeTruthy();

    const primaryButton = wizard.findPrimaryButton().getElement();
    expect(primaryButton.textContent).toBe("Next");

    expect(wizard.findCancelButton()).toBeTruthy();

    const navLinks = wizard.findMenuNavigationLinks();
    expect(navLinks).toHaveLength(4);
  });

  it("blocks navigation to step 2 when General Settings is invalid", async () => {
    const { wrapper } = renderPage();
    await screen.findByText("Create Test Scenario");

    const wizard = wrapper.findWizard()!;
    // Click Next without filling required fields
    wizard.findPrimaryButton().click();

    // Should remain on step 1
    expect(wizard.findMenuNavigationLink(1, "active")).toBeTruthy();
  });

  it("submits the form and calls the create scenario API", async () => {
    // Track whether the POST was called
    let postBody: unknown = null;
    server.use(
      http.post(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS, async ({ request }) => {
        postBody = await request.json();
        return (await ok({ testId: "abc123" })) as Response;
      }),
    );

    // Build a valid simple-HTTP scenario and pass it via copyData to pre-populate the form
    const scenarioData = {
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
    const copyParam = encodeURIComponent(JSON.stringify(scenarioData));

    const { renderResult } = renderAppContent({
      initialRoute: `/create-scenario?copyData=${copyParam}`,
    });
    const wrapper = createWrapper(renderResult.container);

    // Wait for the page to render and form data to load
    expect(await screen.findByText("Create Test Scenario")).toBeInTheDocument();
    const wizard = wrapper.findWizard()!;

    // Navigate: General Settings → Scenario Config → Traffic Shape → Review
    wizard.findPrimaryButton().click();
    wizard.findPrimaryButton().click();
    wizard.findPrimaryButton().click();

    // Should now be on step 4 (Review) with a "Run Now" submit button
    expect(wizard.findMenuNavigationLink(4, "active")).toBeTruthy();
    expect(wizard.findPrimaryButton().getElement().textContent).toBe("Run Now");

    // Submit
    wizard.findPrimaryButton().click();

    // Verify the API was called with the correct test name
    await waitFor(() => {
      expect(postBody).not.toBeNull();
      expect((postBody as any).testName).toBe("Submit Test (Copy)");
      expect((postBody as any).testType).toBe("simple");
    });

    // Wait for the full submit flow to complete (navigate away after setIsSubmitting(false))
    // This prevents the "window is not defined" error from the finally block running after teardown
    await waitFor(() => {
      expect(screen.queryByText("Create Test Scenario")).not.toBeInTheDocument();
    });
  });
});
