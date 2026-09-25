// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { TestResultsArtifacts, reconcileSelection } from "../../pages/scenarios/components/TestResultsArtifacts";
import type { ArtifactFile } from "../../pages/scenarios/components/TestResultsArtifacts";
import type { TestRunDetails } from "../../pages/scenarios/types/testResults";

// Supplies the bucket/region the "Open in S3" link is built from.
vi.mock("aws-amplify", () => ({
  Amplify: {
    getConfig: () => ({ Storage: { S3: { bucket: "test-bucket", region: "us-east-1" } } }),
  },
}));

vi.mock("aws-amplify/storage", () => ({
  list: vi.fn(),
  getUrl: vi.fn(),
}));

// Capture the entry names the component writes into the zip, so we can assert
// identically-named multi-region files don't collide.
const { zipFileMock, generateAsyncMock } = vi.hoisted(() => ({
  zipFileMock: vi.fn(),
  generateAsyncMock: vi.fn(),
}));
vi.mock("jszip", () => ({
  // Non-arrow so it can be invoked with `new JSZip()`.
  default: vi.fn(function () {
    return { file: zipFileMock, generateAsync: generateAsyncMock };
  }),
}));

import { list, getUrl } from "aws-amplify/storage";

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
    generateAsyncMock.mockResolvedValue(new Blob(["zip"]));
    vi.mocked(getUrl).mockResolvedValue({ url: new URL("https://example.com/artifact") } as any);
    global.fetch = vi.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(["data"])) }) as any;
    global.URL.createObjectURL = vi.fn(() => "blob:mock");
    global.URL.revokeObjectURL = vi.fn();
  });

  test("renders header, no S3 bucket/prefix chrome, and empty state", async () => {
    vi.mocked(list).mockResolvedValue({ items: [] });

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);

    expect(screen.getByText("Test Run Artifacts")).toBeInTheDocument();
    // The raw S3 bucket / prefix header was removed.
    expect(screen.queryByText("S3 Bucket")).not.toBeInTheDocument();
    expect(screen.queryByText("Prefix")).not.toBeInTheDocument();

    // "Open in S3" replaces it — with no files it falls back to the test's results prefix.
    expect(screen.getByText("Open in S3").closest("a")).toHaveAttribute(
      "href",
      "https://console.aws.amazon.com/s3/buckets/test-bucket?prefix=results/test-123/"
    );

    // shows error when no files found
    await waitFor(() => {
      expect(screen.getByText("No test result files found for this test run.")).toBeInTheDocument();
    });

    // download button is disabled when no items selected
    await waitFor(() => {
      expect(screen.getByText(/Download selected files/).closest("button")).toBeDisabled();
    });
  });

  test("Open in S3 scopes to the tightest common folder of the run's files", async () => {
    // Single-region run, two tasks -> link scopes to the shared per-region run folder.
    vi.mocked(list).mockResolvedValue({
      items: [
        {
          path: "results/test-123/ts_run-001/us-east-1/task-1/results.xml",
          lastModified: new Date(),
          size: 1,
          eTag: "a",
        },
        {
          path: "results/test-123/ts_run-001/us-east-1/task-2/results.xml",
          lastModified: new Date(),
          size: 1,
          eTag: "b",
        },
      ],
    } as any);

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);
    await waitFor(() => expect(screen.getAllByText("results.xml").length).toBe(2));

    expect(screen.getByText("Open in S3").closest("a")).toHaveAttribute(
      "href",
      "https://console.aws.amazon.com/s3/buckets/test-bucket?prefix=results/test-123/ts_run-001/us-east-1/"
    );
  });

  test("groups files by type and shows region + size metadata", async () => {
    vi.mocked(list).mockResolvedValue({
      items: [
        {
          path: "results/test-123/2025-01-01_run-001/us-east-1/task-1/result.json",
          lastModified: new Date(),
          size: 2048,
          eTag: "a",
        },
        {
          path: "results/test-123/2025-01-01_run-001/us-east-1/task-1/output.log",
          lastModified: new Date(),
          size: 512,
          eTag: "b",
        },
        {
          path: "results/test-123/2025-01-01_run-001/us-east-1/task-1/stderr.err",
          lastModified: new Date(),
          size: 64,
          eTag: "c",
        },
      ],
    } as any);

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);

    await waitFor(() => {
      expect(screen.getByText("result.json")).toBeInTheDocument();
    });

    // Type group headers render (Results / Logs / Errors).
    expect(screen.getByText("Results")).toBeInTheDocument();
    expect(screen.getByText("Logs")).toBeInTheDocument();
    expect(screen.getByText("Errors")).toBeInTheDocument();
    expect(screen.queryByText("Framework Warnings")).not.toBeInTheDocument();

    // Region attribution derived from the run's configured region.
    expect(screen.getAllByText("us-east-1").length).toBeGreaterThan(0);

    // Human-readable size (2048 bytes -> 2.0 KB).
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  test("shows only the aggregate framework-exit report in its own downloadable category", async () => {
    const path = "results/test-123/2025-01-01_run-001/framework-exits/framework-exits.jsonl";
    vi.mocked(list).mockResolvedValue({
      items: [
        {
          path: "results/test-123/2025-01-01_run-001/us-east-1/task-1/result.json",
          lastModified: new Date(),
          size: 2048,
          eTag: "result",
        },
        { path, lastModified: new Date(), size: 1024, eTag: "report" },
      ],
    } as any);

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);

    await waitFor(() => expect(screen.getByText("framework-exits.jsonl")).toBeInTheDocument());
    expect(screen.getByText("Framework Warnings")).toBeInTheDocument();
    expect(screen.getByText("Results")).toBeInTheDocument();
    expect(screen.queryByText("Other")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select framework-exits.jsonl" }));
    const downloadButton = screen.getByText(/Download selected files/).closest("button")!;
    await waitFor(() => expect(downloadButton).not.toBeDisabled());
    fireEvent.click(downloadButton);

    await waitFor(() => expect(getUrl).toHaveBeenCalledWith({ path }));
    // entryNameFor validates and returns the run-relative path verbatim (no traversal),
    // so the run-level `framework-exits/` folder structure is preserved.
    expect(zipFileMock).toHaveBeenCalledWith("framework-exits/framework-exits.jsonl", expect.any(Blob));
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

  test("excludes internal markers and per-task framework exits", async () => {
    vi.mocked(list).mockResolvedValue({
      items: [
        {
          path: "results/test-123/2025-01-01_run-001/us-east-1/task-1/result.json",
          lastModified: new Date(),
          size: 100,
          eTag: "result",
        },
        {
          path: "results/test-123/2025-01-01_run-001/completion/us-east-1/completion-task",
          lastModified: new Date(),
          size: 0,
          eTag: "marker",
        },
        {
          path: "results/test-123/2025-01-01_run-001/us-east-1/task-1/framework-exit.json",
          lastModified: new Date(),
          size: 100,
          eTag: "task-exit",
        },
        {
          path: "results/test-123/2025-01-01_run-001/framework-exits.jsonl",
          lastModified: new Date(),
          size: 200,
          eTag: "exit-report",
        },
      ],
    } as any);

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);

    await waitFor(() => expect(screen.getByText("result.json")).toBeInTheDocument());
    expect(screen.getByText("framework-exits.jsonl")).toBeInTheDocument();
    expect(screen.queryByText("completion-task")).not.toBeInTheDocument();
    expect(screen.queryByText("framework-exit.json")).not.toBeInTheDocument();
  });

  test("falls back to timestamp matching for legacy format", async () => {
    vi.mocked(list).mockResolvedValue({
      items: [
        {
          path: "results/test-123/2025-01-01T00:00:01.123-abc-us-east-1.xml",
          lastModified: new Date(),
          size: 100,
          eTag: "abc",
        },
        {
          path: "results/test-123/bzt-2025-01-01T00:00:01.123-abc-us-east-1.log",
          lastModified: new Date(),
          size: 200,
          eTag: "def",
        },
        {
          path: "results/test-123/2025-01-01T00:05:00.000-mid-us-east-1.xml",
          lastModified: new Date(),
          size: 150,
          eTag: "mno",
        },
        {
          path: "results/test-123/2024-12-31T23:59:56.000-xyz-us-east-1.xml",
          lastModified: new Date(),
          size: 150,
          eTag: "jkl",
        },
        {
          path: "results/test-123/2025-01-01T00:10:01.000-after-end-us-east-1.xml",
          lastModified: new Date(),
          size: 150,
          eTag: "pqr",
        },
        {
          path: "results/test-123/2024-12-31T12:00:00.000-other-us-east-1.xml",
          lastModified: new Date(),
          size: 50,
          eTag: "ghi",
        },
      ],
    } as any);

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);

    await waitFor(() => {
      expect(screen.getByText("2025-01-01T00:00:01.123-abc-us-east-1.xml")).toBeInTheDocument();
      expect(screen.getByText("bzt-2025-01-01T00:00:01.123-abc-us-east-1.log")).toBeInTheDocument();
      expect(screen.getByText("2025-01-01T00:05:00.000-mid-us-east-1.xml")).toBeInTheDocument();
    });

    // Files with timestamps outside [startTime, endTime] should not appear
    expect(screen.queryByText("2024-12-31T23:59:56.000-xyz-us-east-1.xml")).not.toBeInTheDocument();
    expect(screen.queryByText("2025-01-01T00:10:01.000-after-end-us-east-1.xml")).not.toBeInTheDocument();
    expect(screen.queryByText("2024-12-31T12:00:00.000-other-us-east-1.xml")).not.toBeInTheDocument();
  });

  test.each([
    { label: "empty endTime", endTime: "" },
    { label: "invalid endTime", endTime: "not-a-date" },
  ])("falls back to 1.5-minute window from startTime when endTime is $label", async ({ endTime }) => {
    vi.mocked(list).mockResolvedValue({
      items: [
        // within 1.5 minutes of startTime — should match
        {
          path: "results/test-123/2025-01-01T00:00:01.000-abc-us-east-1.xml",
          lastModified: new Date(),
          size: 100,
          eTag: "abc",
        },
        {
          path: "results/test-123/2025-01-01T00:01:29.000-late-us-east-1.xml",
          lastModified: new Date(),
          size: 100,
          eTag: "def",
        },
        // before startTime — should not match
        {
          path: "results/test-123/2024-12-31T23:59:59.000-before-us-east-1.xml",
          lastModified: new Date(),
          size: 100,
          eTag: "ghi",
        },
        // more than 1.5 minutes after startTime — should not match
        {
          path: "results/test-123/2025-01-01T00:01:31.000-outside-us-east-1.xml",
          lastModified: new Date(),
          size: 100,
          eTag: "jkl",
        },
      ],
    } as any);

    render(<TestResultsArtifacts testRunDetails={{ ...mockTestRunDetails, endTime }} testId="test-123" />);

    await waitFor(() => {
      expect(screen.getByText("2025-01-01T00:00:01.000-abc-us-east-1.xml")).toBeInTheDocument();
      expect(screen.getByText("2025-01-01T00:01:29.000-late-us-east-1.xml")).toBeInTheDocument();
    });
    expect(screen.queryByText("2024-12-31T23:59:59.000-before-us-east-1.xml")).not.toBeInTheDocument();
    expect(screen.queryByText("2025-01-01T00:01:31.000-outside-us-east-1.xml")).not.toBeInTheDocument();
  });

  test("shows error when list call fails", async () => {
    vi.mocked(list).mockRejectedValue(new Error("S3 error"));

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);

    await waitFor(() => {
      expect(screen.getByText("Error loading test result files.")).toBeInTheDocument();
    });
  });

  test("filters by filename and region, and shows the empty-filter message", async () => {
    vi.mocked(list).mockResolvedValue({
      items: [
        {
          path: "results/test-123/2025-01-01_run-001/us-east-1/task-1/results.xml",
          lastModified: new Date(),
          size: 100,
          eTag: "a",
        },
        {
          path: "results/test-123/2025-01-01_run-001/us-east-1/task-1/output.log",
          lastModified: new Date(),
          size: 200,
          eTag: "b",
        },
      ],
    } as any);

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);
    await waitFor(() => expect(screen.getByText("results.xml")).toBeInTheDocument());

    const filter = screen.getByPlaceholderText("Filter by filename or region");

    // Filename filter hides the non-matching group.
    fireEvent.change(filter, { target: { value: "output" } });
    expect(screen.getByText("output.log")).toBeInTheDocument();
    expect(screen.queryByText("results.xml")).not.toBeInTheDocument();

    // Region filter matches both files.
    fireEvent.change(filter, { target: { value: "us-east-1" } });
    expect(screen.getByText("results.xml")).toBeInTheDocument();
    expect(screen.getByText("output.log")).toBeInTheDocument();

    // Non-matching filter shows the empty-filter message.
    fireEvent.change(filter, { target: { value: "zzz-no-match" } });
    expect(screen.getByText("No files match the filter.")).toBeInTheDocument();
  });

  test("renders size/date/region edge cases (MB, missing size, generic + unresolved region)", async () => {
    vi.mocked(list).mockResolvedValue({
      items: [
        // 5 MB, region not among configured regions -> resolved via the generic pattern.
        {
          path: "results/test-123/x_run-001/eu-west-2/task-1/big.csv",
          lastModified: new Date(),
          size: 5 * 1024 * 1024,
          eTag: "a",
        },
        // No size, no lastModified, no region-like segment -> all render as "—".
        { path: "results/test-123/x_run-001/plain.txt", eTag: "b" },
      ],
    } as any);

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);
    await waitFor(() => expect(screen.getByText("big.csv")).toBeInTheDocument());

    expect(screen.getByText("5.0 MB")).toBeInTheDocument();
    expect(screen.getByText("eu-west-2")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  test("download disambiguates identically-named multi-region files in the zip", async () => {
    vi.mocked(list).mockResolvedValue({
      items: [
        {
          path: "results/test-123/d_run-001/us-east-1/task-1/results.xml",
          lastModified: new Date(),
          size: 100,
          eTag: "a",
        },
        {
          path: "results/test-123/d_run-001/us-west-2/task-1/results.xml",
          lastModified: new Date(),
          size: 100,
          eTag: "b",
        },
      ],
    } as any);

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);
    await waitFor(() => expect(screen.getAllByText("results.xml").length).toBe(2));

    // Both files are .xml -> one "Results" group; its select-all checkbox picks both.
    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    const downloadButton = screen.getByText(/Download selected files/).closest("button")!;
    await waitFor(() => expect(downloadButton).not.toBeDisabled());
    fireEvent.click(downloadButton);

    await waitFor(() => expect(zipFileMock).toHaveBeenCalledTimes(2));
    const entryNames = zipFileMock.mock.calls.map((c) => c[0]);
    // Names are rebuilt from the run-relative path (region/taskId/leaf) via entryNameFor,
    // so the run-folder prefix is dropped but the two regions stay distinct — no collision.
    expect(new Set(entryNames).size).toBe(2);
    expect(entryNames).not.toContain("results.xml");
    expect(entryNames).toContain("us-east-1/task-1/results.xml");
    expect(entryNames).toContain("us-west-2/task-1/results.xml");
  });

  test("download rejects a traversal key, never adding it to the zip", async () => {
    vi.mocked(list).mockResolvedValue({
      items: [
        {
          path: "results/test-123/d_run-001/../../evil.sh",
          lastModified: new Date(),
          size: 100,
          eTag: "a",
        },
      ],
    } as any);

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);
    await waitFor(() => expect(screen.getByText("evil.sh")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    const downloadButton = screen.getByText(/Download selected files/).closest("button")!;
    await waitFor(() => expect(downloadButton).not.toBeDisabled());
    fireEvent.click(downloadButton);

    // The `..` relative path is rejected outright — the archive is generated without it.
    await waitFor(() => expect(generateAsyncMock).toHaveBeenCalled());
    expect(zipFileMock).not.toHaveBeenCalled();
  });

  test("shows the not-found error when items exist but none match the run", async () => {
    vi.mocked(list).mockResolvedValue({
      items: [{ path: "results/test-123/unrelated/no-timestamp.xml", lastModified: new Date(), size: 10, eTag: "z" }],
    } as any);

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);

    await waitFor(() => expect(screen.getByText("No test result files found for this test run.")).toBeInTheDocument());
  });

  test("recovers from a download failure without crashing", async () => {
    vi.mocked(list).mockResolvedValue({
      items: [
        {
          path: "results/test-123/d_run-001/us-east-1/task-1/results.xml",
          lastModified: new Date(),
          size: 100,
          eTag: "a",
        },
      ],
    } as any);
    global.fetch = vi.fn().mockRejectedValue(new Error("network")) as any;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<TestResultsArtifacts testRunDetails={mockTestRunDetails} testId="test-123" />);
    await waitFor(() => expect(screen.getByText("results.xml")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    const downloadButton = screen.getByText(/Download selected files/).closest("button")!;
    await waitFor(() => expect(downloadButton).not.toBeDisabled());
    fireEvent.click(downloadButton);

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith("Error downloading files:", expect.any(Error)));
    // A user-facing error is surfaced without wiping out the artifacts table.
    await waitFor(() =>
      expect(screen.getByText("Failed to download the selected files. Please try again.")).toBeInTheDocument()
    );
    expect(screen.getByText("results.xml")).toBeInTheDocument();
    // Zip generation is never reached, and the component recovers (button usable again).
    expect(generateAsyncMock).not.toHaveBeenCalled();
    expect(downloadButton).not.toBeDisabled();
    errorSpy.mockRestore();
  });

  describe("reconcileSelection", () => {
    const file = (path: string, type: ArtifactFile["type"]): ArtifactFile => ({
      path,
      filename: path.split("/").pop()!,
      region: "us-east-1",
      type,
    });
    const logA = file("logs/a.log", "Logs");
    const logB = file("logs/b.log", "Logs");
    const resultsX = file("results/x.xml", "Results");

    // Selection is partitioned by type; a group's `selected` is its complete new selection.
    test("swaps in the type's selection and leaves other types untouched", () => {
      const prev = [logA, logB, resultsX]; // Logs + Results already selected
      const selected = [logA]; // user deselected logB within the Logs group
      expect(reconcileSelection(prev, "Logs", selected)).toEqual([resultsX, logA]);
    });

    test("preserves filter-hidden selections of the same type without duplicating", () => {
      const hiddenLog = file("logs/hidden.log", "Logs"); // filtered out of the table
      const visibleLog = file("logs/visible.log", "Logs");
      const newLog = file("logs/new.log", "Logs");
      const prev = [hiddenLog, visibleLog];
      // Cloudscape echoes the full prop selection (hidden included) plus the toggled row.
      const selected = [hiddenLog, visibleLog, newLog];
      const next = reconcileSelection(prev, "Logs", selected);
      expect(next).toHaveLength(3); // guards the 1->3->7 duplication regression
      expect(next).toContain(hiddenLog); // hidden selection survives
    });
  });
});
