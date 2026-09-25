// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import createWrapper from "@cloudscape-design/components/test-utils/dom";
import ScenariosContent from "../../pages/scenarios/ScenariosContent";
import { rootReducer } from "../../store/store";
import { solutionApi } from "../../store/solutionApi";

// The Actions handlers are irrelevant to gating; stub them so the component does
// not reach into RTK Query mutations during render.
vi.mock("../../pages/scenarios/hooks/useScenarioActions", () => ({
  useScenarioActions: () => ({
    editScenario: vi.fn(),
    copyScenario: vi.fn(),
    cancelTestRun: vi.fn(),
    deleteScenario: vi.fn(),
  }),
}));

function makeStore() {
  return configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(solutionApi.middleware),
  });
}

// A fresh scenario object each call (mirrors a refetch returning new object identities).
function makeScenario(status: string) {
  return {
    testId: "abc1234567",
    testName: "Scenario A",
    testDescription: "desc",
    testType: "simple",
    status,
    testTaskConfigs: [],
    history: [],
    tags: [],
  } as never;
}

function app(scenario: unknown, store: ReturnType<typeof makeStore>) {
  return (
    <Provider store={store}>
      <MemoryRouter>
        <ScenariosContent scenarios={[scenario as never]} refetch={vi.fn()} isFetching={false} />
      </MemoryRouter>
    </Provider>
  );
}

function renderWithStatus(status: string) {
  render(app(makeScenario(status), makeStore()));
  return createWrapper(document.body);
}

/** Selects the single row, opens the Actions dropdown, and returns each item's disabled state. */
function gatingFor(status: string) {
  const wrapper = renderWithStatus(status);
  wrapper.findTable()!.findRowSelectionArea(1)!.click();
  wrapper.findButtonDropdown()!.openDropdown();
  return { edit: isItemDisabled(wrapper, "edit"), cancel: isItemDisabled(wrapper, "cancel") };
}

/**
 * A Cloudscape ButtonDropdown item renders as an <li> (carrying the id) wrapping a
 * [role="menuitem"] span; the disabled flag lives as aria-disabled="true" on that span.
 * The dropdown must already be open.
 */
function isItemDisabled(wrapper: ReturnType<typeof createWrapper>, id: string) {
  const menuItem = wrapper.findButtonDropdown()!.findItemById(id)!.getElement().querySelector('[role="menuitem"]');
  return menuItem?.getAttribute("aria-disabled") === "true";
}

describe("ScenariosContent — Actions gating", () => {
  // Each case renders into document.body (the dropdown portals there); unmount
  // between cases so findButtonDropdown() never picks up a previous render.
  afterEach(cleanup);

  // Edit is allowed only in terminal states (matches the API saveOnly guard and the
  // details page); Cancel is allowed only where the API accepts a cancel
  // (queued/provisioning/running) — the finishing states (cleaning up / parsing results)
  // and "cancelling" are excluded, matching the API's cancel guard.
  it.each([
    // status, editDisabled, cancelDisabled
    ["complete", false, true],
    ["cancelled", false, true],
    ["failed", false, true],
    ["scheduled", false, true],
    ["created", false, true],
    ["running", true, false],
    ["provisioning", true, false],
    ["queued", true, false],
    ["cleaning up", true, true],
    ["parsing results", true, true],
    ["cancelling", true, true],
  ])("status %s -> edit disabled=%s, cancel disabled=%s", (status, editDisabled, cancelDisabled) => {
    const { edit, cancel } = gatingFor(status as string);
    expect(edit).toBe(editDisabled);
    expect(cancel).toBe(cancelDisabled);
  });

  it("disables Edit and Cancel when nothing is selected", () => {
    const wrapper = renderWithStatus("complete");
    wrapper.findButtonDropdown()!.openDropdown();
    expect(isItemDisabled(wrapper, "edit")).toBe(true);
    expect(isItemDisabled(wrapper, "cancel")).toBe(true);
  });

  it("re-gates Cancel from a refetch that updates the selected scenario's status (no re-select)", () => {
    const store = makeStore();
    // Select the row while the run is active (Cancel would be enabled — covered above).
    const { rerender } = render(app(makeScenario("running"), store));
    createWrapper(document.body).findTable()!.findRowSelectionArea(1)!.click();

    // A refetch returns a NEW object with the same testId, now "cancelling". The row is
    // never re-selected; gating must follow the fresh status (derived by id), not the
    // stale object captured in selectedItems.
    rerender(app(makeScenario("cancelling"), store));

    const wrapper = createWrapper(document.body);
    wrapper.findButtonDropdown()!.openDropdown();
    // Cancel is now disabled because the current status is "cancelling"...
    expect(isItemDisabled(wrapper, "cancel")).toBe(true);
    // ...and the row is still selected (Copy stays enabled), so trackBy/id-derivation
    // preserved the selection across the refetch rather than dropping it.
    expect(isItemDisabled(wrapper, "copy")).toBe(false);
  });
});
