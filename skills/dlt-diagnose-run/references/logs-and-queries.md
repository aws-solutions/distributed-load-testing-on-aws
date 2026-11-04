# Reaching the logs and ECS state the console does not link to

This is a reference for [dlt-diagnose-run](../SKILL.md). The DLT web console
shows a status, a short `errorReason`, and for Native runs a framework warning
alert, but it does not link to CloudWatch Logs or the ECS console. Here is how to
reach each of them by hand. Everything below comes from
`source/infrastructure/lib/back-end/saved-queries.ts`,
`source/infrastructure/lib/testing-resources/ecs.ts`,
`source/common/src/naming.ts`, `source/common/src/log-events.ts`,
`source/task-runner/src/task-definition.ts`, `source/task-runner/src/dashboard.ts`,
`source/load-tester/src/lifecycle/run.ts`, and
`deployment/ecr/distributed-load-testing-on-aws-load-tester/load-test.sh`.

## The ECS Task Log Group and Streams

Every Fargate task logs to one CloudWatch log group per Region, created as
`DLTCloudWatchLogsGroup` by the main stack and by each regional stack. Find it
in the CloudWatch Logs console in the Region where the task ran; its name starts
with that stack's name and it has a `SolutionId` tag.

Each run registers its own task definition, so the stream name carries the test
identity. The format depends on the stack version:

| Stack version | Stream name |
| --- | --- |
| v4.2.x and earlier | `load-testing/<container-name>/<ecsTaskId>` |
| v4.3.x | `load-testing/<testId>/<container-name>/<ecsTaskId>` |

The container name depends on the traffic-shape mode:

- Standard mode (Taurus): `<stackName>-load-tester`.
- Native mode: `<stackName>-load-tester-jmeter`, `<stackName>-load-tester-k6`,
  or `<stackName>-load-tester-locust`, by framework.

The last segment is the Fargate task ID. From v4.3.0 you can list one test's
streams by prefix with a read-only call:

```bash
aws logs describe-log-streams --region <region> \
  --log-group-name <DLTCloudWatchLogsGroup name> \
  --log-stream-name-prefix "load-testing/<testId>/"
```

The stream name does not identify the run, so tell one run's streams apart by
time window or by the `testRunId` field inside the log events.

On v4.2.x and earlier the stream name does not contain the `testId`, so narrow
by time window and by the structured `testId` and `testRunId` fields inside the
log events instead. To find the task IDs for a run on any version, open the ECS
console (see below). The DLT - Test Errors saved query also returns them in its
`taskId` field.

What to read in a task stream depends on the mode:

- **Standard mode**: the `bzt` output and JSON lifecycle lines whose `logEvent`
  is `TASK_STARTED`, `TASK_COMPLETED`, `TASK_FAILED`, or
  `REPLACEMENT_TASK_SKIPPED`. The last marks a replacement task that arrived too
  late to join the run and wrote its completion marker without generating load.
- **Native mode**: JSON lines with `level`, `message`, `testId`, `testRunId`,
  `region`, and `taskId`. The messages trace the lifecycle: `setup complete`,
  `start signal received - running load test`, then either
  `load test complete - finalizing results` or
  `load test framework exited non-zero - finalizing available results` (with
  the exit code and the framework's stderr tail), or
  `maximum test duration reached - aborting load test` when the Safety duration
  fires, then `finalize complete - waiting for termination`. A setup failure
  logs a `TASK_FAILED` event with the message `fatal error`,
  `k6 runtime installation failed`, or
  `custom Python dependency installation failed`.

For a Native run with partial results (Branch A), the framework exit code and a
traceback or parse error here are the whole diagnosis.

## The Four Saved Logs Insights Queries

DLT ships four CloudWatch Logs Insights saved queries as CDK `QueryDefinition`
constructs in the **main stack's Region**. They appear in the CloudWatch console
under Logs Insights, in Saved queries, named with the stack name and Region as a
suffix, for example `DLT - Test Errors [<stackName> <region>]`. All of them
filter on fields the orchestration writes, so they survive log message
rewording. The orchestration Lambdas all run in the main stack's Region, and the
Test Errors query also covers that Region's ECS task log group. For a task that
ran in a regional stack's Region, run the same query by hand against that
Region's `DLTCloudWatchLogsGroup`.

### DLT - Test Timeline

This query shows the full lifecycle of one run across eleven orchestration
Lambdas: every one except the Results Parser and the Test Status Updater, which
write plain-text logs without a `testRunId` field. Replace the placeholder with
the run's `testRunId`.

```
fields @timestamp, logEvent, message, region, error
| filter testRunId = "REPLACE_WITH_TEST_RUN_ID"
| sort @timestamp asc
| limit 500
```

Log groups: the eleven orchestration Lambda log groups (all but the Results
Parser and the Test Status Updater). Use it to see how far a stuck run got and
which lifecycle event was last.

### DLT - Test Errors

This query returns all ERROR-level entries for one run, across those eleven
orchestration Lambdas and the main Region's ECS task log group.

```
fields @timestamp, logEvent, message, region, taskId, error
| filter testRunId = "REPLACE_WITH_TEST_RUN_ID" and level = "ERROR"
| sort @timestamp asc
```

Log groups: the eleven orchestration Lambda log groups (all but the Results
Parser and the Test Status Updater) plus the ECS task log group. Use it when
the `errorReason` is empty or unfamiliar, to find the log line that explains it.

### DLT - Task Failures

This query lists individual task deaths with their stop codes and failure
classification.

```
fields @timestamp, testId, testRunId, region, taskArn, stopCode, exitCode, stopCategory, stoppedReason
| filter logEvent = "TASK_FAILURE_DETECTED"
| sort @timestamp desc
| limit 50
```

Log group: the Task Failure Handler. Use it to see why tasks stopped when a run
failed on the threshold, then cross-reference the `exitCode` and `stopCode`
against the stop-code map in
[status-and-stop-codes.md](status-and-stop-codes.md). It keeps these details
long after the ECS console stops showing the stopped tasks. It covers task
deaths in the main stack's Region only, because the Task Failure Handler sees
ECS events from that Region only.

### DLT - Orphan Cleanup

This query shows the history of orphaned-service detection.

```
fields @timestamp, logEvent, message, region, cluster, orphanCount, orphanTestIds
| filter logEvent = "ORPHAN_DETECTED"
| sort @timestamp desc
| limit 50
```

Log group: the Orphan Cleanup Lambda. Use it to confirm the hourly backstop is
finding and removing leftover `dlt-` services.

## Recovering the Per-Region Reason Behind `Step function execution failed`

When a run records `Step function execution failed`, the specific per-Region
reason was passed to the cleanup Lambda but never stored. It is still in the logs. Run this
ad hoc query in the main stack's Region against the Task Status Checker and Test
Cleanup log groups (or the same log groups the Test Timeline query uses):

```
fields @timestamp, region, logEvent, errorReason, elapsedSeconds, deadline, completedTaskCount, desiredCount, warningTaskCount
| filter testRunId = "REPLACE_WITH_TEST_RUN_ID" and logEvent in ["COMPLETION_TIMEOUT", "CLEANUP_COMPLETE"]
| sort @timestamp asc
```

The earliest `CLEANUP_COMPLETE` entry for a failed Region carries the reason:
`Test execution timed out`, `Framework warning threshold breached`,
`Failed to send start command`, `Completion monitoring failed`, or
`Task failure threshold breached`. A later entry, from the cleanup that the SFN
Failure Handler starts, repeats the generic `Step function execution failed` for
every Region. Each `COMPLETION_TIMEOUT` entry shows how far past the deadline the
Region was and how many tasks had completed or warned.
If no Region shows a specific reason, the Safety duration ended the run (Branch D
in the SKILL).

## `logEvent` Vocabulary

The saved queries and your own ad hoc queries key on these `logEvent` values
from `LogEvent` in `@amzn/dlt-common`. Filter on the ones relevant to your
symptom.

| logEvent                   | Emitted when                                                    |
| -------------------------- | --------------------------------------------------------------- |
| `SERVICE_CREATED`          | The ECS service for a Region was created.                       |
| `TASK_RUNNER_FAILED`       | The task-runner handler failed during service or task creation. |
| `SERVICE_READY`            | All tasks are healthy and ready to run.                         |
| `STABILIZATION_FAILED`     | Stabilization failed (circuit breaker triggered).               |
| `STABILIZATION_TIMEOUT`    | The 30-minute stabilization timeout was exceeded.               |
| `REGIONAL_SYNC_COMPLETE`   | All Regions validated; the run may begin execution.             |
| `START_COMMAND_INVOKED`    | The start-command Lambda ran for a Region.                      |
| `START_COMMAND_COMPLETE`   | The S3 start marker was written.                                |
| `REGION_COMPLETE`          | All tasks in a Region wrote completion markers.                 |
| `COMPLETION_TIMEOUT`       | Completion monitoring timed out or the test stopped running.    |
| `TASK_FAILURE_DETECTED`    | An individual ECS task died non-gracefully.                     |
| `TASK_THRESHOLD_BREACHED`  | The task failure threshold was breached; run marked failed.     |
| `CLEANUP_COMPLETE`         | ECS resources were cleaned up for a Region.                     |
| `CLEANUP_FAILED`           | ECS cleanup failed for a Region.                                |
| `TEST_CANCEL_INITIATED`    | A user-initiated cancellation started.                          |
| `TASK_STARTED`             | A Standard task received the start signal and began the test.   |
| `TASK_COMPLETED`           | A Standard task finished the test and uploaded results.         |
| `TASK_FAILED`              | A task failed during setup or execution (both modes).           |
| `ORPHAN_DETECTED`          | An orphaned ECS service was detected.                           |
| `SFN_FAILURE_DETECTED`     | The step function exited non-success and the handler ran.       |

Standard containers also log `REPLACEMENT_TASK_SKIPPED`, which is not part of
the shared enum.

## The ECS Console: Stopped Reasons and Exit Codes

The exit code and stop reason for a stopped task are only in the ECS console
and the DLT - Task Failures query, not the DLT UI. In the Region where the test
ran, open the ECS cluster named after the stack, find the service named
`dlt-<testId>-<region>`, and open its Tasks tab. For a run that failed on tasks,
switch to stopped tasks and open one: the Stopped reason and the container's
Exit code are shown on the task detail page. Map them with the stop-code table
in [status-and-stop-codes.md](status-and-stop-codes.md). Service events on the
service's Events tab explain a run stuck in provisioning (image pull errors,
placement failures, health-check failures).

DLT deletes the service during cleanup, and ECS guarantees to show a stopped
task for only about an hour after it stops. For a run that just ended, filter
the cluster's Tasks tab by stopped status; for an older run, use the
DLT - Task Failures query instead.

## CPU, Memory, and the Standard Mode Dashboard

The DLT ECS cluster has CloudWatch Container Insights enabled. Use Container
Insights in the CloudWatch console, or the cluster's Metrics tab in the ECS
console, to see per-task CPU and memory during the run. That is the evidence for
an out-of-memory kill (exit 137) or a CPU-starved load generator.

For Standard runs only, the task-runner also creates a dashboard named
`EcsLoadTesting-<testId>-<region>`, one per test and Region rather than per run.
It charts virtual users, successes, failures, and average response time, parsed
from the Taurus console lines in the task log group, but not CPU or memory.
Native runs get no dashboard, because the Native containers do not emit those
Taurus lines.
