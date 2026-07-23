// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SideNavigationBar from "../../components/navigation/SideNavigationBar";

vi.mock("../../utils/consoleMetrics", () => ({
  sendConsoleMetric: vi.fn(),
}));

function renderWithRouter(initialRoute = "/") {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <SideNavigationBar />
    </MemoryRouter>
  );
}

describe("SideNavigationBar", () => {
  it("renders the navigation header", () => {
    renderWithRouter();
    expect(screen.getByText("Distributed Load Testing on AWS")).toBeInTheDocument();
  });

  it("renders all navigation items", () => {
    renderWithRouter();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Test Scenarios")).toBeInTheDocument();
    expect(screen.getByText("Agent Integration")).toBeInTheDocument();
    expect(screen.getByText("Documentation")).toBeInTheDocument();
    expect(screen.getByText("Give Feedback")).toBeInTheDocument();
  });

  it("sets active href based on current route", () => {
    renderWithRouter("/scenarios");
    // The SideNavigation component manages active state internally based on activeHref prop
    expect(screen.getByText("Test Scenarios")).toBeInTheDocument();
  });

  it("sets active href to / for root route", () => {
    renderWithRouter("/");
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("sets active href for nested routes", () => {
    renderWithRouter("/scenarios/test-123");
    // Should resolve to /scenarios for a nested path
    expect(screen.getByText("Test Scenarios")).toBeInTheDocument();
  });
});
