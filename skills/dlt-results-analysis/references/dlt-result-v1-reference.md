# dlt.result.v1 Field Reference, Aggregation, and Units

This reference describes the raw per-task result artifact (`dlt.result.v1`) and the aggregated results object that DynamoDB stores and the API returns. It also explains how the results parser turns one into the other, and which units to watch for. Use it as the field-level companion to the `dlt-results-analysis` skill.

## The Two Shapes

A DLT run produces two related but different objects:

1. **The raw per-task artifact.** One `result.json` per ECS task, at `results/{testId}/{prefix}/{region}/{taskId}/result.json`. It follows the `dlt.result.v1` schema and is what the Native mode load-tester container uploads at the end of a test (v4.3.0 and later). Its display fields are in **milliseconds**, and its mergeable `statistics` block is in **microseconds**.
2. **The aggregated results object.** One object per run, stored in the History and Scenarios DynamoDB tables and surfaced by the API, CLI, MCP server, and console. It is keyed by Region plus a `total` key. In this nested form, latency is stored in **seconds**.

A Standard mode (Taurus) run produces the same aggregated object from Taurus `FinalStatus` XML instead of `result.json`, so the field names below apply to Standard runs too. The way the values are combined differs by mode; see the aggregation rules.

## Raw Artifact: `dlt.result.v1`

Top-level object (`DltResultV1`):

| Field | Type | Meaning |
|---|---|---|
| `schema` | string | Literal `dlt.result.v1`. A file with any other value is rejected, and the run fails with an incomplete-collection reason. |
| `testId` | string | Test scenario identifier. Must match the S3 key. |
| `taskId` | string | ECS task identifier that produced this file. Must match the S3 key. |
| `region` | string | AWS Region the task ran in. Must match the S3 key. |
| `startTime` | string | ISO-8601 task start. |
| `endTime` | string | ISO-8601 task end. |
| `testDurationSeconds` | number | Test duration in seconds (already seconds, not milliseconds). |
| `task` | object | ECS capacity used: `vcpus`, `memoryMiB`, `ecsDurationSeconds`. Reported as an operational metric, not part of the displayed results. |
| `summary` | object | Test-level `LabelAggregate` across all labels (its `label` is the empty string). |
| `labels` | array | One `LabelAggregate` per customer-defined request label. |
| `statistics` | object | The mergeable state the parser actually aggregates. See below. |

`LabelAggregate` (used for both `summary` and each entry of `labels`), all times in **milliseconds**. These are the task's own display values. The parser reads only `concurrency` from them; every other aggregated field comes from `statistics`.

| Field | Type | Meaning |
|---|---|---|
| `label` | string | Request label; empty string for the test-level summary. |
| `successCount` | number | Successful requests. |
| `failureCount` | number | Failed requests. |
| `totalRequestCount` | number | `successCount + failureCount`. |
| `concurrency` | number | Max observed concurrent virtual users during sampling. |
| `totalBytesReceived` | number | Bytes received. |
| `averageResponseTimeMilliseconds` | number | Mean full-request response time. |
| `averageLatencyMilliseconds` | number | Mean framework waiting or first-byte time. |
| `averageConnectTimeMilliseconds` | number | Mean connect time. |
| `responseTimeStdDevMilliseconds` | number | Population standard deviation of response time. |
| `minResponseTimeMilliseconds` | number | Fastest response. |
| `p50`, `p90`, `p95`, `p99`, `p99_9` | number | Response-time percentiles in milliseconds. |
| `maxResponseTimeMilliseconds` | number | Slowest response. |
| `responseCodes` | array | `{ code, count }` objects. Includes success codes at this stage; the parser strips them later. See response-code-decoding.md. |

`statistics` (`ResultAccumulatorState`) holds, for the summary and for each label, the state that can be combined across tasks without losing accuracy:

| Field | Meaning |
|---|---|
| `histogramLayout` | Literal `dlt.latency-us.rel-0p5pct.0-24h.v1`: 2,184 fixed buckets covering 1 microsecond to 24 hours, each within 0.5% of its reported value, plus a separate zero counter. |
| `requests` | `total`, `success`, and `failure` counts. |
| `bytesReceived` | Bytes received. For k6 this is recorded only on the summary, because k6 does not attribute received bytes to a request label. |
| `latency` | Full-request latency in microseconds: `count`, running `meanUs`, `m2UsSquared` (the sum of squared distances from the mean), exact `minUs` and `maxUs`, and the sparse `histogram` (`zeroCount` plus `[bucketIndex, count]` bins). |
| `waitingTime`, `connectTime` | `count` and weighted `meanUs`. |
| `responseCodes` | `{ code, count }` per framework-defined code. |

Labels in `statistics.labels` must match the display `labels` by name. The parser rejects a file whose labels disagree.

## Aggregated Object: Field Names and Derivation

The parser builds one aggregate per Region and one for the total, then maps it to the stored field names, converting milliseconds to seconds and rounding as shown.

| Stored field | Native source (merged across tasks) | Standard source (per task, then combined) | Units | Rounding |
|---|---|---|---|---|
| `succ` | `requests.total - requests.failure` | task success count, **summed** | count | none |
| `fail` | `requests.failure` | task failure count, **summed** | count | none |
| `throughput` | `requests.total` | task request count, **summed** | count (not a rate) | none |
| `bytes` | `bytesReceived`, **summed** | task bytes, **averaged** | bytes | 0 decimals |
| `concurrency` | each task's `summary.concurrency`, **averaged** | task concurrency, **averaged** | VUs | 0 decimals |
| `testDuration` | each task's `testDurationSeconds`, **averaged** (labels report `0`) | task duration, **averaged** | seconds | 0 decimals |
| `avg_ct` | merged `connectTime` mean | per-task mean, **averaged** | seconds | 5 decimals |
| `avg_lt` | merged `waitingTime` mean | per-task mean, **averaged** | seconds | 5 decimals |
| `avg_rt` | merged `latency` mean | per-task mean, **averaged** | seconds | 5 decimals |
| `p0_0` | merged `latency.minUs` (exact) | per-task minimum, **averaged** | seconds | 3 decimals |
| `p50_0`, `p90_0`, `p95_0`, `p99_0`, `p99_9` | nearest-rank bucket of the merged histogram, clamped to the exact min and max | per-task percentile, **averaged** | seconds | 3 decimals |
| `p100_0` | merged `latency.maxUs` (exact) | per-task maximum, **averaged** | seconds | 3 decimals |
| `stdev_rt` | `sqrt(m2UsSquared / count)` of the merged latency | per-task standard deviation, **averaged** | seconds | 3 decimals |
| `rc` | merged `responseCodes`, success codes stripped, sorted by code | per-task codes stripped, then counts summed per code | list | none |
| `labels` | the same rules applied per label, sorted by label | the same rules applied per label | list | as above |

Two levels of aggregation run with the same rules. First the parser aggregates each Region from its own tasks and stores the result under `results["<region>"]`. Then it aggregates the total and stores it under `results.total`: in Native mode by merging the Region states, in Standard mode by combining every task from every Region. Either way the total's summed fields are true test-wide figures.

### Aggregation Rules, Restated

- **Native merge.** Counts and bytes add. Means combine weighted by their sample counts, and the standard deviation comes from Chan's merge of the `m2UsSquared` states. The minimum and maximum are exact, and the percentiles come from the merged histogram. Only `concurrency` and `testDuration` are averaged across tasks, because the `statistics` block does not carry them. Merging runs in S3 key order within a Region, then Region by Region in the order the scenario lists its Regions. `scripts/aggregate_results.py` merges Regions alphabetically instead, which can change a stored mean or standard deviation by one unit in its last digit when the scenario does not list Regions alphabetically.
- **Standard averaging.** `succ`, `fail`, and `throughput` are summed; every other numeric field is the plain average of the per-task values.
- **Rounding.** `bytes`, `concurrency`, and `testDuration` to 0 decimals; `avg_ct`, `avg_lt`, and `avg_rt` to 5 decimals; every percentile and `stdev_rt` to 3 decimals. The stored values are strings produced by JavaScript's `toFixed`.
- **Response codes:** empty codes and the success allowlist are removed, then counts are summed per code.
- **Tasks with zero requests are skipped in Native mode.** A Native task that recorded no requests is left out of the aggregate and of `completeTasks`, so a dead task does not drag the averages toward zero, and a Region in which every task recorded zero requests fails the run with `No requests were recorded in <regions>`. Standard mode has no such filter: every uploaded `results.xml` is averaged in, and a Region that uploaded none is absent from the results.

### The Percentile Caveat

For a **Standard** run, the stored `p95_0`, `p99_0`, and so on are the **average of each task's percentile**, not a percentile recomputed over the merged request population. With many similar tasks this is close, but it is an approximation. Do not describe a Standard per-region or total percentile as exact.

For a **Native** run, the stored percentiles are computed once from the histogram of every request in the scope. Each is within 0.5% of the exact nearest-rank latency and never falls outside the observed minimum and maximum. The three-decimal storage then rounds it to the millisecond.

### The 400 KB Limit

DynamoDB caps an item at 400 KB. A run with a very large `results` object (many Regions, many labels, or long response-code lists) can exceed it. When that happens the parser cannot store the aggregate and the run fails, and the scenario record's `errorReason` is `Failed to parse the results - One item uploading to DynamoDB has exceeded the maximum allowed size (400KB)`. The raw per-task artifacts in S3 are unaffected, so reproduce the aggregate from them with `scripts/aggregate_results.py`.

## Units: Milliseconds Versus Seconds

Mixed-up units cause many wrong readings. Keep these straight:

- **Raw `dlt.result.v1` display fields:** milliseconds (except `testDurationSeconds`, which is seconds by name).
- **Raw `dlt.result.v1` `statistics` block:** microseconds (the `Us` suffix).
- **Nested aggregate (`results.total`, `results["<region>"]`)**, as returned by `GET /scenarios/{testId}` and stored in DynamoDB: **seconds**. The parser divided by 1000.
- **Flat run summary from `GET /scenarios/{testId}/testruns`:** **milliseconds** already. Its fields are `requestsPerSecond` (total requests divided by the average task duration), `avgResponseTime`, `avgLatency`, `avgConnectionTime`, `avgBandwidth` (stored `bytes` divided by the average task duration), and a `percentiles` object for latency.
- **Console and `dlt` CLI display:** milliseconds. The CLI multiplies the nested seconds values by 1000 and leaves the flat values as they are.

Stored `bytes` is a total in Native mode and a per-task average in Standard mode. `avgBandwidth` is therefore a fleet-wide rate for a Native run and a per-task rate for a Standard run.

When comparing two runs or building a report, convert everything to one unit first and state which unit you used.

## Taurus-Format `results.xml` (Standard Mode)

Standard mode runs, which are the default on every version, store a Taurus `FinalStatus` XML document per task instead of `result.json`. The parser reads the same conceptual fields from the XML:

- A group with an empty label is the test-level summary, and groups with labels are the per-label breakdown.
- `perc` elements carry the percentiles, and `rc` elements carry the response codes.
- `TestDuration`, `TaskId`, `TaskCPU`, `TaskMemory`, and `ECSDuration` carry the task metadata.

The parser extracts the Region from the S3 object key, which embeds it before the `.xml` suffix, because the XML body does not carry it. It then combines the per-task results with the Standard averaging rules above, so the stored aggregate has the same shape as a Native run's.

## Sources

The facts here come from these files in the solution source:

- `source/common/src/schemas/result.ts`: the `dlt.result.v1` schema.
- `source/common/src/streaming-statistics/`: the accumulator, the histogram layout, the Welford and Chan merges, and finalization.
- `source/results-parser/lib/native/index.js`: artifact validation, the merge, the millisecond-to-second mapping, and success-code stripping.
- `source/results-parser/lib/parser/index.js`: the Standard aggregation and the rounding rules.
- `source/results-parser/index.js`: per-Region and total aggregation, empty-Region handling, and the 400 KB failure path.
- `source/api-services/lib/scenarios/index.js`: the flat run summary.
- `source/common/src/s3-keys.ts`: the S3 key layout.
- `source/infrastructure/lib/back-end/scenarios-storage.ts`: the History and Scenarios tables and the `testId-startTime-index` GSI.
