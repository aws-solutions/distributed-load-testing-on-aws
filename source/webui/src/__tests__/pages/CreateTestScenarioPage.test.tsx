// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { http } from "msw";
import { renderAppContent } from "../test-utils";
import { MOCK_SERVER_URL, server } from "../server";
import { ApiEndpoints } from "../../store/solutionApi";
import { ok } from "../../mocks/handlers";
import { SECTION_IDS } from "../../pages/scenarios/utils/scenarioValidation";
import { TestMode } from "../../pages/scenarios/constants";

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
  server.use(
    http.get(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS + "/:testId", async () => (await ok(scenario)) as Response)
  );

// The regions slice marks a region incompatible unless the /regions response
// flags compatible:true. Override the default handler so us-east-1 is usable.
// SegmentedControls are matched by their data-cy so the queries don't depend on
// page order (Schedule, Test type, and Traffic shape each render one).
const trafficShapeControl = () =>
  createWrapper(document.body).findSegmentedControl('[data-cy="traffic-shape-segmented"]')!;
// The primary submit button; its label varies (Run Now / Schedule / Update) and
// "Run Now"/"Schedule" now also appear as timing segments, so target it by data-cy.
const submitButton = () => document.querySelector('[data-cy="submit-scenario-btn"]') as HTMLButtonElement;

const useCompatibleRegions = () =>
  server.use(
    http.get(
      MOCK_SERVER_URL + ApiEndpoints.REGIONS,
      async () =>
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
    expect(screen.getByText("Multi-region traffic configuration")).toBeInTheDocument();
    // Standard mode folds availability into the config table — no standalone section.
    expect(screen.queryByText("Regional Task Availability")).not.toBeInTheDocument();
    expect(screen.getByText("Test Duration")).toBeInTheDocument();
    expect(screen.getByText("Search keywords")).toBeInTheDocument();
    // Default create mode runs immediately, so the primary action reads "Run Now".
    expect(submitButton()).toHaveTextContent("Run Now");
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

    submitButton().click();

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

    submitButton().click();

    await waitFor(() => {
      expect(postBody).not.toBeNull();
      expect((postBody as any).testName).toBe("Submit Test (Copy)");
      expect((postBody as any).testType).toBe("simple");
    });
  });

  it("preserves a healthy threshold of 0 on submit (not defaulted to 90)", async () => {
    let postBody: unknown = null;
    server.use(
      http.post(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS, async ({ request }) => {
        postBody = await request.json();
        return (await ok({ testId: "abc123" })) as Response;
      })
    );
    useScenarioHandler({ ...validScenario, healthyThreshold: 0 });
    useCompatibleRegions();

    renderAppContent({ initialRoute: "/scenarios/create?cloneFrom=abc1234567" });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Submit Test (Copy)")).toBeInTheDocument();
    });

    submitButton().click();

    await waitFor(() => {
      expect(postBody).not.toBeNull();
      // A valid 0 must be sent as 0, not silently replaced with the 90 default.
      expect((postBody as any).healthyThreshold).toBe(0);
    });
  });

  it("trims surrounding whitespace from the name on submit (no blur)", async () => {
    let postBody: unknown = null;
    server.use(
      http.post(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS, async ({ request }) => {
        postBody = await request.json();
        return (await ok({ testId: "abc123" })) as Response;
      })
    );
    // Edit route seeds the name verbatim and the field is never focused, so the
    // trim here comes from the submit path — not the blur handler.
    const paddedScenario = {
      ...validScenario,
      testName: "  Padded Name  ",
      testScenario: {
        execution: [{ "ramp-up": "1m", "hold-for": "2m", scenario: "  Padded Name  " }],
        scenarios: { "  Padded Name  ": { requests: [{ url: "https://example.com", method: "GET", headers: {} }] } },
      },
    };
    useScenarioHandler(paddedScenario);
    useCompatibleRegions();

    renderAppContent({ initialRoute: "/scenarios/abc1234567/edit" });

    // getByDisplayValue normalizes whitespace, so assert the raw input value.
    await waitFor(() => {
      const input = document.querySelector('[data-cy="test-name-input"] input') as HTMLInputElement | null;
      expect(input?.value).toBe("  Padded Name  ");
    });

    screen.getByRole("button", { name: "Update" }).click();

    await waitFor(() => {
      expect(postBody).not.toBeNull();
      expect((postBody as any).testName).toBe("Padded Name");
      // The name is also the scenarios-map key, so it must be trimmed there too.
      expect(Object.keys((postBody as any).testScenario.scenarios)).toContain("Padded Name");
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

  describe("native mode", () => {
    // Stored the way the API persists a native run: nativeRunMode object,
    // placeholder concurrency, and legacy execution timing fields.
    const nativeScenario = {
      testId: "abc1234567",
      testName: "Native Test",
      testDescription: "A native test description",
      testType: "locust",
      showLive: false,
      tags: [],
      nativeRunMode: { maxTestDurationSeconds: 1800 },
      testTaskConfigs: [{ region: "us-east-1", taskCount: 2, concurrency: 1 }],
      testScenario: {
        execution: [{ "ramp-up": "0s", "hold-for": "1800s", scenario: "Native Test", executor: "locust" }],
        scenarios: { "Native Test": { script: "abc1234567.py" } },
      },
    };

    const locustStandardScenario = {
      ...nativeScenario,
      nativeRunMode: undefined,
      testScenario: {
        execution: [{ "ramp-up": "1m", "hold-for": "2m", scenario: "Native Test", executor: "locust" }],
        scenarios: { "Native Test": { script: "abc1234567.py" } },
      },
    };

    const nativeK6Scenario = {
      ...nativeScenario,
      testName: "Native k6 Test",
      testDescription: "A native k6 test description",
      testType: "k6",
      showLive: true,
      tags: ["performance"],
      nativeRunMode: {
        maxTestDurationSeconds: 900,
      },
      testScenario: {
        execution: [{ "ramp-up": "0s", "hold-for": "1s", scenario: "Native k6 Test", executor: "k6" }],
        scenarios: { "Native k6 Test": { script: "abc1234567.js" } },
      },
    };

    it("renders the traffic shape control inside the test type section", async () => {
      renderAppContent({ initialRoute: "/scenarios/create" });
      await screen.findByRole("heading", { level: 1, name: "Create Test Scenario" });

      // Traffic shape lives inside the test-type section — confirmed by finding it
      // within the data-section-id="test-type" container.
      const testTypeSection = document.querySelector(`[data-section-id="${SECTION_IDS.TEST_TYPE}"]`);
      expect(testTypeSection).not.toBeNull();
      expect(testTypeSection!.textContent).toContain("Traffic shape");
    });

    it("shows the safety duration (not a duration section) for a native scenario", async () => {
      useScenarioHandler(nativeScenario);
      useCompatibleRegions();

      renderAppContent({ initialRoute: "/scenarios/abc1234567/edit" });

      await waitFor(() => {
        expect(screen.getByDisplayValue("Native Test")).toBeInTheDocument();
      });
      // Native mode has no Test Duration section; the safety cap lives in Upload test file.
      expect(document.querySelector('[data-cy="max-duration-input"] input')).toBeInTheDocument();
      expect(screen.queryByText("Ramp Up")).not.toBeInTheDocument();
      // Concurrency is a Standard-only input.
      expect(screen.queryByText("Concurrent Users")).not.toBeInTheDocument();
    });

    it("submits nativeRunMode with valid inert legacy timing", async () => {
      let postBody: any = null;
      server.use(
        http.post(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS, async ({ request }) => {
          postBody = await request.json();
          return (await ok({ testId: "abc1234567" })) as Response;
        })
      );
      useScenarioHandler(nativeScenario);
      useCompatibleRegions();

      renderAppContent({ initialRoute: "/scenarios/abc1234567/edit" });
      await waitFor(() => {
        expect(screen.getByDisplayValue("Native Test")).toBeInTheDocument();
      });

      screen.getByRole("button", { name: "Update" }).click();

      await waitFor(() => {
        expect(postBody).not.toBeNull();
      });
      expect(postBody.nativeRunMode).toEqual({ maxTestDurationSeconds: 1800 });
      // The legacy flat fields must not be sent; the API rejects them explicitly.
      expect(postBody.runNativeMode).toBeUndefined();
      expect(postBody.maxTestDurationSeconds).toBeUndefined();
      // The API requires a concurrency ≥1 per region; native sends an inert placeholder.
      expect(postBody.testTaskConfigs).toEqual([{ region: "us-east-1", taskCount: 2, concurrency: 1 }]);
      // The API still validates these legacy fields, but native execution ignores them.
      expect(postBody.testScenario.execution[0]["ramp-up"]).toBe("0s");
      expect(postBody.testScenario.execution[0]["hold-for"]).toBe("1s");
    });

    it("submits the exact native k6 request JSON", async () => {
      let postBody: unknown = null;
      server.use(
        http.post(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS, async ({ request }) => {
          postBody = await request.json();
          return (await ok({ testId: "abc1234567" })) as Response;
        })
      );
      useScenarioHandler(nativeK6Scenario);
      useCompatibleRegions();

      renderAppContent({ initialRoute: "/scenarios/abc1234567/edit" });
      await waitFor(() => {
        expect(screen.getByDisplayValue("Native k6 Test")).toBeInTheDocument();
      });
      screen.getByRole("checkbox", { name: /AGPL-3.0 License/ }).click();
      screen.getByRole("button", { name: "Update" }).click();

      await waitFor(() => {
        expect(postBody).not.toBeNull();
      });
      expect(postBody).toEqual({
        testId: "abc1234567",
        testName: "Native k6 Test",
        testDescription: "A native k6 test description",
        testTaskConfigs: [{ concurrency: 1, taskCount: 2, region: "us-east-1" }],
        testScenario: {
          execution: [
            {
              "ramp-up": "0s",
              "hold-for": "1s",
              scenario: "Native k6 Test",
              executor: "k6",
            },
          ],
          scenarios: {
            "Native k6 Test": {
              script: "abc1234567.js",
            },
          },
        },
        testType: "k6",
        fileType: "script",
        showLive: true,
        regionalTaskDetails: {
          "us-east-1": {
            vCPULimit: 4000,
            vCPUsPerTask: 2,
            vCPUsInUse: 2,
            dltTaskLimit: 2000,
            dltAvailableTasks: 1999,
          },
          "us-west-1": {
            vCPULimit: 4000,
            vCPUsPerTask: 2,
            vCPUsInUse: 4,
            dltTaskLimit: 2000,
            dltAvailableTasks: 1998,
          },
        },
        tags: ["performance"],
        healthyThreshold: 90,
        // Overrides are no longer sent from the UI; only the safety-duration cap.
        nativeRunMode: {
          maxTestDurationSeconds: 900,
        },
      });
    });

    it("omits the native fields on a Standard submit", async () => {
      let postBody: any = null;
      server.use(
        http.post(MOCK_SERVER_URL + ApiEndpoints.SCENARIOS, async ({ request }) => {
          postBody = await request.json();
          return (await ok({ testId: "abc1234567" })) as Response;
        })
      );
      useScenarioHandler(locustStandardScenario);
      useCompatibleRegions();

      renderAppContent({ initialRoute: "/scenarios/abc1234567/edit" });
      await waitFor(() => {
        expect(screen.getByDisplayValue("Native Test")).toBeInTheDocument();
      });

      screen.getByRole("button", { name: "Update" }).click();

      await waitFor(() => {
        expect(postBody).not.toBeNull();
      });
      expect(postBody.nativeRunMode).toBeUndefined();
      expect(postBody.testScenario.execution[0]["hold-for"]).toBe("2m");
    });

    it("clears the Standard fields when switching to native mode", async () => {
      useScenarioHandler(locustStandardScenario);
      useCompatibleRegions();

      renderAppContent({ initialRoute: "/scenarios/abc1234567/edit" });
      await waitFor(() => {
        expect(screen.getByDisplayValue("Native Test")).toBeInTheDocument();
      });
      // Standard hydrates ramp-up 1m / hold-for 2m from the stored execution block.
      expect(screen.getByText("Ramp Up")).toBeInTheDocument();

      trafficShapeControl().findSegmentById(TestMode.NATIVE)!.click();

      await waitFor(() => {
        expect(screen.getByText("Safety duration")).toBeInTheDocument();
      });
      expect(screen.queryByText("Ramp Up")).not.toBeInTheDocument();
      // Switching back must not resurrect the previous ramp-up / hold-for values.
      trafficShapeControl().findSegmentById(TestMode.STANDARD)!.click();
      await waitFor(() => {
        expect(screen.getByText("Ramp Up")).toBeInTheDocument();
      });
      // Ramp-up/hold-for use type="number"; an empty number input reports value null.
      expect(document.querySelector('[data-cy="ramp-up-input"] input')).toHaveValue(null);
      expect(document.querySelector('[data-cy="hold-for-input"] input')).toHaveValue(null);
    });

    it("disables Native when HTTP Endpoint type is selected", async () => {
      renderAppContent({ initialRoute: "/scenarios/create" });
      await screen.findByRole("heading", { level: 1, name: "Create Test Scenario" });
      // HTTP Endpoint (Simple) is the default — Native must be disabled.
      expect(trafficShapeControl().findSegmentById(TestMode.NATIVE)?.getElement()).toBeDisabled();
    });

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
