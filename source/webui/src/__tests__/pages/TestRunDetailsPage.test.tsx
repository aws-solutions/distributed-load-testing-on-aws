// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { screen } from "@testing-library/react";
import { renderAppContent } from "../test-utils";

describe("TestRunDetailsPage", () => {
  it("renders test run details with tabs", async () => {
    renderAppContent({ initialRoute: "/scenarios/MockTestId123/testruns/MockRunId456" });

    expect(await screen.findByText("Test Run Results")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Errors" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Artifacts" })).toBeInTheDocument();
  });
});
