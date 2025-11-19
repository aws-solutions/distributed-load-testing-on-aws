// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { screen, waitFor } from "@testing-library/react";
import { renderAppContent } from "../test-utils";

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
});
