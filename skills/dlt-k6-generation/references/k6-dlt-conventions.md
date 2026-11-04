# k6 conventions for Distributed Load Testing on AWS

Reference for the `dlt-k6-generation` skill. It covers how DLT runs k6 in the Native traffic shape. There, the script's own `options` block is the sole authority on the load shape and on when the run ends. The sections after that cover how the Standard traffic shape differs, the import and extension rules, the results mapping, and the packaging rules a generated script must follow.

## Native Mode Versus Standard Mode

DLT supports four test types: `simple`, `jmeter`, `k6`, and `locust`. A `k6` test runs in one of two traffic-shape modes.

- **Native runs k6 directly.** DLT runs the k6 binary against your uploaded script, with no wrapper. At task start it downloads the binary from the k6 GitHub releases, verifies its checksum, and pins it to a specific version (currently 1.5.0). A script that imports a `k6/x/...` extension can still end up on a different build; see the extension section below. TypeScript works because k6 has supported it since 0.57. Native is new in DLT v4.3.0 and opt-in, and the `nativeRunMode` object on the scenario selects it.
- **Standard runs k6 through Taurus.** This is the default on every version, and the only mode on a deployment older than v4.3.0. Taurus (`bzt`) drives k6 with its k6 executor and applies the scenario's concurrency, ramp-up, and hold-for over whatever shape the script's `options` block declares.

The `simple` test type is a separate thing. Its quick-test builder generates a JMeter plan that Taurus executes, so it never runs k6, and it is available only in Standard mode.

A script authored to own its load shape needs the Native traffic shape on a v4.3.0 or later deployment.

## The Invocation

DLT runs your script with exactly:

```
k6 run --no-usage-report --out csv=kpi.csv --out json=kpi.json <your script>
```

- `--no-usage-report` stops k6 sending its anonymous usage report.
- `--out csv=kpi.csv` writes raw metrics you can inspect as a downloaded artifact.
- `--out json=kpi.json` writes newline-delimited JSON that DLT uses for live data and for the final reduced result.

Your script runs verbatim. DLT sets the working directory to the directory that holds the script, so relative imports of sibling files resolve.

## The Script Owns the Load Shape: DLT Passes No Flags

In Native mode DLT builds the k6 command line from the script path and the two output paths and nothing else. It passes **no** `--vus`, **no** `--duration`, and **no** `--stage`. Your `options` block is the sole authority on how much load the script generates and on when the run ends.

`nativeRunMode` is a strict object that accepts only `maxTestDurationSeconds`, so the API rejects any other field, and the runner reads no load settings from the environment.

### The Failure Mode This Creates

A script with a workload in `default` and **no** `options` block does not error. k6 applies its own default of one virtual user (VU) running one iteration, so the script sends a single request and exits. The run reports complete with one request. It looks successful and measures nothing. That is how a generated k6 script can silently do nothing inside DLT.

### What a Correct Options Block Looks Like

Every generated script must shape the load *and* terminate. Any of these works:

```javascript
// A ramp, a hold, and a ramp-down. The stage durations sum to the run length.
export const options = {
  stages: [
    { duration: "30s", target: 20 },
    { duration: "5m", target: 20 },
    { duration: "30s", target: 0 },
  ],
  thresholds: { http_req_failed: ["rate<0.01"] },
};
```

```javascript
// Fixed VUs for a fixed duration.
export const options = { vus: 20, duration: "5m" };
```

```javascript
// Named scenarios, for multiple workloads or an arrival-rate executor.
export const options = {
  scenarios: {
    steady: { executor: "constant-vus", exec: "default", vus: 20, duration: "5m" },
  },
};
```

An `options.scenarios` entry that omits both `duration` and `iterations`, or a `stages` array that never returns to a terminating state, leaves the Safety duration to force-stop the run. See below.

### The Safety Duration Is a Cap, Not a Shape

In the console, the Native traffic shape offers exactly one duration input, labelled **Safety duration**, which maps to `nativeRunMode.maxTestDurationSeconds`. The cap force-stops a run that overruns, **defaults to 4 hours**, and accepts at most 24 hours. It neither drives the load nor shortens a script that would otherwise run longer.

Relying on it is expensive and misleading. The cap spends its full duration in Fargate on every task in every Region. When it fires, DLT records the run as **failed**, even if every request succeeded. On every v4.3.x release, a run that fails during or after execution usually ends with the generic scenario reason `Step function execution failed`. See [[dlt-diagnose-run]]. DLT still parses the results for the portion that ran. The console's help text and the API documentation say such a run is recorded as completed, but the run record says failed. A script that ends itself under the same cap records **complete**. Always terminate in the script, and leave several minutes of headroom. DLT checks for completion every 10 to 60 seconds. A script that ends within about a minute of the cap, plus the time to upload its results, can therefore still be recorded as failed.

The read-only Load Configuration summary on the scenario and run detail pages shows this same value as `Native Mode · <duration> max duration`, while the create form calls it **Safety duration**. They are one field.

## Imports and Extensions

Generated scripts use these by default:

- Built-in k6 modules: `k6/http`, `k6` (`check`, `sleep`, `group`, `fail`), `k6/metrics`, `k6/crypto`, `k6/encoding`, `k6/data` (for example `SharedArray`), and other modules shipped in the binary.
- Pure-JavaScript libraries from `https://jslib.k6.io`. These are ordinary JavaScript modules that k6 loads at runtime, so they work on the stock binary. They do require network egress to jslib.k6.io when the test starts; if you prefer no runtime fetch, vendor the module into your zip and import it with a relative path.

`k6/x/...` extensions behave differently from what the k6 version pin suggests. k6 1.5.0, the version DLT pins in both traffic shapes, has automatic extension resolution turned on, and DLT does not turn it off. When a script imports an extension in Grafana's Official or Community set, k6 downloads a custom build that contains it at the start of each task. The test then runs on that build. In a live test, a Native script importing `k6/x/kafka` ran normally on a provisioned build that reported `k6:v1.8.1 k6/x/kafka:v1.0.0`. Its task log recorded "Automatic extension resolution is enabled" followed by "A new k6 binary has been provisioned". Three consequences follow:

- The tasks need internet egress to Grafana's build service for the download, in addition to GitHub for the stock binary.
- The test runs on the provisioned build's k6 version, not on 1.5.0, so results can differ from a run without the extension.
- An extension outside the Official and Community set, or a task with no path to the build service, fails at load with `unknown dependency ... failed to provision a k6 binary`. In Standard mode that fails the task; in Native mode k6 exits non-zero before sending a request, so the run fails with `No requests were recorded` and a framework warning alert.

Add an extension only when the user asks for one.

## Authentication in k6

- **bearer, api_key, basic**: set the header on each request through the k6/http `params.headers` object. DLT sets no custom environment variables, so `__ENV` works only for local runs. A credential the DLT run needs ships in the bundle as a short-lived token in a config module or JSON file.
- **sigv4, cognito_sigv4**: the `dlt-sigv4-request-signing` skill describes the signing algorithm. In k6 you can use the official AWS jslib (`https://jslib.k6.io/aws/<version>/signature.js`, providing `AWSConfig` and `SignatureV4`), which is pure JavaScript and needs no extension. You can also build a signer from the built-in `k6/crypto` HMAC and SHA-256 primitives. Prefer pre-generated short-lived credentials in a bundled config module over a per-virtual-user Cognito exchange, since that exchange is expensive and temporary credentials expire mid-run. Determine the exact type with the `dlt-api-auth-detection` skill.

## What DLT Reports from a k6 Run

DLT reduces `kpi.json` (newline-delimited JSON) into its `dlt.result.v1` result. The reducer maps a deliberate allowlist of HTTP metrics:

- `http_reqs`: request counts, with HTTP status or a k6 error code per sample.
- `http_req_failed`: failure counts.
- `http_req_duration`: response times, summarized into average, standard deviation, min, max, and p50, p90, p95, p99, and p99.9 percentiles.
- `http_req_waiting`: latency (time to first byte).
- `http_req_connecting`: TCP connect time.
- `data_received`: run-wide received bytes.
- `vus`: peak concurrency (the maximum active VUs, not the last sample).

Per-endpoint results are keyed on k6's `name` tag. Set a stable `tags: { name: "..." }` on every request so a parameterized URL collapses into one label rather than one row per id. If the `name` system tag is disabled, summary totals stay correct but per-label results are unavailable.

The reduced result does not include checks, iterations, other HTTP timings, custom metrics, gRPC, WebSocket, or browser metrics today. These remain untouched in the raw `kpi.json` and `kpi.csv` artifacts, which you can download and inspect.

## Thresholds and Pass/Fail

k6 evaluates `options.thresholds` and reports pass or fail in its own end-of-test summary. A breach makes k6 exit non-zero. In Native mode the runner continues to reduction with that exit code, so the task's results still upload and the breach itself does not stop the run.

DLT surfaces the non-zero exit. Since v4.3.0, it writes a per-task framework-exit record, and the run details page shows a warning alert. The alert names the framework, how many tasks reported errors, the exit code, and k6's own message. Its "View full report" action opens the `framework-exits.jsonl` artifact under the **Framework Warnings** group. A threshold breach therefore reads as an error to whoever opens the run, even though the load itself was fine.

At scale there is a harder consequence. If enough tasks exit non-zero to push the healthy share below the scenario's healthy threshold, DLT starts a two-minute grace period. If every task in the Region finishes within it, which is the usual case when every task breaches the same threshold at the end of the run, the run completes and shows the warning alert. If tasks are still running when the grace period ends, for example because some tasks exited early on `abortOnFail` or a script error, DLT fails the run. Thresholds that stop some tasks early can therefore fail a run outright. The per-Region reason is `Framework warning threshold breached`. On every v4.3.x release, a run that fails during or after execution usually ends with the generic scenario reason `Step function execution failed`. See [[dlt-diagnose-run]].

Set thresholds you intend to act on. For run-level pass or fail gating, use the CLI result gates: `dlt scenarios results <testId>` or `dlt scenarios start --wait` with `--fail-on-error-rate`, `--fail-on-p99`, or `--fail-on-baseline-regression` (CLI v4.3.0 and later). The console compares a run with a baseline but has no pass or fail threshold setting. See [[dlt-diagnose-run]] for reading a run that failed this way.

## Task Size

Each k6 task runs at a fixed 2 vCPU, 4 GiB memory, and 20 GiB disk. Scale a run by choosing VUs per task and task count, and by adding Regions, rather than by expecting a larger container. In Native mode every task runs a full copy of the script, so a script holding 200 VUs on five tasks puts 1,000 VUs on the target. Size this with the `dlt-capacity-and-region-planning` skill.

## Packaging

- **Single script.** Upload one `.ts` (preferred) or `.js` file. DLT stores it at `public/test-scenarios/k6/{testId}.ts` (or `.js`) and resolves the entry point by extension, trying `.ts` first, then `.js`.
- **Zip with sibling files.** When you bundle helper modules or data files, keep the entry script at the top level of the zip. In Native mode DLT resolves the entry point as the first top-level `.ts`, then `.js`, in alphabetical order. Standard mode searches the whole archive recursively instead, so a top-level entry works in both. DLT preserves sibling files so relative imports and data loading work, and it flattens a single wrapping directory to the top level. Native mode ignores files beginning with `.` and the `__MACOSX` folder, so do not name a required file with a leading dot. Standard mode does not skip them when it searches for the k6 script, so a zip made with the macOS Finder can resolve to a `__MACOSX/._*.ts` file. Build the zip with the `zip` command, which adds no `__MACOSX` folder.
- Prefer the `dlt` CLI or a DLT MCP server for create, start, and results. Fall back to the web console, and to the raw API Gateway (SigV4), S3, and CloudWatch path only when neither is available.
