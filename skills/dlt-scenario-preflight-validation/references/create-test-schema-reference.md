# Create-Test Schema Reference

This is the field-by-field contract that `POST /scenarios` enforces on a
create-test payload. It is transcribed from the product's single source of
truth, `createTestSchema` in `source/common/src/api/schemas.ts`, with numeric
bounds from `source/common/src/api/limits.ts` and Native-mode fields from
`source/common/src/api/create-test.ts`. The checks that `createTest` in
`source/api-services/lib/scenarios/index.js` runs after the schema are listed
at the end, under "Rejected After the Schema".

The same schema applies whether you build the payload by hand, through the
`dlt` CLI, or through the web console. Both the console and the CLI validate the
same rules before they call the API. This reference lets you validate a raw
payload before any of them are involved.

## How a Failure Reaches You

The Lambda parses the JSON body, then runs `createTestSchema.parse(body)`. On
failure it formats every Zod validation issue as `path: message` and joins them
with `"; "`. It wraps the result as `INVALID_REQUEST_BODY: <joined messages>`
and returns it as an HTTP 400 whose body is that string, JSON-encoded. There is
no `{ "error": ... }` envelope. A body that is not valid JSON at all returns
HTTP 400 with the bare string `Invalid JSON in request body`.

## Top-Level Fields

| Field | Type | Required | Rule | Message when it fails |
|---|---|---|---|---|
| `testId` | string | no | 1 to 128 characters; letters, digits, and hyphens only | `testId is required` / `testId must not exceed 128 characters` / `testId must contain only alphanumeric characters and hyphens` |
| `testName` | string | yes | 3 to 255 characters; no leading or trailing whitespace; no control characters | `testName must be at least 3 characters` / `testName must not exceed 255 characters` / `testName cannot have leading or trailing whitespace` / `testName contains a disallowed control character: <name>` |
| `testDescription` | string | yes | 3 to 60000 characters | `testDescription must be at least 3 characters` / `testDescription must not exceed 60000 characters` |
| `testType` | enum | yes | one of `simple`, `jmeter`, `k6`, `locust` | `testType must be one of: simple, jmeter, locust, k6` |
| `fileType` | enum | no | one of `none`, `script`, `zip`; see cross-field rule below | rejected by the framework cross-field rule, not by the enum, when set to `none` for a framework test |
| `testTaskConfigs` | array | yes | at least one entry; see per-entry rules | `At least one test task configuration is required` |
| `testScenario` | object | yes | see the test-scenario section | field-level messages under `testScenario.*` |
| `regionalTaskDetails` | object | yes | map of Region to `{ dltAvailableTasks }`; each `dltAvailableTasks` is a positive integer | `dltAvailableTasks must be a positive integer` |
| `showLive` | boolean | no | boolean | type error |
| `tags` | array | no | at most 5 entries | `Maximum 5 tags allowed per scenario` |
| `healthyThreshold` | number | no (defaults to 90) | integer 0 to 100 | `healthyThreshold must be an integer` / `healthyThreshold must be between 0 and 100` |
| `nativeRunMode` | object | no | presence selects Native mode; see the Native mode section | field-level messages under `nativeRunMode.*` |
| `scheduleStep` | enum | no | `create` or `start` | enum error |
| `scheduleDate`, `cronExpiryDate` | string | no | `YYYY-MM-DD` | `Invalid date format. Expected format: YYYY-MM-DD` |
| `scheduleTime` | string | no | `HH:MM` or `HH:MM:SS`, 24-hour | `Invalid time format. Expected format: HH:MM or HH:MM:SS` |
| `recurrence` | enum | no | `daily`, `weekly`, `biweekly`, `monthly` | enum error |
| `cronValue` | string | no | five-field cron matching the product's fixed pattern; the minute field is a single number, hours allow steps and lists, day-of-week allows ranges and lists | `Invalid cron expression format. Hours support step values and lists. Day-of-week supports ranges and lists.` |
| `scheduleTimezone` | string | no | at most 64 characters | `scheduleTimezone must not exceed 64 characters` |
| `eventBridge` | string | no | string | type error |
| `saveOnly` | boolean | no | `true` creates the scenario without starting it | type error |

The schema uses `passthrough`, so it accepts and ignores unknown top-level
fields rather than rejecting them. Bring only the fields you need. An optional
field may be left out, but an explicit `null` is rejected, at every level of the
payload. An integer field rejects any number beyond 9007199254740991
(`Number.MAX_SAFE_INTEGER`), and each task config, execution entry, and scenario
config must be an object.

Some rules report Zod's generic wording rather than the custom message in these
tables. A numeric `0` for `taskCount` or `dltAvailableTasks` returns
`Too small: expected number to be >0`, a non-integer number returns
`Invalid input`, an invalid scenario name returns `Invalid key in record`, and
an unknown `fileType` returns `Invalid option: expected one of "none"|"script"|"zip"`.

## `testTaskConfigs` Entries

Each entry describes one Region's Fargate fan-out.

| Field | Type | Rule | Message when it fails |
|---|---|---|---|
| `region` | string | matches an AWS Region format such as `us-west-2`, `us-gov-west-1`, `eu-central-1` | `Invalid region format (expected: us-west-2, us-gov-west-1, eu-central-1, etc.)` |
| `taskCount` | integer or numeric string | positive integer, at least 1 | `taskCount must be a positive integer` |
| `concurrency` | integer or numeric string | 1 to 25000 inclusive | `concurrency must be between 1 and 25000` |

In Native mode `concurrency` is still required and still validated, but Native
ignores it; the console sends `1`.

`taskCount` has no application ceiling in the schema. The real limit is your
account's Fargate vCPU quota in each Region at run time, so a payload that
passes here can still fail to launch. Plan the fan-out with the capacity skill
before you submit. See [[dlt-capacity-and-region-planning]].

## `testScenario`

| Field | Type | Rule | Message when it fails |
|---|---|---|---|
| `execution` | array | at least one entry | `At least one execution configuration is required` |
| `scenarios` | object | optional; if present, at least one named scenario | `At least one scenario must be defined in scenarios object` |
| `reporting` | array | optional reporting-module entries | module-specific messages |

### `execution` Entries

Each entry may carry `concurrency`, `ramp-up`, `hold-for`, `scenario`,
`executor`, and `taskCount`. All are optional at the field level, but
`createTest` requires `ramp-up` and `hold-for` on the first entry (see
"Rejected After the Schema"). The cross-field rule below ties `scenario` to the
`scenarios` object.

| Field | Rule | Message when it fails |
|---|---|---|
| `concurrency` | 1 to 25000 inclusive | `concurrency must be between 1 and 25000` |
| `ramp-up` | duration string or non-negative integer (see durations) | `ramp-up must be in format: number followed by s, m, h, or d` and cap messages |
| `hold-for` | duration string or positive integer (see durations) | `hold-for must be in format: number followed by s, m, h, or d` and cap messages |
| `executor` | one of `locust`, `k6`, `jmeter` | enum error |
| `taskCount` | positive integer (number form only) | type error |
| `scenario` | must name a key present in `scenarios` | `Execution references scenario '<name>' that doesn't exist in scenarios object` |

### `scenarios` Entries

`scenarios` is a map whose keys are scenario names. A key follows the same rules
as `testName`: 3 to 255 characters, no leading or trailing whitespace, no
control characters. Each value is a scenario config whose `requests` array is
validated:

| Field | Rule | Message when it fails |
|---|---|---|
| `requests` | at least 1 and at most 100 entries | `Each scenario must have at least one request` / `Each scenario cannot exceed 100 requests` |
| `requests[].url` | valid HTTP or HTTPS URL, at most 2048 characters | `url must be a valid HTTP/HTTPS URL` / `url must not exceed 2048 characters` |
| `requests[].method` | one of `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS` | `method must be a valid HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)` |
| `requests[].headers` | optional map of string to string | type error |
| `requests[].body` | optional string, at most 65536 characters | `body must not exceed 65536 characters` |

## Duration Strings (ramp-up and hold-for)

A duration is either an integer (seconds) or a string of digits plus one suffix,
matching `^\d+[smhd]$`. Each suffix has its own maximum:

| Suffix | Meaning | Maximum | Cap message |
|---|---|---|---|
| `s` | seconds | 3600 | `<field>: value <n> exceeds maximum of 3600 seconds` |
| `m` | minutes | 1440 | `<field>: value <n> exceeds maximum of 1440 minutes` |
| `h` | hours | 168 | `<field>: value <n> exceeds maximum of 168 hours` |
| `d` | days | 30 | `<field>: value <n> exceeds maximum of 30 days` |

`ramp-up` allows zero; `hold-for` must be greater than zero. The schema accepts
the integer form for backward compatibility: `ramp-up` accepts any non-negative
integer, and `hold-for` accepts any positive integer.

On v4.3.0 and v4.3.1 the schema is more permissive than `createTest`, which
computes the run duration from the first execution entry and reads only string
values with an `s` or `m` suffix. On those releases, write both fields as
strings in seconds or minutes, for example `120m` rather than `2h`; see
"Rejected After the Schema". From v4.3.2, `createTest` reads every form the
schema accepts, including `h`, `d`, and plain integers of seconds.

These `ramp-up` and `hold-for` fields shape the load in Standard mode. In Native
mode they are unused placeholders (`"0s"` and `"1s"`), and the `nativeRunMode`
field below takes their place.

## Cross-Field Rules

These run after the field checks and catch mistakes that no single field can
see on its own.

1. **Framework tests need a script or zip.** When `testType` is `jmeter`, `k6`,
   or `locust` and `fileType` is `none`, the schema rejects the payload with
   `fileType must be script or zip for <testType> tests`. Put differently,
   `fileType: none` is only valid for `testType: simple`.
2. **Execution must reference a real scenario.** For every execution entry whose
   `scenario` is set, that name must be a key in the `scenarios` object.
   Otherwise: `Execution references scenario '<name>' that doesn't exist in scenarios object`.
3. **Native mode needs a script.** The schema rejects `nativeRunMode` on a
   `simple` test with `nativeRunMode is only supported for jmeter, k6, and locust tests`.
4. **Native mode is a strict object.** See the Native mode section.

## Native Mode (`nativeRunMode`)

Native mode, which the web console labels the **Native** traffic shape, is new
in DLT v4.3.0. Including a `nativeRunMode` object selects it, and omitting the
object selects Standard mode, which runs the test through Taurus. Every rule
above still applies. Native mode adds exactly one field.

| Field | Type | Rule | Message when it fails |
|---|---|---|---|
| `nativeRunMode.maxTestDurationSeconds` | integer | 1 to 86400 (24 hours) | `maxTestDurationSeconds must be at least 1` / `maxTestDurationSeconds must not exceed 86400 (24 hours)` |

**`nativeRunMode` is a strict object.** Its schema declares `maxTestDurationSeconds`
and nothing else, so **any** additional key is rejected rather than ignored. There
are no per-framework load fields and no cross-field duration rules in Native mode.

### Where the Load Shape Lives

The script is the sole authority on the load and on when the run ends, because DLT
passes the framework no load or duration flags in Native mode:

| Framework | What shapes the load and stops the run |
|---|---|
| k6 | the script's `options` block (`stages`, `scenarios`, or `vus` plus `duration`) |
| Locust | a `LoadTestShape` whose `tick()` returns `None` at the deadline |
| JMeter | the thread group, for example a scheduler `duration` with a looping controller |

`maxTestDurationSeconds` is a **force-stop cap**, not a shape. The console labels
it **Safety duration** on the create form, and the read-only Load Configuration
summary shows it as `Native Mode · <duration> max duration`; both are this
field. Its CLI flag is `--max-test-duration`, its MCP parameter is
`native_run_mode.maxTestDurationSeconds`, and it defaults to 4 hours in the
console. A script with no stop condition of its own therefore runs until the cap
fires, spending the full cap in Fargate on every task in every Region. DLT
records such a capped run as **failed** with the reason
`Step function execution failed`, even when every request succeeded; see
[[dlt-diagnose-run]]. The console's help text and the API documentation
say such a run is recorded as completed; the run record says failed. Validate
that the script terminates on its own, several minutes before the cap.

## Rejected After the Schema

`createTest` runs these checks after `createTestSchema` passes. Each failure is
an HTTP 400 whose body is `<Code>: <message>`, not `INVALID_REQUEST_BODY`, except
the HTTP 500 capacity error in the second row. The bundled validator checks the
first three offline and lists them separately. For the fourth, which applies
only to v4.3.0 and v4.3.1, it prints a note without failing the payload.

| Check | Message when it fails |
|---|---|
| Every `testTaskConfigs` Region has a `regionalTaskDetails` entry. On v4.3.2 and later this applies to `saveOnly` requests; a run start builds the entries itself and fails this way only when the Region has no deployed stack. | `InvalidRegionalStack: The regional stack for "<region>" no longer exists. Please remove this region from the scenario or redeploy the regional stack.` |
| Each `taskCount` is at most the Region's available tasks: the `dltAvailableTasks` you send on v4.3.0, v4.3.1, and any `saveOnly` request, or the capacity the API reads itself for a run start on v4.3.2 and later | `InvalidParameter: Task count should be positive number between 1 to N.` On v4.3.2 and later, a start whose capacity cannot be read fails with HTTP 500 `FARGATE_CAPACITY_UNAVAILABLE: Unable to determine the available Fargate capacity for "<region>". Please try again.` |
| `execution[0]` carries both `ramp-up` and `hold-for` | a `TypeError`, because both are parsed unconditionally; Native mode sends the placeholders `"0s"` and `"1s"` |
| On v4.3.0 and v4.3.1 only: `execution[0]` `ramp-up` and `hold-for` are strings with an `s` or `m` suffix (an integer `ramp-up` of `0` is also accepted) | `InvalidParameter: Invalid hold-for unit, it should be either m or s.` for `h`, `d`, or an integer `ramp-up`, even when the field is `ramp-up`; `TypeError: testDuration.match is not a function` for an integer `hold-for`. Fixed in v4.3.2. |

On v4.3.0 and v4.3.1, the `s` or `m` check runs when the scenario starts, or
when a cron schedule is created. A `saveOnly` create skips it, so an `h` or `d`
duration saves cleanly and then fails when the scenario is started. The console
on those releases offers an Hours unit that hits this defect. Write hours as
minutes instead, for example `120m` rather than `2h`; each field is capped at
1440 minutes. v4.3.2 and later also accept `h`, `d`, and plain integers of
seconds.

## Not Covered by This Schema or the Validator

Some rules need the live deployment, so a payload can pass preflight and still
be adjusted or rejected later:

- **Tag format.** The schema caps tags at 5. After that cap, the scenarios
  handler rewrites each tag rather than rejecting it. It trims and lowercases
  the tag, turns runs of whitespace into a hyphen, and deletes every character
  outside `a-z`, `0-9`, and `-`. Repeated hyphens collapse into one, and leading
  and trailing hyphens are stripped. Any tag that ends up empty or longer than
  50 characters is then silently dropped, along with duplicates. So
  `"Has Space"` is stored as `has-space`, and `"!!!"` disappears without an
  error. The `Invalid tag format: <tags>` check runs after that normalization
  and cannot fire in practice. Compare the stored tags with what you sent if a
  tag filter later matches nothing.
- **Current regional capacity.** On v4.3.0 and v4.3.1, the API checks
  `taskCount` against the `dltAvailableTasks` you send, which is a snapshot, so
  compute it fresh just before you submit as floor((`vCPULimit` minus
  `vCPUsInUse`) divided by `vCPUsPerTask`) from `GET /vCPUDetails`. On v4.3.2
  and later, a run start ignores the value you send and reads the capacity
  itself, so a start can still fail when the Region's free capacity has dropped.
  See [[dlt-capacity-and-region-planning]].
- **The uploaded script.** For a `jmeter`, `k6`, or `locust` test, `createTest`
  confirms the script or zip exists in the scenarios bucket under the payload's
  `testId` and `fileType`.
- **Regional stack versions.** A regional stack outside the hub's compatibility
  window fails with `INCOMPATIBLE_REGIONAL_STACKS`. From v4.3.0 the minimum is
  `4.3.0`.
- **A run already in progress.** Starting a scenario whose previous run is still
  running, or whose ECS service is still draining, is rejected.
- **The network the tasks will run in.** A payload names Regions, never a VPC
  or subnets. Those come from each Region's stack, deployed with `ExistingVPCId`,
  `ExistingSubnetA`, and `ExistingSubnetB`, and are merged into the scenario's
  `testTaskConfigs` at run time from the `region-<region>` config record. So a
  valid payload can still produce a run whose tasks never start, because the
  Region's VPC cannot host them. Nothing in this schema can catch that.
  Validate the VPC separately with [[dlt-network-and-permissions-preflight]],
  which ships a read-only checker.
- **Path and query parameters.** `testId` and `testRunId` in the URL path, and
  query parameters, have their own schemas and their own error codes
  (`INVALID_PATH_PARAMETER`, `INVALID_QUERY_PARAMETER`).
