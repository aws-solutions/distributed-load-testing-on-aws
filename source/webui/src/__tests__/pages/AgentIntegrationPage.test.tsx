// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server, MOCK_SERVER_URL } from "../server";
import { renderAppContent } from "../test-utils";

vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: {
      accessToken: {
        toString: () => "eyJhbGciOiJSUzI1NiJ9.eyJpYXQiOjE3MjAwMDAwMDAsImV4cCI6MTcyMDAwMzYwMH0.sig",
      },
    },
  }),
}));

describe("AgentIntegrationPage", () => {
  it("renders the page title", async () => {
    server.use(
      http.get(`${MOCK_SERVER_URL}/stack-info`, () => {
        return HttpResponse.json({
          region: "us-east-1",
          version: "v4.2.0",
          mcp_endpoint: null,
        });
      }),
      http.get(`${MOCK_SERVER_URL}/agent-spaces`, () => {
        return HttpResponse.json({ Items: [] });
      })
    );

    renderAppContent({ initialRoute: "/agent-integration" });

    await waitFor(() => {
      expect(screen.getByText("MCP Endpoint")).toBeInTheDocument();
    });
  });

  it("shows MCP not enabled when no mcp_endpoint", async () => {
    server.use(
      http.get(`${MOCK_SERVER_URL}/stack-info`, () => {
        return HttpResponse.json({
          region: "us-east-1",
          version: "v4.2.0",
          mcp_endpoint: null,
        });
      }),
      http.get(`${MOCK_SERVER_URL}/agent-spaces`, () => {
        return HttpResponse.json({ Items: [] });
      })
    );

    renderAppContent({ initialRoute: "/agent-integration" });

    await waitFor(() => {
      expect(screen.getByText("MCP Server Not Enabled")).toBeInTheDocument();
    });
  });

  it("shows MCP endpoint when available", async () => {
    server.use(
      http.get(`${MOCK_SERVER_URL}/stack-info`, () => {
        return HttpResponse.json({
          region: "us-east-1",
          version: "v4.2.0",
          mcp_endpoint: "https://mcp.example.com/prod",
        });
      }),
      http.get(`${MOCK_SERVER_URL}/agent-spaces`, () => {
        return HttpResponse.json({ Items: [] });
      })
    );

    renderAppContent({ initialRoute: "/agent-integration" });

    await waitFor(() => {
      expect(screen.getByText("https://mcp.example.com/prod")).toBeInTheDocument();
    });
  });

  it("renders Documentation section", async () => {
    server.use(
      http.get(`${MOCK_SERVER_URL}/stack-info`, () => {
        return HttpResponse.json({
          region: "us-east-1",
          version: "v4.2.0",
          mcp_endpoint: null,
        });
      }),
      http.get(`${MOCK_SERVER_URL}/agent-spaces`, () => {
        return HttpResponse.json({ Items: [] });
      })
    );

    renderAppContent({ initialRoute: "/agent-integration" });

    await waitFor(() => {
      expect(screen.getByText("MCP Integration")).toBeInTheDocument();
    });
    expect(screen.getByText("DevOps Agent Integration")).toBeInTheDocument();
  });

  it("shows security notice when MCP endpoint is available", async () => {
    server.use(
      http.get(`${MOCK_SERVER_URL}/stack-info`, () => {
        return HttpResponse.json({
          region: "us-east-1",
          version: "v4.2.0",
          mcp_endpoint: "https://mcp.example.com/prod",
        });
      }),
      http.get(`${MOCK_SERVER_URL}/agent-spaces`, () => {
        return HttpResponse.json({ Items: [] });
      })
    );

    renderAppContent({ initialRoute: "/agent-integration" });

    await waitFor(() => {
      expect(screen.getByText("Security Notice")).toBeInTheDocument();
    });
  });
});
