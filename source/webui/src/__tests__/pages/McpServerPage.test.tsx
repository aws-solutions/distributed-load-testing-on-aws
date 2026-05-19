// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { screen } from "@testing-library/react";
import { renderAppContent } from "../test-utils";

describe("McpServerPage", () => {
  it("renders the page and shows MCP not enabled state", async () => {
    renderAppContent({ initialRoute: "/mcp-server" });

    expect(await screen.findByText("MCP Server Not Enabled")).toBeInTheDocument();
  });
});
