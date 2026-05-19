// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { screen } from "@testing-library/react";
import { renderAppContent } from "../test-utils";

describe("IntroductionPage", () => {
  it("renders the page header and key content", async () => {
    renderAppContent({ initialRoute: "/" });

    expect(await screen.findByText("Distributed Load Testing Solution on AWS")).toBeInTheDocument();
    expect(screen.getByText("Getting Started")).toBeInTheDocument();
    expect(screen.getByText("Multi-Region Deployments")).toBeInTheDocument();
  });
});
