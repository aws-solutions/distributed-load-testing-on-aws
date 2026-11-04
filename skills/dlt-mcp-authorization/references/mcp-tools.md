# DLT MCP Tools Reference

This reference lists the tools that the DLT remote MCP server exposes, whether each is read or write, and its parameters. It is verified against `source/mcp-server/toolSchema.json` (read tools), `source/mcp-server/toolSchema.write.json` (write tools), and `source/mcp-server/README.md`.

## How the Access Mode Gates Tools

You set `MCPServerAccessMode` at deploy time, and it decides which schema the gateway target loads:

- **ReadOnly** (default): the gateway exposes only the read tools below. The Lambda can only invoke `GET` on the DLT REST API.
- **ReadWrite** (v4.3.0 and later): the gateway exposes the read tools plus every write tool below. The Lambda additionally gets `POST`, `PUT`, `DELETE`, and `s3:PutObject` on the scenarios bucket.

`MCPServerAccessMode` and the write tools were added in v4.3.0. An MCP server on v4.2.x or earlier exposes only the read tools.

In ReadOnly mode the write tools are absent from the tool list, so a client cannot call them. There is no per-token or per-scope override: the mode stays fixed until you redeploy the stack. Read tools return no data unless the caller is authorized (see `auth-flows.md`).

## Tool Names as Clients See Them

These tables use the DLT tool names. The AgentCore Gateway prefixes each one with its target name, so `tools/list` returns, for example, `DltMcpToolsLambda___list_scenarios`, and a client calls the tool by that full name. Most MCP clients show the prefixed name; match on the part after `___`.

## Read Tools (Always Available When the Server Is Deployed)

| Tool | Parameters | Purpose |
| --- | --- | --- |
| `list_scenarios` | none | List all test scenarios. |
| `get_scenario_details` | `test_id` (required) | Test configuration and current status for one scenario. The tool always returns an empty `results` object and an empty `history` array, so call `get_latest_test_run` for the latest run's metrics. A `nativeRunMode` object in the response means the scenario uses the Native traffic shape, where the uploaded script owns the load and each task runs a full copy of it. For such a scenario, DLT never applied the stored concurrency, ramp-up, and hold-for, so they are not the load. The object's absence means Standard. |
| `list_test_runs` | `test_id` (required); `limit` (optional int, 1 to 30; when omitted the server requests 30 runs, although the tool's own description says the default is 20) or `start_timestamp` (optional ISO 8601), not both | Test runs for a scenario, newest first. Maximum 30 returned. Each run is a flattened summary (request counts, `requestsPerSecond`, `avgResponseTime`, `percentiles` in milliseconds) with no per-Region results. |
| `get_test_run` | `test_id` (required), `test_run_id` (required) | One test run, broken down per Region plus a `total` aggregate, per endpoint label. |
| `get_latest_test_run` | `test_id` (required) | The most recent test run for a scenario, in the same flattened summary shape as `list_test_runs`. Call `get_test_run` with its `testRunId` for the per-Region record. |
| `get_baseline_test_run` | `test_id` (required) | The baseline run set for comparison. |
| `get_test_run_artifacts` | `test_id` (required), `test_run_id` (required) | S3 bucket name and path prefix for a run's output. Returns `testRunPath` (v4.0.0 and later) and `testScenarioPath` (legacy fallback). It builds `testRunPath` from the run's stored `startTime`. The S3 folder name instead uses a separate UTC timestamp from the start of the run's orchestration. Those two timestamps can differ by seconds or, for a scheduled run, by a timezone offset. If `testRunPath` lists no objects, list `testScenarioPath` and use the folder whose name ends in `_{test_run_id}`. |

These tools feed [[dlt-results-analysis]] and [[dlt-diagnose-run]]: list and fetch runs, compare against a baseline, and locate artifacts in S3.

## Write Tools (Available Only in ReadWrite Mode)

These tools mutate DLT state or launch real load. Enable them deliberately.

| Tool | Key parameters | Purpose |
| --- | --- | --- |
| `create_test` | `test_name`, `test_description`, `test_type`, `test_task_configs`, `test_scenario` (all required); optional `test_id`, `show_live`, `tags`, `healthy_threshold`, `native_run_mode` | Create a scenario without running it. Script-based types require calling `upload_test_script` first. |
| `update_test` | same required set as `create_test` plus `test_id`; optional `native_run_mode` | Full replace of an existing scenario. The test must not be running. Omitting `native_run_mode` on an update of a Native scenario switches it to Standard, so carry it over from `get_scenario_details`. |
| `delete_test` | `test_id` (required) | Permanently delete a scenario and all its history, schedules, and dashboards. Cannot be undone. |
| `start_run` | `test_id` (required) | Start an existing scenario. Launches Fargate tasks and generates load. Returns with status `queued`. |
| `stop_run` | `test_id` (required) | Cancel a running test. Status transitions to `cancelled`. |
| `create_simple_schedule` | standard test fields plus `schedule_date`, `schedule_time`; optional `schedule_timezone`, `native_run_mode` | Create a one-time scheduled run (or add a schedule to an existing test). |
| `create_cron_schedule` | standard test fields plus `cron_value`, `recurrence`; optional `cron_expiry_date`, `schedule_timezone`, `native_run_mode` | Create a recurring scheduled run. The cron value must name exactly one minute, and runs must be at least an hour apart. |
| `update_simple_schedule` | standard test fields plus `test_id`, `schedule_date`, `schedule_time`; optional `schedule_timezone`, `native_run_mode` | Full replace of a one-time scheduled test (must already be `scheduled`). |
| `update_cron_schedule` | standard test fields plus `test_id`, `cron_value`, `recurrence`; optional `cron_expiry_date`, `schedule_timezone`, `native_run_mode` | Full replace of a recurring scheduled test (must already be `scheduled`). |
| `upload_test_script` | `test_type`, `file_extension` (required; `jmx`, `js`, `ts`, `py`, or `zip`); optional `test_id`, `file_content` | Upload a JMeter, k6, or Locust script or zip. Call it before creating a script-based test. Files under 25 KB can pass base64 `file_content`; larger files receive a presigned upload URL. Returns a `test_id` and `script_filename`. Reference that filename in `test_scenario.scenarios`; when it ends in `.zip`, the server declares the test's file type as `zip`. |
| `get_workflow_guides` | `workflow` (required) | Retrieve step-by-step recipes for multi-tool operations (`run_and_monitor`, `baseline_comparison`, `schedule_test`, `create_and_run`, `create_native_and_run`, `update_and_run`). A helper tool, included only in the ReadWrite schema. |

### Shared Write Parameter Shapes

- `test_type`: `simple` (inline HTTP requests) or `jmeter`, `k6`, `locust` (reference an uploaded script).
- `test_task_configs`: array of `{ region, task_count, concurrency }`. Total concurrent users in a Region equals `task_count * concurrency`. The Region must have a deployed DLT regional stack.
- `test_scenario`: `{ execution: [{ ramp-up, hold-for, scenario }], scenarios: { ... } }`. Durations are a number plus a unit, for example `30s` or `5m`. On v4.3.0 and v4.3.1, a run starts only when `ramp-up` and `hold-for` are written in seconds or minutes with an `s` or `m` suffix, for example `120m` rather than `2h`. v4.3.2 and later also accept `h`, `d`, and plain integers of seconds. See [[dlt-scenario-preflight-validation]].
- `tags`: up to 5, lowercase alphanumeric with hyphens, max 50 characters each.
- `healthy_threshold`: minimum percentage of Fargate tasks that must stay healthy; default 90.
- `native_run_mode`: `{ maxTestDurationSeconds }`, an integer from 1 to 86400 (24 hours) and the only allowed key. Include the object to select the Native traffic shape; omit it for Standard. Native is available for `jmeter`, `k6`, and `locust`, never for `simple`. Under Native the script defines the load, and every task runs a full copy of it, so total load is the script's load multiplied by `task_count`. `maxTestDurationSeconds` is a safety cap, not a schedule. The schema still requires `concurrency`, `ramp-up`, and `hold-for`; under Native they are placeholders that DLT ignores, so do not report them as the load. For a walkthrough, see the `create_native_and_run` workflow guide.

To validate a scenario payload before creating it, and for the full create-test schema, see [[dlt-scenario-preflight-validation]]. The `dlt` CLI (v4.3.0 and later) can also print a starter body with `dlt scenarios spec-template` and preview the exact request with `--dry-run` on `dlt scenarios create` or `update`. For reading results after a run, see [[dlt-results-analysis]].
