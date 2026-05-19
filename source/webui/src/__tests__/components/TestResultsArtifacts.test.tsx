// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { TestResultsArtifacts } from "../../pages/scenarios/components/TestResultsArtifacts";
import type { TestRunDetails } from "../../pages/scenarios/types/testResults";

vi.mock("aws-amplify", () => ({
  Amplify: {
    getConfig: () => ({ Storage: { S3: { bucket: "test-bucket" } } }),
  },
}));

vi.mock("aws-amplify/storage", () => ({
  list: vi.fn(),
  getUrl: vi.fn(),
}));

import { list } from "aws-amplify/storage";

const mockTestRunDetails: TestRunDetails = {
  testRunId: "run-001",
  testId: "test-123",
  startTime: "2025-01-01 00:00:00",
  endTime: "2025-01-01 00:10:00",
  testDescription: "test",
  testTaskConfigs: [{ region: "us-east-1", taskCount: 1, concurrency: 1 }],
  completeTasks: { "us-east-1": 1 },
  testType: "simple",
  status: "complete",
  succPercent: "100",
  results: {},
};

describe("TestResultsArtifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("renders header and bucket info", async () => {
    vi.mocked(list).mockResolvedValue({ items: [] });

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);

    expect(screen.getByText("Test Run Artifacts")).toBeInTheDocument();
    expect(screen.getByText("test-bucket")).toBeInTheDocument();

    // shows error when no files found
    await waitFor(() => {
      expect(screen.getByText("No test result files found for this test run.")).toBeInTheDocument();
    });

    // download button is disabled when no items selected
    await waitFor(() => {
      expect(screen.getByText("Download selected files").closest("button")).toBeDisabled();
    });
  });

  test("shows files when matching results exist", async () => {
    // Cast needed: list() is overloaded — path-based calls return ListAllWithPathOutput (items with `path`)
    // but vi.mocked() infers the deprecated key-based overload (ListAllOutput with `key`).
    vi.mocked(list).mockResolvedValue({
      items: [
        { path: "results/test-123/2025-01-01_run-001/results.xml", lastModified: new Date(), size: 100, eTag: "abc" },
        { path: "results/test-123/2025-01-01_run-001/output.log", lastModified: new Date(), size: 200, eTag: "def" },
      ],
    } as any);

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);

    await waitFor(() => {
      expect(screen.getByText("results.xml")).toBeInTheDocument();
      expect(screen.getByText("output.log")).toBeInTheDocument();
    });
  });

  test("falls back to timestamp matching for legacy format", async () => {
    vi.mocked(list).mockResolvedValue({
      items: [
        { path: "results/test-123/2025-01-01T00:00:01.123-abc-us-east-1.xml", lastModified: new Date(), size: 100, eTag: "abc" },
        { path: "results/test-123/bzt-2025-01-01T00:00:01.123-abc-us-east-1.log", lastModified: new Date(), size: 200, eTag: "def" },
        { path: "results/test-123/2024-12-31T23:59:56.000-xyz-us-east-1.xml", lastModified: new Date(), size: 150, eTag: "jkl" },
        { path: "results/test-123/2025-01-01T00:00:04.000-fast-us-east-1.xml", lastModified: new Date(), size: 150, eTag: "mno" },
        { path: "results/test-123/2024-12-31T12:00:00.000-other-us-east-1.xml", lastModified: new Date(), size: 50, eTag: "ghi" },
      ],
    } as any);

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);

    await waitFor(() => {
      expect(screen.getByText("2025-01-01T00:00:01.123-abc-us-east-1.xml")).toBeInTheDocument();
      expect(screen.getByText("bzt-2025-01-01T00:00:01.123-abc-us-east-1.log")).toBeInTheDocument();
    });

    // Files with timestamps outside the tolerance window should not appear
    expect(screen.queryByText("2024-12-31T23:59:56.000-xyz-us-east-1.xml")).not.toBeInTheDocument();
    expect(screen.queryByText("2025-01-01T00:00:04.000-fast-us-east-1.xml")).not.toBeInTheDocument();
    expect(screen.queryByText("2024-12-31T12:00:00.000-other-us-east-1.xml")).not.toBeInTheDocument();
  });

  test("shows error when list call fails", async () => {
    vi.mocked(list).mockRejectedValue(new Error("S3 error"));

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);

    await waitFor(() => {
      expect(screen.getByText("Error loading test result files.")).toBeInTheDocument();
    });
  });
});
