// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server, MOCK_SERVER_URL } from "../server";
import { renderAppContent } from "../test-utils";

describe("IntroductionPage", () => {
  it("renders the page title", async () => {
    server.use(
      http.get(`${MOCK_SERVER_URL}/stack-info`, () => {
        return HttpResponse.json({
          region: "us-east-1",
          version: "v4.2.0",
          created_time: "2025-01-01T00:00:00Z",
          stack_id: "arn:aws:cloudformation:us-east-1:123456789:stack/DLT/abc",
          solution_template: "cloudfront",
          deployment_method: "cloudformation",
          is_update_available: false,
        });
      }),
      http.get(`${MOCK_SERVER_URL}/regions`, () => {
        return HttpResponse.json({ url: "https://s3.amazonaws.com/bucket/template.yaml" });
      })
    );

    renderAppContent({ initialRoute: "/" });

    await waitFor(() => {
      expect(screen.getByText("Distributed Load Testing Solution on AWS")).toBeInTheDocument();
    });
  });

  it("renders key features section", async () => {
    server.use(
      http.get(`${MOCK_SERVER_URL}/stack-info`, () => {
        return HttpResponse.json({
          region: "us-east-1",
          version: "v4.2.0",
          created_time: "2025-01-01T00:00:00Z",
          stack_id: "arn:aws:cloudformation:us-east-1:123456789:stack/DLT/abc",
          solution_template: "cloudfront",
          deployment_method: "cloudformation",
          is_update_available: false,
        });
      }),
      http.get(`${MOCK_SERVER_URL}/regions`, () => {
        return HttpResponse.json({ url: "" });
      })
    );

    renderAppContent({ initialRoute: "/" });

    await waitFor(() => {
      expect(screen.getByText("Key Features")).toBeInTheDocument();
    });
    expect(screen.getByText("Scalable load generation")).toBeInTheDocument();
    expect(screen.getByText("Real-time monitoring")).toBeInTheDocument();
    expect(screen.getByText("Agentic integration")).toBeInTheDocument();
  });

  it("renders getting started section", async () => {
    server.use(
      http.get(`${MOCK_SERVER_URL}/stack-info`, () => {
        return HttpResponse.json({
          region: "us-east-1",
          version: "v4.2.0",
          created_time: "2025-01-01T00:00:00Z",
          stack_id: "arn:aws:cloudformation:us-east-1:123456789:stack/DLT/abc",
          solution_template: "cloudfront",
          deployment_method: "cloudformation",
          is_update_available: false,
        });
      }),
      http.get(`${MOCK_SERVER_URL}/regions`, () => {
        return HttpResponse.json({ url: "" });
      })
    );

    renderAppContent({ initialRoute: "/" });

    await waitFor(() => {
      expect(screen.getByText("Getting Started")).toBeInTheDocument();
    });
    expect(screen.getByText("Create a test scenario")).toBeInTheDocument();
    expect(screen.getByText("Run your test")).toBeInTheDocument();
    expect(screen.getByText("Analyze results")).toBeInTheDocument();
  });

  it("renders current deployment info from stack-info", async () => {
    server.use(
      http.get(`${MOCK_SERVER_URL}/stack-info`, () => {
        return HttpResponse.json({
          region: "us-west-2",
          version: "v4.2.0",
          created_time: "2025-06-15T10:00:00Z",
          stack_id: "arn:aws:cloudformation:us-west-2:123456789:stack/DLT/xyz",
          solution_template: "cloudfront",
          deployment_method: "cloudformation",
          is_update_available: false,
        });
      }),
      http.get(`${MOCK_SERVER_URL}/regions`, () => {
        return HttpResponse.json({ url: "" });
      })
    );

    renderAppContent({ initialRoute: "/" });

    await waitFor(() => {
      expect(screen.getByText("Current Deployment")).toBeInTheDocument();
    });
    expect(screen.getAllByText("v4.2.0").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("us-west-2")).toBeInTheDocument();
  });

  it("renders multi-region deployment section", async () => {
    server.use(
      http.get(`${MOCK_SERVER_URL}/stack-info`, () => {
        return HttpResponse.json({
          region: "us-east-1",
          version: "v4.2.0",
          created_time: "2025-01-01T00:00:00Z",
          stack_id: "arn:aws:cloudformation:us-east-1:123456789:stack/DLT/abc",
          solution_template: "cloudfront",
          deployment_method: "cloudformation",
          is_update_available: false,
        });
      }),
      http.get(`${MOCK_SERVER_URL}/regions`, () => {
        return HttpResponse.json({ url: "https://s3.amazonaws.com/bucket/template.yaml" });
      })
    );

    renderAppContent({ initialRoute: "/" });

    await waitFor(() => {
      expect(screen.getByText("Multi-Region Deployments")).toBeInTheDocument();
    });
  });

  it("shows update available alert when is_update_available is true", async () => {
    server.use(
      http.get(`${MOCK_SERVER_URL}/stack-info`, () => {
        return HttpResponse.json({
          region: "us-east-1",
          version: "v4.1.3",
          latest_version: "4.2.0",
          created_time: "2025-01-01T00:00:00Z",
          stack_id: "arn:aws:cloudformation:us-east-1:123456789:stack/DLT/abc",
          solution_template: "cloudfront",
          deployment_method: "cloudformation",
          is_update_available: true,
        });
      }),
      http.get(`${MOCK_SERVER_URL}/regions`, () => {
        return HttpResponse.json({ url: "https://s3.amazonaws.com/bucket/template.yaml" });
      })
    );

    renderAppContent({ initialRoute: "/" });

    await waitFor(() => {
      expect(screen.getByText("Solution Version")).toBeInTheDocument();
    });
    // The update alert renders when is_update_available is true
    expect(screen.getAllByText(/v4\.1\.3/).length).toBeGreaterThanOrEqual(1);
  });
});
