# Calibration Procedure, Command by Command

This is the detailed version of the workflow in `SKILL.md`, with the commands for each step. It
assumes a DLT v4.3.0 or later stack, the `dlt` CLI configured against it, and the AWS CLI with read
access to CloudWatch Logs and the stack's scenarios bucket. Commands that need your values show
them in angle brackets. `<skill-dir>` is the skill directory, which contains `SKILL.md`.

## 1. Choose the Steps

A calibration is a stepped schedule per task: a warm-up ramp, then holds at increasing rates. Pick
the rates so that at least three holds fall below the knee (the rate where task CPU crosses 75
percent) and the schedule continues past it.

- For a light request (a plain GET with a small response), a task reached the knee near 15,000
  RPS on older Fargate hosts. A schedule of 1,000, 2,000, 4,000, 8,000, 12,000, 16,000, and 20,000
  per task found it.
- For heavier requests, the knee is lower. If you have no idea where it is, run a short two-step
  probe first, for example 500 and 2,000 RPS for 5 minutes each on one task. Then extrapolate from
  the CPU those steps used.
- Hold each step 5 minutes. Analysis drops the first minute of each hold. Keep the 3-minute
  warm-up, because the JIT takes about two minutes to settle.

## 2. Build the Plan

For one HTTP request:

```bash
python3 -I <skill-dir>/scripts/make_calibration_plan.py \
  --url https://<host>/<path> \
  --steps 1000,2000,4000,8000,12000,16000,20000 \
  -o calibration.jmx
```

Add `--method`, `--header 'Name: value'` (repeatable), and `--body` for other requests. Pass a
credential header such as `Authorization` with `--header-env 'Name=ENVVAR'`, which reads a
short-lived, test-only value from the environment so that it stays out of argv. The script
writes `calibration.jmx` and `calibration.jmx.profile.json`, and prints the plan's total duration.

For your own plan, retrofit the load model described in [jmeter-load-model.md](jmeter-load-model.md)
and add the telemetry sampler as described in [telemetry-sampler.md](telemetry-sampler.md). Then
write a profile file by hand in the same shape as the generated one:
`{"profile": [[start, end, seconds], ...]}`.

Check the bundle before uploading with `dlt-test-packaging-and-lint`.

## 3. Run It

```bash
dlt scenarios create --test-name "rps calibration" --test-description "stepped calibration" \
  --test-type jmeter --file calibration.jmx \
  --task-count 5 --regions <region> \
  --native-mode --max-test-duration 50m --save-only

# After the user approves the run
dlt scenarios start <testId>
```

- `--save-only` creates the scenario without running it, and the command prints the test ID.
  Without it, creating the scenario starts the run at once. Start the run only after the user has
  seen the target, the Region, the task count, the rate steps, and the duration, has confirmed
  being authorized to load test the target, and has approved the run.
- Use 3 to 5 tasks. Each task is an independent sample on its own host.
- Set `--max-test-duration` above the plan's total duration. It is the Native mode safety timer.
- `dlt scenarios create` always leaves live data off. If the full run will use live data, which
  cost about 20 percent of task capacity in the study, start the calibration from the console with
  live data on instead.
- Watch the target. If its errors or latency rise, the calibration is measuring the target.

Poll until the run finishes:

```bash
dlt scenarios get <testId> --format json     # status: running, then complete
```

## 4. Collect the Data

Get the run ID and its start and end times:

```bash
dlt scenarios results <testId> --format json  # testRunId, startTime, endTime
```

### Small Runs

Download everything:

```bash
dlt runs download <testId> <runId> --output-dir calibration-run
```

The directory then holds one folder per task, `calibration-run/<region>/<taskId>/`, with
`kpi.jtl`, `result.json`, `jmeter.log`, and the sampler's `telemetry.csv` and
`telemetry-meta.json`.

### Large Runs

At about 150 bytes per request, a task that sends 19 million requests writes about 2.8 GB of JTL.
Download the small files, then stream each `kpi.jtl` through the aggregator and keep only its
per-second summary:

```bash
dlt runs download <testId> <runId> --output-dir calibration-run --filter '*telemetry*'
dlt runs download <testId> <runId> --output-dir calibration-run --filter '*.json'

aws s3 ls s3://<ScenariosBucket>/results/<testId>/ --recursive | grep kpi.jtl
# for each key results/<testId>/<prefix>/<region>/<taskId>/kpi.jtl:
aws s3 cp s3://<ScenariosBucket>/<key> - \
  | python3 -I <skill-dir>/scripts/jtl_aggregate.py - -o calibration-run/<region>/<taskId>/kpi-1s.csv
```

The `--filter` glob matches the whole path below the run, `<region>/<taskId>/<file>`, so it needs
a leading `*`. `ScenariosBucket` is an output of the main DLT stack. `analyze_calibration.py`
reads `kpi-1s.csv` wherever `kpi.jtl` is absent.

### Task CPU From Container Insights

Use this when the plan ran without the telemetry sampler, or in Standard mode, or as a
cross-check. DLT turns on Container Insights for its ECS clusters, and each per-minute task event
in the performance log group carries the task's CPU, memory, and network:

```bash
aws logs filter-log-events --region <region> \
  --log-group-name /aws/ecs/containerinsights/<stack name>/performance \
  --start-time <run start, epoch ms> --end-time <run end, epoch ms> \
  --filter-pattern '{ $.Type = "Task" && $.TaskDefinitionFamily = "dlt-worker-<testId>" }' \
  --output json > ci-events.json
```

- The cluster, and so the log group, is named after the DLT stack: the main stack in its own
  Region, and the regional stack elsewhere.
- DLT registers each test's task definition family as `dlt-worker-<testId>`.
- ECS creates this log group with a 1-day retention. Collect the events within a day, or, after the user
  approves the change, raise the retention first:
  `aws logs put-retention-policy --log-group-name /aws/ecs/containerinsights/<stack name>/performance --retention-in-days 30`.
- `CpuUtilized` is in CPU units, where 1,024 is one vCPU. A DLT task reserves 2,048.

## 5. Analyze and Fit

```bash
python3 -I <skill-dir>/scripts/analyze_calibration.py calibration-run \
  --profile calibration.jmx.profile.json \
  --ci-events ci-events.json \
  --baseline-out baseline.json --target-rps <peak RPS> --region <region>=<available tasks>
```

`--ci-events` is optional when every task has `telemetry.csv`. For each task, the output shows:

- **One line per hold:** scheduled and achieved rate, CPU, mean and p99 latency, heap after GC,
  container memory, requests in flight, and errors.
- **The fit:** `c0`, `c1` per 1,000 RPS, r², and `R_cpu`, the rate at the CPU limit.
- **The knee:** the first hold where a saturation signal tripped, and which signal it was.
- **Pool shortfalls:** holds that fell short of schedule while CPU was under the limit and latency
  was flat. These point at the pool, not at saturation: raise the spare threads and rerun those
  steps.

Across tasks it reports the 10th percentile of `R_cpu`, the spread, `R_cpu` per host CPU model,
and `R*` with the margin applied. A coefficient of variation under 10 percent on one CPU model
means the calibration is repeatable. If tasks landed on different CPU generations, size from the
slowest generation.

## 6. Plan the Full Test

Open `baseline.json` and set:

- `target.peak_rps` and `target.shape`: ramp and hold segments in total RPS.
- `regions`: each Region's `available_tasks` (see `dlt-capacity-and-region-planning`) and
  `rt_ms`, the latency from that Region to the target.

Then:

```bash
python3 -I <skill-dir>/scripts/plan_from_baseline.py baseline.json
```

The calculator prints the task count per Region, the per-task rate, the predicted CPU and requests
in flight per task, and the per-task Throughput Shaping Timer profile.

## 7. Build, Stage, and Run

Build the full-run plan from the calculator's profile:

```bash
python3 -I <skill-dir>/scripts/make_calibration_plan.py --url https://<host>/<path> \
  --profile "line(1,12500,300s) const(12500,600s)" -o full-run.jmx
```

Stage it first at 10 to 25 percent of the peak. `python3 -I <skill-dir>/scripts/plan_from_baseline.py
baseline.json --peak-rps <smaller peak>` gives the smaller task count and profile. Compare each
task's CPU with the prediction, then run the full plan.

`dlt scenarios create --task-count` applies the same count to every Region in `--regions`, and a
`--from-file` spec takes the same single `taskCount`. For different counts per Region, create the
scenario in the console or with the MCP `create_test` tool, whose `test_task_configs` list takes a
`task_count` per Region (MCP write tools need `MCPServerAccessMode=ReadWrite`).
`dlt scenarios start` then reruns it with the stored counts.

## 8. Verify

Analyze the full run the same way, with `full-run.jmx.profile.json`, and compare:

- Total delivered RPS against the plan.
- Per-task CPU against the prediction, by host CPU model.
- The target's own error rate, latency, and headroom.

In the study, a 9-task plan for 100,000 RPS delivered 99,873 RPS. Its tasks on older hosts ran at
55 to 61 percent CPU, against a predicted 59 to 63 percent.
