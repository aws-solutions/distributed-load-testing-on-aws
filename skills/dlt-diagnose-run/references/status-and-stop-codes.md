# Status vocabulary, errorReason strings, and stop-code map

These are reference tables for [dlt-diagnose-run](../SKILL.md). Everything here
is grounded in the DLT source: `source/common/src/test-execution.ts`,
`source/common/src/task-failure.ts`, `source/common/src/setup-errors.ts`, the
orchestration Lambdas under `source/task-status-checker`,
`source/task-failure-handler`, `source/stabilization-checker`,
`source/regional-sync`, `source/test-metadata-updater`, and
`source/results-parser`, and the step function in
`source/infrastructure/lib/back-end/step-functions.ts`.

## Test Status Vocabulary

A run moves through these statuses. Only `complete`, `cancelled`, and `failed`
are terminal; the rest are transient and should keep advancing.

| Status            | Meaning                                                              | Terminal |
| ----------------- | ------------------------------------------------------------------- | -------- |
| `created`         | Scenario saved, not yet run or scheduled                             | No       |
| `scheduled`       | Scheduled to run later                                              | No       |
| `queued`          | Accepted, waiting for orchestration to start                        | No       |
| `provisioning`    | Step Functions is creating the ECS service and stabilizing tasks    | No       |
| `running`         | Tasks are executing the test                                        | No       |
| `parsing results` | Reducing per-task output into the run results                       | No       |
| `cleaning up`     | Tearing down ECS services after the run                             | No       |
| `cancelling`      | A cancel was requested and cleanup is in progress                   | No       |
| `complete`        | Run finished and results were reduced                               | Yes      |
| `cancelled`       | Run was cancelled through the product                               | Yes      |
| `failed`          | Run failed; `errorReason` is set                                    | Yes      |

Notes:

- `complete` means the orchestration finished, not that the test produced the
  load you intended. In Native mode a script that fails at runtime on some tasks
  still ends in `complete` with partial results. See Branch A in the SKILL.
- You can cancel a run only while it is `queued`, `provisioning`, `running`,
  or `cancelling`. The API rejects a cancel in `parsing results` or
  `cleaning up` with `TEST_NOT_ACTIVE`.
- The "Stopped" count shown for each Region in the console is
  `taskFailureCount` on the scenario record, which the Task Failure Handler
  increments. It is one scenario-level total that every Region row repeats, and
  it counts only tasks that stopped in the main stack's Region. ECS
  `describeServices` does not report stopped counts, so this is how the UI
  derives them.
- `errorReason` can appear on the run record (the History table item that
  `dlt runs get` and `get_test_run` return) and on the scenario record
  (`dlt scenarios get` and `get_scenario_details`). The run details page shows
  the run record's reason in an alert titled "This test run did not complete
  successfully", and the scenario details page shows the scenario record's
  reason. Neither page links to the logs or ECS state behind the reason.

## Run Record Versus Scenario Record

Two writers normally put an `errorReason` on the run record: the step function's
final status write, and the status updates the step function makes along the
way, which copy any reason already on the scenario record. The API also writes
one directly when it rejects a start for an incompatible regional stack, and on
v4.3.2 and later when it rejects the start of an existing scenario for Fargate
capacity. On every v4.3.x release, a run that fails during or after execution
never reaches the final status write. Its error-cleanup step reads an
`errorReason` field that its input does not carry, so the execution fails. The
SFN Failure Handler, the Lambda that runs when a Step Functions execution fails,
cleans up instead. That cleanup sets the scenario record's `errorReason` only
when none exists, so a reason that a component wrote earlier in the run
survives. Read the reason from the scenario record:

| Cause | Run record | Scenario record `errorReason` |
| --- | --- | --- |
| Tasks died after the run reached `running` | `failed`, the same `errorReason`, no `endTime` | `Task failure threshold breached: X/Y tasks failed (healthy threshold: Z%)` |
| A Region recorded no requests, Native artifacts were missing, or another parser error | `failed`, the same `errorReason`, no `endTime` | `Failed to parse the results - ...` |
| The Task Status Checker threw | `failed`, the same `errorReason`, no `endTime` | `Failed to check task status.` |
| Deadline, framework-warning grace, Safety duration, start command, or completion monitor | `failed`, no `errorReason`, no `endTime` | `Step function execution failed` |
| Setup failure | the reason, and an `endTime` | the same reason |
| Incompatible regional stack (existing scenario only) | a new failed run record with the reason and an `endTime` | unchanged |
| Fargate capacity rejection at start (existing scenario only), v4.3.2 and later | a new failed run record with the reason and an `endTime` | unchanged |
| Cancellation | `cancelled` and an `endTime`, no `errorReason` | `cancelled`, normally no `errorReason` |

The run details page therefore shows its failure alert for the first three rows
but not for the fourth, because the run record has no `errorReason` there; open
the scenario details page instead. For the fourth row, the specific per-Region
reason exists only in the orchestration logs. See the ad hoc query in
[logs-and-queries.md](logs-and-queries.md).

## Common `errorReason` Strings

Match the exact string from `dlt scenarios get` or `get_scenario_details` against
this table to find the component that wrote it and the likely cause.

| errorReason (exact or pattern) | Written by | Likely cause |
| --- | --- | --- |
| `Load test setup failed in N region(s): <region> (<cause>).` | Regional Sync | One or more Regions never became ready, so no traffic ran. The cause in parentheses is one of the setup causes below. |
| setup cause: `Service failed to stabilize within 30 minutes (elapsed: Ns)` | Stabilization Checker | The ECS service never reached a healthy running count within the 30-minute timeout. |
| setup cause: an ECS `rolloutStateReason` such as `ECS deployment circuit breaker: tasks failed to start.`, or `Circuit breaker triggered` | Stabilization Checker | The deployment circuit breaker failed the deployment because tasks exited during setup or never passed the health check. Read the task log stream. |
| setup cause: `Service is INACTIVE (deleted externally)` or `Service desired count was externally set to 0` | Stabilization Checker | The ECS service was deleted or scaled to zero outside DLT while it was stabilizing. |
| setup cause: `A previous run's resources are still stopping. Please wait a few seconds and retry.` | Task Runner | The previous run's same-named ECS service was still draining. Retry shortly. |
| setup cause: `AWS is throttling requests for this account. Please wait a moment and retry.` | Task Runner | AWS API throttling during service creation. Retry shortly. |
| setup cause: `An AWS service quota was reached while starting the test. ...` | Task Runner | A service quota or account limit, often the Fargate vCPU quota. See [[dlt-capacity-and-region-planning]]. |
| setup cause: `AWS could not provide enough capacity to start the test tasks. ...` | Task Runner | Insufficient Fargate capacity. Reduce the task count or retry. |
| setup cause: `The test could not start due to a networking configuration issue (subnets, security groups, or available IP addresses). ...` | Task Runner | Subnet, security group, or IP exhaustion. See [[dlt-network-and-permissions-preflight]]. |
| setup cause: `The load test failed to start. Check the run logs for details.` | Task Runner | An unclassified setup error. Run the DLT - Test Errors saved query. |
| setup cause: `did not stabilize in time` | Regional Sync | The Region returned no stabilization result, usually because its setup Lambda crashed. Run the DLT - Test Timeline saved query. |
| `Regional sync failed` followed by a note that at least one Region did not stabilize | Step function | The Regional Sync Lambda itself threw. Run the DLT - Test Errors saved query. |
| `Incompatible regional stacks: <region>: <reason>` | API | A regional stack is below the minimum compatible version (4.3.0 from v4.3.0) or above the hub. Upgrade it. The API also writes a failed run record with this reason when the scenario already exists, which is how a scheduled run surfaces it; the scenario record is not updated. See [[dlt-deploy-and-upgrade-triage]]. |
| `Task failure threshold breached: X/Y tasks failed (healthy threshold: Z%)` | Task Failure Handler | Too many Fargate tasks stopped unexpectedly after the run reached `running`. Only tasks in the main stack's Region count toward `X`, while `Y` counts every Region. Read the ECS stopped reason and exit code, then use the stop-code table below. |
| `Failed to check task status.` | Task Status Checker | The orchestration Lambda threw (often IAM or a transient AWS error). Not a problem with your test. |
| `Step function execution failed` | SFN Failure Handler | On every v4.3.x release, this is the reason for an execution-phase failure that no component explained earlier. The per-Region cause, which is not persisted, is one of the five rows below. No `endTime` is written to the run record. |
| per-Region cause: `Test execution timed out` | Task Status Checker | The completion deadline passed before all tasks wrote completion markers. |
| per-Region cause: `Framework warning threshold breached` | Task Status Checker | **Native only.** Enough tasks exited non-zero to push the healthy share below `healthyThreshold`, and the rest did not finish inside the grace period. Read the Framework Warnings report. |
| per-Region cause: `Failed to send start command` | Step function | The start-command Lambda failed for that Region. |
| per-Region cause: `Completion monitoring failed` | Step function | The Task Status Checker threw while monitoring completion. |
| per-Region cause: none (Safety duration reached) | Step function | **Native only.** The tasks completed only because the Safety duration stopped the framework. See the symptom section at the end. |
| `Failed to parse the results - No requests were recorded in <regions> - check the test configuration and target` | Results Parser | Every task in the named Regions reported zero requests. Other Regions' results were saved first. |
| `Failed to parse the results - Native result collection was incomplete; see CloudWatch logs for details` | Results Parser | **Native only.** At least one task left no valid `result.json`. The results-parser Lambda log names each missing or rejected artifact. |
| `Failed to parse the results - One item uploading to DynamoDB has exceeded the maximum allowed size (400KB)` | Results Parser | The aggregate was too large to store. Rebuild it from the raw artifacts with [[dlt-results-analysis]]. |
| `Failed to parse the results - <message>` | Results Parser | Any other parser error. The message names it. |
| `Test execution failed` or `Results parsing failed` | Step function | The reasons the step function is designed to record. Because of the error-cleanup defect, no v4.3.x release stores either string; the records show `Step function execution failed` or the earlier component's reason instead. |

## Errors Returned When You Save, Start, or Cancel

These come back as an HTTP error from the API, the console, or the CLI, before
a run starts. Most leave no run record. The incompatible-stack rejection and,
on v4.3.2 and later, the capacity rejections below can also write a failed run
record, as the record table above shows.

| Error | Meaning |
| --- | --- |
| `Incompatible regional stacks: <region>: <reason>` (`INCOMPATIBLE_REGIONAL_STACKS`, HTTP 400) | A selected Region's regional stack fails the version check. |
| `Task count should be positive number between 1 to N.` (HTTP 400) | A Region's task count is not a number, is below 1, or is above that Region's ceiling N. On v4.3.0 and v4.3.1, N is the `dltAvailableTasks` value the request sends in `regionalTaskDetails`. On v4.3.2 and later, every run start, including a scheduled run when it fires, computes N on the server as the Region's Fargate vCPU quota minus the vCPUs that Fargate tasks already use, divided by the vCPUs per DLT task. A save-only edit or a new schedule still checks the request's value. When a v4.3.2 or later start goes over the ceiling for an existing scenario, the API also writes a failed run record with this reason and an `endTime`. See [[dlt-capacity-and-region-planning]]. |
| `Unable to determine the available Fargate capacity for "<region>". Please try again.` (`FARGATE_CAPACITY_UNAVAILABLE`, HTTP 500), v4.3.2 and later | The API could not read the Region's Fargate vCPU quota, or the vCPUs per task from the main stack's task definition, so it refused to start the run. Retry. For an existing scenario, the API also writes a failed run record with this reason and an `endTime`. |
| `Invalid hold-for unit, it should be either m or s.` (HTTP 400), v4.3.0 and v4.3.1 only | On v4.3.0 and v4.3.1, a run starts only when `ramp-up` and `hold-for` are written in seconds or minutes with an `s` or `m` suffix, for example `120m` rather than `2h`. The console form offers Hours, so enter the duration in minutes or upgrade. v4.3.2 and later also accept `h`, `d`, and plain integers of seconds, and they return `Invalid duration, it should be a whole number followed by s, m, h, or d.` for any other value. See [[dlt-scenario-preflight-validation]]. |
| `SERVICE_DRAINING` (HTTP 409) | The previous run's ECS service is still stopping. Wait a few seconds and start again. |
| `TEST_NOT_ACTIVE` (HTTP 409) | A cancel was requested for a run that is not in a cancellable state. |

## Timeouts and Thresholds

- **Stabilization timeout**: 30 minutes. If the ECS service does not become
  healthy in that window, the Region fails with `Service failed to stabilize
  within 30 minutes` inside a `Load test setup failed` reason.
- **Execution deadline**: Native mode uses `maxTestDurationSeconds + 300s` of
  grace; Standard mode uses `testDuration + 300s`. Past the deadline, a Region
  fails if any of its tasks has not written a completion marker, and the
  scenario record shows `Step function execution failed` (see the record table
  above).
- **Completion polling**: every 10 to 60 seconds, scaled to the test duration.
  A poll marks a Native run as having reached its Safety duration once the
  elapsed time passes `maxTestDurationSeconds`. Even a script that ends within
  one poll of the cap can therefore be recorded as failed.
- **Healthy threshold**: `healthyThreshold`, default 90 (percent). When the
  running healthy percentage drops below it, the Task Failure Handler marks the
  run failed with the task-failure threshold reason.
- **Framework-warning grace period**: 2 minutes, Native mode only. A framework
  that exits non-zero is a warning, not a task failure, because the exit may
  just mean a k6 threshold was not met. DLT still counts a warned task as
  completed.
  Once enough tasks have warned to breach `healthyThreshold`, the checker starts
  a 2-minute grace period for the rest to finish. If they do not, the Region
  fails and the scenario record shows `Step function execution failed`. Results
  collected up to that point are still parsed and shown.
- **Locust dependency install**: 180 seconds, Native mode. A `requirements.txt`
  that takes longer, or that pip cannot satisfy, fails setup.
- **Deployment circuit breaker**: enabled with rollback disabled. A failed
  deployment does not roll back; it surfaces as a setup failure, and DLT cleans
  up the run as failed.

## Exit Code and ECS Stop Code Map

When a run fails on tasks, the ECS console shows each stopped task's `stopCode`
and container `exitCode`, and the DLT - Task Failures saved query records them
for tasks in the main stack's Region, because the Task Failure Handler sees ECS
events from that Region only.
`classifyStopCode` in `source/common/src/task-failure.ts` turns those into a
`StopCategory` for metrics, checking the exit code 2 and 137 rules before the
stop-code rules. Use this to translate what you see into a cause and a fix.

| Exit code | ECS stop code | StopCategory | Cause | Fix |
| --- | --- | --- | --- | --- |
| `0` | graceful (SIGTERM shutdown) | ignored | Normal shutdown. The Task Failure Handler does not count it. | None. |
| `143` | SIGTERM during execution (128 + 15) | ignored | Task received SIGTERM (scale-down, cleanup). Not counted. | None; expected during teardown. |
| `1` | (container exited non-zero) | `container_error` | Setup or startup failure: script not found in the zip, missing or unusable binary, checksum, runtime, or dependency install failure, empty or unsafe archive. In Native mode the task log shows a `TASK_FAILED` event with the message `fatal error` or a more specific install message. | Fix the bundle and re-validate with [[dlt-test-packaging-and-lint]]. Confirm the binary and script paths and the network path to PyPI or GitHub. |
| `2` | (container exited non-zero) | `bzt_error` | The `bzt` test framework failed (Standard mode). Usually a bad script or config. | Fix the script or Taurus config; run it locally first. |
| `137` | (container killed) | `oom` | In Native mode, ECS killed the container at its 4 GiB memory limit. A Standard JMeter run can also get it from the watchdog in `load-test.sh`. The watchdog exits 137 itself after an `OutOfMemoryError`, `StackOverflowError`, or similar JVM fatal error appears in JMeter's `.err` file. | Lower per-task load and add tasks. See [[dlt-capacity-and-region-planning]]. |
| other non-zero | (container exited non-zero) | `container_error` | Any other container exit. | Read the task log stream. |
| any | `TaskFailedToStart` | `infrastructure` | ECS could not place or start the task. | Usually transient. Check subnet capacity and image pull; rerun. |
| any | `ServiceSchedulerInitiated` | `infrastructure` | The ECS scheduler stopped the task. | Usually transient; rerun and watch service events. |
| any | `SpotInterruption` | `infrastructure` | A Fargate Spot task was reclaimed. DLT launches its tasks with the FARGATE launch type, not Fargate Spot, so a stock deployment does not produce this stop code. | Transient; rerun. |
| none | (unrecognized) | `unknown` | No exit code and no recognized stop code. | Read the raw ECS stopped reason and the task log stream. |

Note on Native versus Standard: in Native mode a script that fails **after the
test starts** does not stop the container with a non-zero code. On SIGTERM the
container exits 0, so ECS records no failure and this table does not apply. A
JMeter heap exhaustion in Native mode is the same case. The JVM runs with
`-XX:+ExitOnOutOfMemoryError`, exits on its own, and appears in the
framework-exit report rather than as exit code 137. Read the framework-exit
report and the task's CloudWatch log stream for the evidence instead. This table
applies to setup and startup failures in both modes, to memory kills, and to
`bzt` failures in Standard mode.

## The Framework-Exit Report: Read This First for a Native Run

When a framework exits non-zero in Native mode (v4.3.0 and later), that task
writes a `framework-exit.json` record next to its results. The record carries
the framework, the exit code, and the framework's own message, and the task's
completion marker gets a `.warning` suffix. From these records the results
parser builds one newline-delimited report for the run and stores a bounded
top-three summary on the run record:

- **In S3**: `results/{testId}/{prefix}/framework-exits/framework-exits.jsonl`.
- **In the console**: the run details page shows a warning alert naming the
  framework and how many tasks reported errors. Below that it lists up to three
  exit-code groups, each with the framework's message, and a
  **View full report** action. The report file appears in the Artifacts tab
  under a **Framework Warnings** group. Per-task `framework-exit.json` files
  stay in S3 but are hidden from the Artifacts tab.

This is the fastest path from "the run looks wrong" to the framework's own error
text, so check it before digging into CloudWatch. Two caveats:

- It is **Native mode only**. A Standard (Taurus) run writes no framework-exit
  report, so a crashed script there still leaves only its `.err` file or the
  `bzt` log. See the artifact groups in [[dlt-results-analysis]].
- A non-zero exit does **not** always mean a broken script. Even a k6
  threshold breach exits non-zero, so the alert can appear on a run whose load
  was entirely healthy. Read the message before concluding. Locust is the
  exception, because DLT runs it with `--exit-code-on-error=0`. A Locust alert
  therefore means the process itself crashed or could not load the locustfile.
  Failed requests and assertions show up only as failures in the results.

## Symptom: The Run Reports `failed` but Every Request Succeeded

DLT records a Native run that the **Safety duration** stops as `failed`, even
when the traffic was healthy the whole way through. Its metrics look fine:
requests sent, near-100% success, sensible latency. The console help text, the
CLI help, the API documentation, and the MCP guides describe this outcome as
completed, but both records show `failed`.

Recognize it by the shape rather than the reason string:

- Status `failed`. The scenario record's `errorReason` is
  `Step function execution failed`, and the run record has no `errorReason` and
  no `endTime`.
- The run's elapsed time is very close to `nativeRunMode.maxTestDurationSeconds`.
- Success count is high and the error count is low or zero.
- No framework warning alert, because a framework stopped at the cap has not
  exited on its own.

The cause is almost always a script with no stop condition of its own. DLT
passes the framework no run-time flag in Native mode, so only the cap can end
such a script. Reaching the cap counts as a failure. A script that terminates
on its own, with a few minutes of margin under the cap, records `complete`.

The fix belongs in the script, not in the cap. Give k6 an `options` block with
stages or an explicit duration, give Locust a `LoadTestShape` whose `tick()`
returns `None`, or give JMeter a thread group with a scheduler duration. See
[[dlt-k6-generation]], [[dlt-locust-generation]], and
[[dlt-jmeter-generation]]. Raising the cap only makes the symptom slower and
more expensive.
