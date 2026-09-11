# Results parser persistence

The results parser keeps the DynamoDB summary bounded while preserving the
complete computed summary and the raw Taurus artifacts in S3.

- `RESULTS_MAX_LABELS_PER_SCOPE` defaults to `100`.
- `RESULTS_MAX_DDB_BYTES` defaults to `307200` bytes and cannot be configured
  below 16 KiB.
- A summary within both limits is stored unchanged with
  `resultsSummaryState.status` set to `complete`.
- An oversized summary is compacted deterministically and stored with
  `resultsSummaryState.status` set to `summary truncated`.
- Before compaction, the complete summary is written to the versioned scenarios
  bucket at `result-summaries/<testId>/<testRunId>/summary.json`. The state saved
  in DynamoDB includes the S3 version, ETag, SHA-256 digest, and the raw artifact
  prefix.

If the additional S3 write fails, the bounded summary is still finalized. Its
state records `fullSummary.status` as `upload failed`; the original task result
artifacts remain available through `rawArtifacts` for reprocessing.
