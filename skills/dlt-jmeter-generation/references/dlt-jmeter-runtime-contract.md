# DLT JMeter runtime contract

This file is the reference for the `dlt-jmeter-generation` skill. It captures how DLT runs a JMeter plan, the result-file column contract, the packaging rules, and the S3 keys, split by execution mode where the two engines differ. Verify against the Distributed Load Testing on AWS repository when a deployment behaves unexpectedly.

## Two Execution Engines

| | Native mode (DLT v4.3.0 and later, opt-in) | Standard mode (Taurus, the default) |
|---|---|---|
| How the plan runs | `jmeter -n -t <plan>.jmx -l kpi.jtl -j jmeter.log` plus pinned result properties | Through Taurus (`bzt`), which invokes the bundled JMeter |
| Load injection | None. The plan's thread groups are the sole authority. | Taurus rewrites the plan's thread groups to the scenario's concurrency, ramp-up, and hold-for, replacing the plan's own load settings. |
| Duration control | The plan ends the run; the Safety duration (`maxTestDurationSeconds`) is a force-stop cap | The scenario's ramp-up plus hold-for |
| Result file | `kpi.jtl` (CSV), reduced to a `dlt.result.v1` JSON artifact per task | `results.xml` (Taurus XML) |
| User `plugins/*.jar` | Ignored | Installed into `JMETER_HOME/lib/ext/` from a `plugins/` folder beside the `.jmx` |
| JMeter binary | The bundled 5.6.3 | The bundled 5.6.3 |
| Zip entry point | A single wrapping folder is unwrapped, then a top-level `.jmx` only, non-recursive lookup | A single wrapping folder is unwrapped, then a recursive `find` for `*.jmx` |
| Working directory | The script's own directory | The directory the archive is extracted into |

This skill authors for Native mode, because the load shape lives in the plan. A Native-valid plan also uploads and runs under Standard, but there Taurus replaces its load shape with the scenario's values. Deployments older than v4.3.0 offer only Standard.

## What the Console Calls These Modes

The console, the CLI, the MCP server, and the API use the same two mode names, but the wire fields differ from the labels:

| In the API and the CLI | In the web console |
|---|---|
| Native mode: `nativeRunMode` present, `--native-mode`, MCP `native_run_mode` | the **Native** traffic shape (marked Preview) |
| Standard mode: no `nativeRunMode` | the **Standard** traffic shape |
| `nativeRunMode.maxTestDurationSeconds`, `--max-test-duration` | **Safety duration** on the create form; the read-only Load Configuration summary reads `Native Mode · <duration> max duration` |

Selecting Native removes the Standard mode's Test Duration section entirely and replaces it with a single Safety duration field. That field sits at the bottom of the Upload test file section, defaults to 4 hours, and accepts at most 24 hours. The form also shows a Native Mode Checklist panel.

When the Safety duration elapses, DLT stops JMeter through `stoptest.sh` and keeps the results for the portion that ran. It records the run as **failed**. On every v4.3.x release, a run that fails during or after execution usually ends with the generic scenario reason `Step function execution failed`. See [[dlt-diagnose-run]]. The console's help text and the API documentation say DLT records such a run as completed, but both the run and scenario records show failed. Make the plan end on its own, several minutes before the cap.

## Native Invocation and the Properties DLT Pins

DLT builds the command line and passes no load or duration flags. It does pin a set of `-J` properties. A `-J` value overrides both `jmeter.properties` and any `user.properties`, which is what makes the result columns a stable contract.

Command shape:

```
jmeter -n -t <plan>.jmx -l kpi.jtl -j jmeter.log \
  -Jjmeter.save.saveservice.<...>=<...>   (result column contract, see below) \
  -Jjmeterengine.force.system.exit=true \
  -Jjmeterengine.nongui.port=4445 \
  -Jjmeterengine.nongui.maxport=4445
```

- `-n` selects non-GUI mode, `-t` names the plan, `-l kpi.jtl` sets the results log DLT tails and reduces, and `-j jmeter.log` sets JMeter's own log, kept as an artifact.
- DLT pins the engine command port to **4445** so its `stoptest.sh` can ask a running test to stop and flush the JTL on abort.
- `jmeterengine.force.system.exit=true` ensures the JVM exits even if a plugin leaves a non-daemon thread running.
- **DLT never rewrites the plan and never passes load properties.** A `${__P(name)}` reference with no default resolves to empty, so always supply a default: `${__P(threads,50)}`. The reliable approach is to put the load directly in the thread group.

## The kpi.jtl Column Contract (Native Mode)

DLT pins `jmeter.save.saveservice.*` so `kpi.jtl` is a CSV with a known header. The columns it keeps, and what each one feeds:

| JTL column | Kept | Used for |
|---|---|---|
| `timeStamp` (ms) | yes | Time bucketing for live data. A row missing this is dropped. |
| `elapsed` (ms) | yes | Response-time percentiles and averages. A row missing this is dropped. |
| `label` | yes | Per-label breakdown. This is your sampler or transaction `testname`. |
| `responseCode` | yes | Grouped response-code counts. JMeter writes an HTTP status, or a text string on a network error. |
| `success` | yes | Success/failure counts. JMeter writes literal `true` or `false`. |
| `bytes` | yes | Bytes received. |
| `allThreads` | yes | Reported concurrency (engine-wide active threads). |
| `Latency` | yes | Average latency. |
| `Connect` | yes | Average connect time. |
| `sentBytes`, `threadName`, `dataType`, `responseMessage`, `grpThreads`, `idleTime` | yes | Kept in the CSV; not all are surfaced. |
| `responseData`, `samplerData`, `responseHeaders`, `requestHeaders` | no | Turned off. Bodies and headers would bloat the file and embed newlines. |
| sub-results | no | Turned off. Otherwise every redirect hop and every child of a parent-generating Transaction Controller lands as its own row and inflates counts and percentiles. |

Implications for plan authoring:

- **Name samplers and transaction controllers meaningfully and stably**, since `label` is the only per-endpoint dimension in the results. Use `GET /items/{id}`, not the interpolated id.
- Do not add your own result writer that targets `kpi.jtl`. DLT owns that file and its format. Omit listeners in Native mode.
- Because sub-results are off, a redirecting request or a parent-mode Transaction Controller reports as one row; design labels with that in mind.

## From kpi.jtl to Results

Native mode reduces `kpi.jtl` into a `dlt.result.v1` JSON artifact per task, with a test-level summary and one aggregate per `label`. Each aggregate holds success and failure counts, total requests, max concurrency, bytes, average response time, latency, and connect time. It also holds the standard deviation, min and max, the p50, p90, p95, p99, and p99.9 response times, and response-code counts. See [[dlt-results-analysis]] for reading these.

Standard mode produces Taurus `results.xml` instead, enriched with ECS task metadata. The metrics are equivalent at the summary level.

## Heap and the OOM Failure Mode

The JMeter container is a fixed **2 vCPU, 4096 MiB Fargate task** with 20 GiB of disk, and in both modes the JVM runs with **`JVM_ARGS="-Xms1g -Xmx3g -XX:+ExitOnOutOfMemoryError -XX:-HeapDumpOnOutOfMemoryError"`**. There is no per-scenario knob to raise this.

A plan can exhaust the 3 GB heap and fail with an out-of-memory (OOM) error. `-XX:+ExitOnOutOfMemoryError` makes the JVM exit immediately with a non-zero code on the first OutOfMemoryError, rather than limping on in a degraded state. `-XX:-HeapDumpOnOutOfMemoryError` disables heap dumps, so a dying task does not try to write a multi-gigabyte file. In Native mode DLT captures that non-zero exit as a framework-exit record. The OOM then shows up on the run details page as a warning alert that reads `jmeter reported errors in N tasks` and names the exit code, which is the quickest way to identify it. Its View full report button opens the `framework-exits.jsonl` artifact under the **Framework Warnings** group. See [[dlt-diagnose-run]].

In Native mode, distinguish the two OOM shapes. A **JVM heap** OOM is this self-exit. **Exit code 137** in the alert means something outside DLT killed the JVM with SIGKILL, which in practice is the kernel out-of-memory killer acting when the task exceeded its 4 GiB memory limit outside the heap. The container keeps running, so the task still uploads its partial results. If the out-of-memory killer stops the container's own process instead, ECS stops the task with exit code 137 and no alert appears. Both point at the same mitigations:

- In-memory listeners (View Results Tree, Aggregate Report, Summary Report saving full samples). Remove them; DLT collects results from `kpi.jtl`.
- Very high per-container concurrency. Prefer more `task-count` (more containers) over more threads in one container. See [[dlt-capacity-and-region-planning]].
- Large response bodies buffered per thread. Avoid asserting against or extracting from very large responses when you can avoid it.
- Loading a large CSV without recycling, or building large variables. Use CSV Data Set Config with `recycle=true` and keep files reasonable.

Standard mode handles it differently: the container watches JMeter's error output for `OutOfMemoryError`, stops JMeter, uploads what it has, and exits with code 137 itself, so the task fails. In Standard mode a 137 can therefore mean either a heap OOM or a container memory kill; read the task's `jmeter.err` artifact to tell them apart.

## Packaging and Zip Layout

- **fileType `script`:** a single `.jmx`. Use when the plan needs no side files.
- **fileType `zip`:** the `.jmx` plus data files (CSV, included plans). Reference every data file by **relative path**, since the working directory is the script's directory.

Native-mode zip rules (also compatible with Standard):

- Put exactly one `.jmx` at the **top level** of the zip. DLT first unwraps a single wrapping folder that has nothing beside it. The entry-point search then reads only the archive root, without recursing, and picks the first `.jmx` alphabetically.
- Dotfiles and a `__MACOSX` folder at the root are ignored, so macOS zip cruft is harmless, but avoid a second stray `.jmx` at the root.
- Keep `users.csv` and any included plans beside the `.jmx` or in subfolders referenced by relative path.

```bash
# -j flattens paths so the .jmx and CSV land at the zip root.
cd <output-dir> && zip -j loadtest.zip loadtest-plan.jmx users.csv
```

Standard mode also unwraps a single wrapping folder and then does a recursive `find` for the first `*.jmx`, so a nested layout also works there. The top-level layout works in both, so prefer it.

## S3 Keys and Scenario Config

DLT reads the uploaded script from the scenarios bucket at:

```
public/test-scenarios/jmeter/{testId}.jmx     # fileType script
public/test-scenarios/jmeter/{testId}.zip     # fileType zip
```

Every time you create, update, or start a scenario, DLT writes the per-Region run configuration to:

```
test-scenarios/{testId}-{region}.json
```

Prefer the `dlt` CLI (v4.3.0 and later) or the DLT MCP server to upload and create scenarios (they compute these keys for you). The raw fallback is to `PutObject` the script at the `public/test-scenarios/jmeter/` key above and create the scenario through the API Gateway endpoint with SigV4 (IAM) auth. Both the CLI and the console cap uploads at 50 MB.
