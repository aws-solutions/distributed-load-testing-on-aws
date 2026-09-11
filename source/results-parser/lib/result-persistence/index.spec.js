// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { createHash } = require("crypto");
const { prepareResultsForPersistence } = require("./index");

const resultWithLabels = (labels) => ({
  total: {
    succ: 12,
    fail: 0,
    throughput: 12,
    labels,
  },
});

describe("result persistence hardening", () => {
  it("keeps a bounded result inline without writing to S3", async () => {
    const s3 = { putObject: jest.fn() };
    const results = resultWithLabels([{ label: "GET /health", throughput: 12 }]);

    const prepared = await prepareResultsForPersistence({
      s3,
      bucket: "bucket",
      testId: "test",
      testRunId: "run",
      rawResultsPrefix: "results/test/prefix",
      results,
      env: {},
    });

    expect(prepared.results).toEqual(results);
    expect(prepared.summaryState.status).toBe("complete");
    expect(s3.putObject).not.toHaveBeenCalled();
  });

  it("stores the full summary and persists deterministic bounded labels", async () => {
    const s3 = {
      putObject: jest.fn().mockResolvedValue({ VersionId: "version-1", ETag: '"etag"' }),
    };
    const results = resultWithLabels([
      { label: "slow", throughput: 1 },
      { label: "busy-b", throughput: 10 },
      { label: "busy-a", throughput: 10 },
    ]);

    const prepared = await prepareResultsForPersistence({
      s3,
      bucket: "bucket",
      testId: "test",
      testRunId: "run",
      rawResultsPrefix: "results/test/prefix",
      results,
      env: { RESULTS_MAX_LABELS_PER_SCOPE: "2" },
    });

    expect(prepared.results.total.labels.map(({ label }) => label)).toEqual(["busy-a", "busy-b"]);
    expect(prepared.summaryState).toMatchObject({
      status: "summary truncated",
      originalLabelCount: 3,
      persistedLabelCount: 2,
      omittedLabelCount: 1,
      fullSummary: {
        bucket: "bucket",
        key: "result-summaries/test/run/summary.json",
        versionId: "version-1",
        eTag: '"etag"',
      },
      rawArtifacts: { bucket: "bucket", prefix: "results/test/prefix" },
    });
    const request = s3.putObject.mock.calls[0][0];
    expect(request.Body).toBe(JSON.stringify(results));
    expect(request.ChecksumSHA256).toBe(
      createHash("sha256").update(request.Body).digest("base64")
    );
    expect(prepared.summaryState.fullSummary.sha256).toBe(
      createHash("sha256").update(request.Body).digest("hex")
    );
  });

  it("still finalizes a compact summary when the S3 archive write fails", async () => {
    const s3 = { putObject: jest.fn().mockRejectedValue(new Error("S3 unavailable")) };
    const results = resultWithLabels([
      { label: "one", throughput: 2 },
      { label: "two", throughput: 1 },
    ]);

    const prepared = await prepareResultsForPersistence({
      s3,
      bucket: "bucket",
      testId: "test",
      testRunId: "run",
      rawResultsPrefix: "results/test/prefix",
      results,
      env: { RESULTS_MAX_LABELS_PER_SCOPE: "1" },
    });

    expect(prepared.summaryState.status).toBe("summary truncated");
    expect(prepared.summaryState.fullSummary).toEqual({
      status: "upload failed",
      errorName: "Error",
    });
    expect(prepared.summaryState.rawArtifacts.prefix).toBe("results/test/prefix");
  });

  it("falls back to scalar totals when non-label content exceeds the byte budget", async () => {
    const s3 = { putObject: jest.fn().mockResolvedValue({ VersionId: "version-2" }) };
    const results = {
      total: {
        succ: 1,
        fail: 0,
        throughput: 1,
        unexpected: "x".repeat(20 * 1024),
        labels: [],
      },
    };

    const prepared = await prepareResultsForPersistence({
      s3,
      bucket: "bucket",
      testId: "test",
      testRunId: "run",
      rawResultsPrefix: "results/test/prefix",
      results,
      env: { RESULTS_MAX_DDB_BYTES: String(16 * 1024) },
    });

    expect(prepared.results).toEqual({ total: { succ: 1, fail: 0, throughput: 1 } });
    expect(prepared.summaryState.status).toBe("summary truncated");
  });
});
