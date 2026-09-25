# DLT CLI

Command-line interface for [Distributed Load Testing on AWS](https://aws.amazon.com/solutions/implementations/distributed-load-testing-on-aws/).

Provides headless authentication and access to test scenarios, test run results, artifact downloads, and the ability to start load tests via the DLT REST API.

## Installation

### Portable bundle (recommended for CI/CD)

The repo includes a pre-built single-file bundle (`dlt-cli.mjs`) at `deployment/cli/dlt-cli.mjs` that requires only Node.js — no `npm install` or build step needed:

```bash
# Download the bundle directly from the repo (no git clone required)
curl -fsSLo /usr/local/bin/dlt \
  https://raw.githubusercontent.com/aws-solutions/distributed-load-testing-on-aws/main/deployment/cli/dlt-cli.mjs
chmod +x /usr/local/bin/dlt
dlt --version
```

Or copy from a local checkout:

```bash
cp deployment/cli/dlt-cli.mjs /usr/local/bin/dlt
chmod +x /usr/local/bin/dlt
```

### From source (development)

From the repository root:

```bash
npm install                    # installs all workspace dependencies
npm run bundle -w source/cli   # produces source/cli/dist/dlt-cli.mjs
node source/cli/dist/dlt-cli.mjs <command>
```

Or via Make:

```bash
make bundle-cli
node source/cli/dist/dlt-cli.mjs <command>
```

The open source distribution zip includes the pre-built bundle at `deployment/cli/dlt-cli.mjs`.

## Configuration

Import settings from the `aws-exports.json` file generated during stack deployment:

```bash
dlt configure --from-file /path/to/aws-exports.json
```

This automatically imports the S3 scenarios bucket name (`UserFilesBucket`) for artifact downloads.

Or provide values individually:

```bash
dlt configure \
  --api-endpoint https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod \
  --user-pool-id us-east-1_AbCdEfG \
  --user-pool-client-id 1234567890abcdef \
  --identity-pool-id us-east-1:aaaa-bbbb-cccc-dddd \
  --user-pool-domain dlt-xxxxx.auth.us-east-1.amazoncognito.com \
  --scenarios-bucket my-dlt-scenarios-bucket
```

Or run interactively (no arguments):

```bash
dlt configure
```

Configuration is saved to `~/.dlt/config.json`.

### Configuration Options

| Option                        | Required | Description                                                     |
| ----------------------------- | -------- | --------------------------------------------------------------- |
| `--from-file <path>`          | —        | Import from `aws-exports.json` (sets all fields automatically)  |
| `--api-endpoint <url>`        | Yes      | REST API Gateway endpoint URL                                   |
| `--user-pool-id <id>`         | Yes      | Cognito User Pool ID                                            |
| `--user-pool-client-id <id>`  | Yes      | Cognito User Pool Client ID                                     |
| `--identity-pool-id <id>`     | Yes      | Cognito Identity Pool ID                                        |
| `--user-pool-domain <domain>` | Yes      | Cognito Hosted UI domain                                        |
| `--region <region>`           | No       | AWS region (auto-detected from User Pool ID)                    |
| `--scenarios-bucket <name>`   | No       | S3 bucket for test artifacts (required for `dlt runs download`) |

## Authentication

The CLI supports three authentication modes:

| Mode              | Flag     | Use Case                       | Requires Browser |
| ----------------- | -------- | ------------------------------ | ---------------- |
| Browser (default) | _(none)_ | Interactive developer use      | Yes              |
| SRP               | `--srp`  | CI/CD with Cognito credentials | No               |
| IAM               | `--iam`  | CI/CD with IAM role            | No               |

### Browser Login (default)

```bash
dlt login
```

Opens your browser to the Cognito Hosted UI sign-in page. After authenticating, the CLI captures the callback on a local HTTP server (port 7521 by default, falling back to port 3000 if 7521 is already in use), exchanges the authorization code for tokens, and obtains temporary AWS credentials via the Cognito Identity Pool.

The callback server binds to `localhost` so it is reachable regardless of whether `localhost` resolves to IPv4 or IPv6 on your machine. If you do not complete sign-in in the browser, the CLI stops waiting after 5 minutes and exits with an error instead of hanging. Override the wait with `DLT_LOGIN_TIMEOUT_MS` (milliseconds), for example `DLT_LOGIN_TIMEOUT_MS=600000 dlt login`.

### SRP Headless Login (CI/CD with Cognito credentials)

Authenticates directly with Cognito using the Secure Remote Password (SRP) protocol. The password never travels over the wire in plain text. No browser required.

```bash
# Password via environment variable (recommended for CI/CD)
export DLT_PASSWORD='your-password'
dlt login --srp --username admin@example.com

# Password via flag (less secure — visible in process list)
dlt login --srp --username admin@example.com --password 'your-password'
```

The SRP flow obtains Cognito tokens and then exchanges them for temporary AWS credentials via the Identity Pool, just like browser login.

**Prerequisites:**

- The DLT stack must be deployed with SRP auth enabled on the UserPoolClient (included in the latest CDK template via `authFlows: { userSrp: true }`)
- The user must have set their permanent password (complete initial login via the web console if using a temporary password)

### IAM Direct Login (CI/CD with IAM role)

Skips Cognito entirely and uses ambient AWS credentials from the environment. This is ideal for CI/CD runners with an IAM role (EC2 instance profile, ECS task role, GitHub Actions OIDC, etc.).

```bash
# Uses the default AWS credential provider chain
dlt login --iam

# Or with explicit credentials
export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
export AWS_SESSION_TOKEN=FwoGZXIvYXdzEBY...
dlt login --iam
```

**Prerequisites:**
The IAM role used by your CI/CD runner must have `execute-api:Invoke` permission on the DLT API Gateway. Add this to your CI runner's IAM policy:

```json
{
  "Effect": "Allow",
  "Action": "execute-api:Invoke",
  "Resource": "arn:aws:execute-api:<region>:<account-id>:<api-id>/prod/*"
}
```

You can find the API ID in the `aws-exports.json` file or in the CloudFormation stack outputs.

### Logout

Remove stored credentials from disk:

```bash
dlt logout
```

This deletes `~/.dlt/credentials.json`. Use this when you're done with the CLI, especially on shared machines.

### Credential Storage

All modes save credentials to `~/.dlt/credentials.json` (mode 0600). Credentials include an `authMode` field indicating which mode was used.

Credential renewal behavior:

- **Browser/SRP**: Tokens are refreshed automatically using the refresh token. If the refresh token expires, re-run `dlt login`.
- **IAM**: Credentials are re-resolved from the provider chain when expired.

## CI/CD Examples

### GitHub Actions with SRP (using bundle)

```yaml
jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: |
          curl -fsSLo /usr/local/bin/dlt \
            https://raw.githubusercontent.com/aws-solutions/distributed-load-testing-on-aws/main/deployment/cli/dlt-cli.mjs
          chmod +x /usr/local/bin/dlt
      - run: |
          dlt configure --from-file aws-exports.json
          dlt login --srp --username "$DLT_USERNAME"
          dlt scenarios list
        env:
          DLT_PASSWORD: ${{ secrets.DLT_PASSWORD }}
          DLT_USERNAME: ${{ vars.DLT_USERNAME }}
```

### GitHub Actions with IAM (OIDC, using bundle)

```yaml
jobs:
  load-test:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/my-ci-role
          aws-region: us-east-1
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: |
          curl -fsSLo /usr/local/bin/dlt \
            https://raw.githubusercontent.com/aws-solutions/distributed-load-testing-on-aws/main/deployment/cli/dlt-cli.mjs
          chmod +x /usr/local/bin/dlt
      - run: |
          dlt configure --from-file aws-exports.json
          dlt login --iam
          dlt scenarios list
```

### GitHub Actions (from source — no bundle)

If you prefer to build from source (e.g., for testing unreleased changes):

```yaml
jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci && npm run build -w source/cli
      - run: |
          npx dlt configure --from-file aws-exports.json
          npx dlt login --srp --username "$DLT_USERNAME"
          npx dlt scenarios list
        env:
          DLT_PASSWORD: ${{ secrets.DLT_PASSWORD }}
          DLT_USERNAME: ${{ vars.DLT_USERNAME }}
```

### CodeBuild / ECS Task Role

```bash
# The task role provides credentials automatically
dlt configure --from-file /config/aws-exports.json
dlt login --iam
dlt runs latest my-test-id --format table
```

## Token Output

Output the current access token to stdout (useful for piping to other tools):

```bash
dlt token
```

Output the ID token instead:

```bash
dlt token --type id
```

Tokens are automatically refreshed if expired. In IAM mode, `dlt token` will error — use `dlt login --srp` or `dlt login` (browser) to get Cognito tokens.

### Token Status

Inspect the expiry status of all stored credentials:

```bash
dlt token status
dlt token status --format json
```

This shows remaining lifetime for Cognito tokens, AWS credentials, and refresh token presence. Useful for debugging authentication issues or verifying credential health in CI/CD.

## Scenarios

List all test scenarios:

```bash
dlt scenarios list
dlt scenarios list --format table
```

Get details for a specific scenario:

```bash
dlt scenarios get <testId>
```

Start (re-run) one or more test scenarios:

```bash
dlt scenarios start <testId>
dlt scenarios start <testId1> <testId2> <testId3>
```

Start a scenario by name instead of testId:

```bash
dlt scenarios start --name "My Load Test"
```

This fetches the scenario configuration, verifies Fargate capacity in all configured regions, and triggers a new test run via `POST /scenarios`. The command will fail early if:

- The test is already running
- There is insufficient Fargate capacity in any target region

| Option                      | Description                                                   |
| --------------------------- | ------------------------------------------------------------- |
| `--name <name>`             | Start a scenario by name instead of testId                    |
| `--wait`                    | Wait for the test(s) to complete before exiting               |
| `--poll-interval <seconds>` | Polling interval in seconds when using `--wait` (default: 15) |
| `--format <format>`         | Output format: `json` or `table`                              |

Wait for completion (useful in CI/CD):

```bash
dlt scenarios start my-test-id --wait --poll-interval 30 --format table
```

When `--wait` is used, the CLI polls until all started tests finish, then prints the final run results. The exit code is set to 1 if any test had errors or failed to start.

Example CI/CD usage:

```bash
dlt scenarios start my-test-id --format table
```

### Threshold Flags (Pipeline Gates)

The `scenarios start --wait` and `scenarios results` commands support threshold flags that exit with code 2 when a performance metric breaches the limit. This enables CI/CD pipeline gating based on load test outcomes.

All threshold values accept decimals, so you can gate more granularly than whole numbers (for example, `--fail-on-error-rate 0.5` or `--fail-on-baseline-regression 2.5`).

| Flag                                | Description                                         |
| ----------------------------------- | --------------------------------------------------- |
| `--fail-on-error-rate <percent>`    | Exit 2 if error rate exceeds threshold (0-100, decimals allowed) |
| `--fail-on-p99 <ms>`                | Exit 2 if p99 latency exceeds threshold             |
| `--fail-on-p95 <ms>`                | Exit 2 if p95 latency exceeds threshold             |
| `--fail-on-avg-rt <ms>`             | Exit 2 if average response time exceeds threshold   |
| `--fail-on-throughput-below <rps>`  | Exit 2 if throughput is below threshold (req/s)     |
| `--fail-on-baseline-regression <%>` | Exit 2 if any metric regresses beyond % vs baseline |

Example CI/CD pipeline gate (decimals accepted for finer-grained gates):

```bash
dlt scenarios start my-test-id --wait \
  --fail-on-error-rate 0.5 \
  --fail-on-p99 2000 \
  --fail-on-throughput-below 100
```

### Create a Scenario

Create a new test scenario with `dlt scenarios create`:

```bash
# Simple HTTP test
dlt scenarios create --test-name "API Test" --test-description "Load test" \
  --test-type simple --http-endpoint https://example.com/api \
  --concurrency 10 --task-count 2 --regions us-east-1 --hold-for 5m

# JMeter script test with file upload
dlt scenarios create --test-name "JMeter Test" --test-description "Script test" \
  --test-type jmeter --file ./test.jmx \
  --concurrency 5 --task-count 1 --regions us-east-1,eu-west-1 --hold-for 10m

# Recurring scheduled test with a cron expression
dlt scenarios create --test-name "Nightly Test" --test-description "Nightly run" \
  --test-type simple --http-endpoint https://example.com \
  --concurrency 10 --task-count 2 --regions us-east-1 --hold-for 5m \
  --cron "0 8 * * *"

# One-time run at a specific date/time (the console's "Run Once")
dlt scenarios create --test-name "Launch Test" --test-description "one-time run" \
  --test-type simple --http-endpoint https://example.com \
  --concurrency 10 --task-count 2 --regions us-east-1 --hold-for 5m \
  --schedule-date 2027-01-31 --schedule-time 14:30
```

| Option                      | Description                                      |
| --------------------------- | ------------------------------------------------ |
| `--test-name <name>`        | Name of the test scenario (required unless `--from-file`) |
| `--test-description <desc>` | Description of the test (required unless `--from-file`) |
| `--test-type <type>`        | Test type: simple, jmeter, k6, locust (required unless `--from-file`) |
| `--from-file <path>`        | Load field values from a JSON spec file (flags override the file) |
| `--file <path>`             | Path to script file (.jmx, .js, .ts, .py, .zip)  |
| `--http-endpoint <url>`     | HTTP endpoint for simple test type               |
| `--http-method <method>`    | HTTP method (default: GET)                       |
| `--body <body>`             | Request body for simple test                     |
| `--headers <json>`          | JSON string of headers                           |
| `--concurrency <number>`    | Standard mode: concurrent virtual users per region (required unless `--native-mode`) |
| `--task-count <number>`     | Task count per region (required)                 |
| `--regions <regions>`       | Comma-separated regions (required)               |
| `--tags <tags>`             | Comma-separated tags (max 5)                     |
| `--healthy-threshold <n>`   | Percent of healthy tasks required, 0-100 (default: 90) |
| `--ramp-up <duration>`      | Standard mode: ramp-up duration (default: 0s; ignored in Native mode) |
| `--hold-for <duration>`     | Standard mode: hold-for duration (required unless `--native-mode`) |
| `--native-mode`             | Select the Native traffic shape; omit for Standard (see below) |
| `--max-test-duration <dur>` | Native mode: safety timeout, e.g. 30m, 1h (max 24h) |
| `--cron <expression>`       | Recurring schedule: 5-field cron expression, e.g. `0 8 * * *` |
| `--schedule-date <date>`    | One-time run date, `YYYY-MM-DD` (with `--schedule-time`) |
| `--schedule-time <time>`    | One-time run time, `HH:MM` 24-hour (with `--schedule-date`) |
| `--schedule-timezone <tz>`  | Schedule timezone (default: UTC)                 |
| `--cron-expiry-date <date>` | ISO date for when schedule stops                 |
| `--save-only`               | Create without starting the test                 |
| `--format <format>`         | Output format: json, table, or csv               |

Durations accept a whole number of seconds or a number with a unit suffix: `s`, `m`, `h`, or `d` (e.g. `30s`, `15m`, `1h`, `1d`). Native-mode durations are capped at 24h.

### Run modes

A create runs in one of three modes, matching the web console:

- **Run Now** (default): no scheduling flags. The scenario is created and started immediately. Pass `--save-only` to create it without starting.
- **Run Once**: `--schedule-date YYYY-MM-DD --schedule-time HH:MM` runs the test one time at that moment (no recurrence). Both flags are required together.
- **Run on a Schedule**: `--cron "<expr>"` runs the test on a recurring schedule; the cadence lives in the cron expression. `--cron-expiry-date` is optional but recommended to bound the schedule — without it the schedule recurs until the scenario is updated or deleted.

`--cron` and `--schedule-date`/`--schedule-time` are mutually exclusive. All scheduled modes honor `--schedule-timezone` (default `UTC`).

Script files are validated against the test type before upload: `jmeter` expects `.jmx`, `k6` expects `.js`/`.ts`, `locust` expects `.py`, and any framework accepts a `.zip` bundle.

#### Defining a scenario in a file

`--from-file <path>` loads field values from a JSON spec file instead of passing
every flag. Keys are the camelCase option names; values may be the natural JSON
type (numbers, arrays, objects) — `regions`/`tags` accept an array, `headers` an
object. Command-line flags override matching keys in the file, so you can reuse
one spec and tweak a field per run. Unknown keys are rejected.

```jsonc
// scenario.json
{
  "testName": "API Load Test",
  "testDescription": "Nightly API load",
  "testType": "simple",
  "httpEndpoint": "https://api.example.com/health",
  "concurrency": 50,
  "taskCount": 5,
  "regions": ["us-east-1", "eu-west-1"],
  "holdFor": "10m",
  "tags": ["nightly", "api"],
  "healthyThreshold": 90
}
```

```bash
dlt scenarios create --from-file scenario.json
dlt scenarios create --from-file scenario.json --test-name "One-off name"   # flag wins
dlt scenarios update abc123 --from-file patch.json                          # apply fields to an existing scenario
```

Combine with `--dry-run` to validate a spec and preview the exact request body it produces, without creating anything:

```bash
dlt scenarios create --from-file scenario.json --dry-run --format json
```

Don't start from a blank file — generate a filled-in, type-aware starter with `scenarios spec-template`:

```bash
dlt scenarios spec-template --test-type simple > scenario.json          # or jmeter | k6 | locust
dlt scenarios spec-template --test-type k6 --native-mode > scenario.json # native template
# edit scenario.json, then:
dlt scenarios create --from-file scenario.json
```

The template includes scheduling fields (`cron`, `scheduleDate`, `scheduleTime`, `scheduleTimezone`) with empty values, which means **Run Now** by default. Fill `cron` for a recurring schedule, or `scheduleDate` + `scheduleTime` for a one-time run; leave them empty to run immediately.

#### Copying an existing scenario

To base a new test on an existing one, `scenarios copy` duplicates it into a new scenario (created saved, not started). For script tests the uploaded script is copied to the new scenario automatically.

```bash
dlt scenarios copy abc123                            # duplicate, same name
dlt scenarios copy abc123 --test-name "Copy of API"  # duplicate with a new name
dlt scenarios copy abc123 --dry-run --format json    # preview the new scenario body
```

#### Traffic shape: Standard and Native

Every scenario runs in one of two traffic-shape modes. Standard is the default; pass `--native-mode` to select Native. Native is available for the `jmeter`, `k6`, and `locust` test types, but not for `simple`, because it requires an uploaded script.

**Standard.** Standard mode puts DLT in control of the load. You set the Fargate task count per Region, the concurrent virtual users per task, a ramp-up period, and a hold duration, and DLT runs the test through the Taurus automation framework, which applies those values over whatever load your script declares. A Region's virtual users are the task count multiplied by the per-task concurrency. Standard is the only mode that lets you set an exact virtual-user count and change the ramp-up and hold shape without editing the script, and the only one that supports the Simple HTTP Endpoint type. Its limit is expressiveness: anything Taurus cannot represent, such as weighted scenarios, per-stage thresholds, or arrival-rate executors, is unavailable. This is how every DLT test ran before v4.3.0, so existing scenarios keep behaving exactly as they did.

**Native.** Native mode puts your script in control of the load. DLT runs the file you uploaded under the framework's own command line and passes no load flags, so your script is the sole authority on the traffic it generates. Two controls remain: how many Fargate tasks to launch per Region, and a required safety duration of up to 24 hours. The safety duration guards against a script that never exits rather than scheduling the run: if the test is still going when it elapses, DLT stops the framework, keeps the results for the portion that ran, and records the run as completed. Tasks are uncoordinated and each runs a full copy of the script, so a k6 script holding 200 virtual users on five tasks puts 1,000 virtual users on the target. Task count is therefore the only load dial; changing the ramp, the hold time, or the virtual-user count means editing the script. Native requires an uploaded script, so Simple HTTP Endpoint is unavailable, and Locust scripts must not set processes.

##### Choosing a mode

| If you need | Use |
| --- | --- |
| An exact virtual-user count, set from outside the script | Standard |
| To change the ramp-up or hold time without editing the script | Standard |
| A single URL with no script at all | Standard |
| The same load shape regardless of framework | Standard |
| To reuse a CI or local script unchanged | Native |
| The script's own stages, thresholds, or shape honored | Native |
| k6 scenarios, thresholds, or arrival-rate executors | Native |
| A Locust `LoadTestShape` or weighted task set | Native |
| JMeter timers and thread groups run exactly as authored | Native |
| To scale load only in whole multiples of the script's own load | Native |

##### Flags per mode

- Standard uses `--concurrency`, `--ramp-up`, and `--hold-for`.
- Native uses `--native-mode` and `--max-test-duration`, and ignores the three Standard flags.
- Both modes use `--task-count` and `--regions`.

```bash
# Native-mode Locust test
dlt scenarios create --test-name "Locust Native" --test-description "Native run" \
  --test-type locust --file ./locustfile.py \
  --task-count 2 --regions us-east-1 \
  --native-mode --max-test-duration 30m

# Native-mode k6 test
dlt scenarios create --test-name "k6 Native" --test-description "Native run" \
  --test-type k6 --file ./script.js \
  --task-count 1 --regions us-east-1 \
  --native-mode --max-test-duration 1h

# Native-mode JMeter test
dlt scenarios create --test-name "JMeter Native" --test-description "Native run" \
  --test-type jmeter --file ./test.jmx \
  --task-count 1 --regions us-east-1 \
  --native-mode --max-test-duration 20m
```

### Update a Scenario

Update parameters on an existing scenario. Only the specified flags are changed; all other settings are preserved.

```bash
# Update concurrency and hold duration
dlt scenarios update abc123 --concurrency 20 --hold-for 10m

# Update regions and task count
dlt scenarios update abc123 --regions us-east-1,eu-west-1 --task-count 4

# Update schedule
dlt scenarios update abc123 --cron "0 8 * * *" --cron-expiry-date 2027-01-01
```

Update accepts the same scheduling flags as create (`--cron`, `--schedule-timezone`, `--cron-expiry-date`, `--schedule-date`, `--schedule-time`), including the one-time "Run Once" flags.

`--tags` and `--healthy-threshold` are also accepted on update. A provided `--tags` replaces the existing tag set; omitting it preserves the current tags.

Scheduling on update follows the same replace-or-preserve rule: passing schedule flags (`--cron` or `--schedule-date`/`--schedule-time`) replaces the schedule, while omitting them preserves an already-scheduled scenario's schedule, so an unrelated edit (e.g. `--concurrency`) does not drop it.

A Native scenario stays Native across updates: its `nativeRunMode` configuration is preserved automatically. Pass `--max-test-duration` to change the safety timeout. Updating a Standard scenario likewise keeps it on Standard.

```bash
# Change the native safety timeout
dlt scenarios update abc123 --max-test-duration 45m
```

### Delete a Scenario

```bash
dlt scenarios delete <testId>
```

### Cancel a Running Test

```bash
dlt scenarios cancel <testId>
```

### Get Results

Fetch the most recent completed run results with optional threshold evaluation.

Output format is controlled by `--format table|json|csv` (default: `table`), consistent with the other data commands. The legacy `--json` and `--csv` flags are still supported as aliases for `--format json` and `--format csv`.

```bash
# Table output (default)
dlt scenarios results <testId>

# JSON output
dlt scenarios results <testId> --format json

# CSV output
dlt scenarios results <testId> --format csv

# Legacy aliases (equivalent to the --format forms above)
dlt scenarios results <testId> --json   # alias for --format json
dlt scenarios results <testId> --csv    # alias for --format csv

# CI/CD gate: fail if error rate > 5% or p99 > 2000ms
dlt scenarios results <testId> --fail-on-error-rate 5 --fail-on-p99 2000

# Thresholds accept decimals for finer-grained gates (e.g. 0.5%)
dlt scenarios results <testId> --fail-on-error-rate 0.5

# Fail if any metric regresses > 20% vs baseline
dlt scenarios results <testId> --fail-on-baseline-regression 20
```

| Option              | Description                                                        |
| ------------------- | ----------------------------------------------------------------- |
| `--format <format>` | Output format: `table` (default), `json`, or `csv`                |
| `--json`            | Legacy alias for `--format json`                                  |
| `--csv`             | Legacy alias for `--format csv`                                   |

`--json` and `--csv` are mutually exclusive, and an alias that disagrees with an explicit `--format` value (e.g. `--json --format csv`) is rejected with a clear error.

## Test Runs

List runs for a scenario:

```bash
dlt runs list <testId>
dlt runs list <testId> --limit 5
dlt runs list <testId> --start-timestamp 2026-01-01T00:00:00Z
dlt runs list <testId> --format table
```

All pages are fetched automatically (the API paginates results).

Get a specific run:

```bash
dlt runs get <testId> <runId>
```

Get the most recent run:

```bash
dlt runs latest <testId>
```

Get the baseline run:

```bash
dlt runs baseline get <testId>
```

### Set or Clear Baseline

Set a specific run as the baseline for comparison:

```bash
dlt runs baseline set <testId> --run-id <runId>
```

Clear the baseline:

```bash
dlt runs baseline clear <testId>
```

### Delete Run History

Delete one or more test runs from history, up to 25 per command:

```bash
dlt runs delete <testId> --run-id <runId>
dlt runs delete <testId> --run-id <runId1> --run-id <runId2>
```

### Active Runs

Show test scenarios that are currently in progress (running, pending, or provisioning):

```bash
# All active tests across all scenarios
dlt runs active

# Check a specific scenario
dlt runs active <testId>

# Table output
dlt runs active --format table
```

Example table output:

```
testId      testName          status   startTime
──────────────────────────────────────────────────────────
ztI8ibQWYz  K6 Simple         running  2026-03-04 23:56:59
9mylMWZ9X7  Simple Load Test  running  2026-03-04 23:56:50
```

### Artifacts

Get artifact info for a run (S3 prefix where results are stored):

```bash
dlt runs artifacts <testId> <runId>
```

### Download Artifacts

Download test run artifacts from S3 to your local machine:

```bash
# Download to a directory (default: ./<testId>-<runId>/)
dlt runs download <testId> <runId>

# Download as a .zip file
dlt runs download <testId> <runId> --zip

# Custom output location
dlt runs download <testId> <runId> -o ./my-results

# Only download specific files
dlt runs download <testId> <runId> --filter "*.xml"

# Preview what would be downloaded
dlt runs download <testId> <runId> --dry-run
```

**Prerequisites:** The scenarios bucket must be configured. If you used `dlt configure --from-file aws-exports.json`, this is set automatically. Otherwise:

```bash
dlt configure --scenarios-bucket <bucket-name>
```

| Option                   | Description                                                   |
| ------------------------ | ------------------------------------------------------------- |
| `-o, --output-dir <dir>` | Local directory or zip filename                               |
| `--zip`                  | Create a .zip file instead of extracting to a directory       |
| `--filter <glob>`        | Only download files matching pattern (e.g. `*.xml`, `*.json`) |
| `--dry-run`              | List files that would be downloaded without downloading       |

### Baseline Comparison

Compare all runs against the baseline with `--baseline`:

```bash
dlt runs list <testId> --baseline
```

Each run row includes delta columns showing percentage change vs. the baseline run. The baseline run itself is marked with a `◆ baseline` indicator.

In **table** format, deltas are semantically colored:

- **Throughput** metrics (requests, success): increase = green, decrease = red
- **Latency** metrics (avgResponseTime, p50, p90, p99): decrease = green, increase = red
- **Errors**: decrease = green, increase = red
- No change (`0.0%`) and unavailable (`--`) are dimmed

In **JSON** format, a `baseline` object is appended to each run with per-metric delta information.

## Output Formats

All data commands support `--format table` (default), `--format json`, or `--format csv`.

- **json**: Pretty-printed JSON to stdout
- **table**: Aligned text table to stdout with semantic coloring
- **csv**: Comma-separated values with a header row, suitable for importing into spreadsheets or data tools

### CSV Output

CSV format is available on commands that return tabular data. Values containing commas, quotes, or newlines are properly quoted per RFC 4180.

```bash
# Scenario results as CSV
dlt scenarios results <testId> --csv

# Runs list as CSV (pipe to file)
dlt runs list <testId> --format csv > results.csv

# Scenario list as CSV
dlt scenarios list --format csv
```

### Table Coloring

When outputting to a terminal (TTY), table output includes color to improve readability:

| Element                              | Color                                    |
| ------------------------------------ | ---------------------------------------- |
| Column headers                       | **Bold**                                 |
| Separator line                       | Dim                                      |
| Status: complete(d)                  | Green                                    |
| Status: running/pending/provisioning | Yellow                                   |
| Status: failed/cancelled             | Red                                      |
| Error count > 0                      | Red                                      |
| Baseline run ID                      | Cyan `◆ baseline` marker                 |
| Baseline Δ (good)                    | Green (↑ throughput or ↓ latency/errors) |
| Baseline Δ (bad)                     | Red (↓ throughput or ↑ latency/errors)   |
| Baseline Δ (neutral)                 | Dim (`0.0%` or `--`)                     |

Colors are automatically disabled when:

- Output is piped to another command (non-TTY)
- The `NO_COLOR` environment variable is set
- Use `FORCE_COLOR=1` to force colors even in non-TTY contexts

## Security Considerations

### Credentials at Rest

The CLI stores credentials in `~/.dlt/credentials.json` with file permissions `0600` (owner read/write only). This file may contain:

- **Browser/SRP mode**: Cognito ID token, access token, refresh token, and temporary AWS credentials
- **IAM mode**: Temporary AWS credentials (access key, secret key, session token)

**Best practices:**

- Run `dlt logout` when you're done, especially on shared or CI machines
- Ensure your home directory is on an encrypted filesystem (FileVault on macOS, LUKS on Linux)
- Do not copy `~/.dlt/credentials.json` to shared locations or commit it to version control

### Token Lifetimes

| Token / Credential                  | Default Lifetime | Renewal                         |
| ----------------------------------- | ---------------- | ------------------------------- |
| Cognito access token                | 1 hour           | Automatic via refresh token     |
| Cognito ID token                    | 1 hour           | Automatic via refresh token     |
| Cognito refresh token               | 1 day            | Re-run `dlt login`              |
| AWS STS credentials (Identity Pool) | ~1 hour          | Automatic via token refresh     |
| IAM mode credentials                | Varies by source | Re-resolved from provider chain |

The CLI automatically refreshes expired tokens when possible. If the refresh token itself has expired (after 1 day), you'll need to re-run `dlt login`.

### Shell History and Process Visibility

The `--password` flag exposes the password in two places:

1. **Process list** — other users on the same machine can see it via `ps aux`
2. **Shell history** — it's saved in `~/.bash_history`, `~/.zsh_history`, etc.

**Best practices:**

- **Prefer the `DLT_PASSWORD` environment variable** over the `--password` flag
- In CI/CD, use secrets managers (GitHub Secrets, AWS Secrets Manager, etc.)
- To prevent shell history recording for a single command, prefix it with a space (requires `HISTCONTROL=ignorespace` in bash, which is the default in most distributions; zsh requires `setopt HIST_IGNORE_SPACE`)
- Never hardcode passwords in scripts or configuration files

### SRP Password Safety

The SRP (Secure Remote Password) protocol is a zero-knowledge password proof — the password is never transmitted over the network in any form (not even hashed). The protocol uses ephemeral Diffie-Hellman-like key exchange combined with the password to produce a cryptographic proof. All network communication occurs over TLS.

However, the plaintext password is briefly held in Node.js process memory during authentication. This is inherent to any password-based authentication and cannot be avoided.

### Configuration File

`~/.dlt/config.json` contains non-secret configuration (API endpoint, Cognito IDs, S3 bucket name). While not sensitive credentials, it does reveal your DLT stack's infrastructure identifiers. The same file-permission practices apply.

## Usage Examples

### Scenario Lifecycle

Complete lifecycle of a test scenario from creation through cleanup:

```bash
# Create a scenario
dlt scenarios create --test-name "API Load Test" --test-description "Verify API under load" \
  --test-type simple --http-endpoint https://api.example.com/health \
  --concurrency 50 --task-count 5 --regions us-east-1,eu-west-1 --hold-for 10m
# Output: testId abc123

# Update concurrency for next run
dlt scenarios update abc123 --concurrency 100

# Start the test and wait for completion
dlt scenarios start abc123 --wait

# Cancel if needed (e.g., on pipeline timeout)
dlt scenarios cancel abc123

# Delete when no longer needed
dlt scenarios delete abc123
```

### CI/CD Pipeline Gate

Use threshold flags to fail the pipeline if performance degrades:

```bash
# Start test, wait for completion, fail if thresholds breached (exit code 2)
dlt scenarios start my-test-id --wait \
  --fail-on-error-rate 5 \
  --fail-on-p99 2000 \
  --fail-on-throughput-below 100

# Or evaluate results from the most recent completed run
dlt scenarios results my-test-id \
  --fail-on-error-rate 5 \
  --fail-on-p99 2000 \
  --fail-on-avg-rt 500

# Fail if any metric regresses more than 20% compared to the baseline run
dlt scenarios results my-test-id --fail-on-baseline-regression 20
```

Exit codes:

- `0` = test passed all thresholds
- `1` = general error (test not found, API error, no completed runs)
- `2` = threshold breach (one or more performance metrics exceeded limits)

### Results with CSV

Export test results for analysis in external tools:

```bash
# Export results to CSV file
dlt scenarios results my-test-id --csv > results.csv

# Pipe to data tools
dlt runs list my-test-id --format csv | csvtool col 1,3,5 -
```

### Baseline Management

Set, query, and clear the baseline run for regression comparisons:

```bash
# Set a known-good run as baseline
dlt runs baseline set my-test-id --run-id run-abc-123

# View the current baseline
dlt runs baseline get my-test-id

# Compare all runs against baseline (shows deltas)
dlt runs list my-test-id --baseline

# Clear the baseline
dlt runs baseline clear my-test-id
```

## Development

```bash
# Run tests
npm test -w source/cli

# Watch mode
npm run test:watch -w source/cli

# Type-check
npx tsc --noEmit -p source/cli/tsconfig.json

# Build
npm run build -w source/cli
```

### Project Structure

```
source/cli/
├── src/
│   ├── index.ts                  # CLI entry point
│   ├── commands/
│   │   ├── configure.ts          # dlt configure
│   │   ├── login.ts              # dlt login (browser/SRP/IAM)
│   │   ├── logout.ts             # dlt logout
│   │   ├── token.ts              # dlt token
│   │   ├── scenarios.ts          # dlt scenarios list/get/start/create/delete/cancel/update/results
│   │   └── runs.ts               # dlt runs list/get/latest/baseline/active/artifacts/download/delete
│   └── lib/
│       ├── api-client.ts         # Shared API client (SigV4, error handling, GET/POST/PUT/DELETE)
│       ├── artifact-downloader.ts # S3 artifact list/download/zip
│       ├── auth/                 # Authentication modules
│       │   ├── index.ts          # Barrel re-exports
│       │   ├── pkce.ts           # PKCE + OAuth callback server
│       │   ├── srp.ts            # SRP authentication
│       │   ├── iam.ts            # IAM credential resolution
│       │   ├── identity-pool.ts  # Cognito Identity Pool exchange
│       │   └── refresh.ts        # Credential refresh coordinator
│       ├── color.ts              # Semantic coloring (status, deltas, ANSI utils)
│       ├── config.ts             # Configuration management
│       ├── credentials.ts        # Credential storage
│       ├── error-handler.ts      # Shared error wrapper
│       ├── file-uploader.ts      # S3 file upload for script/zip files
│       ├── paths.ts              # Shared paths and directory helpers
│       ├── http-client.ts        # SigV4 HTTP client + unsigned helpers
│       ├── output.ts             # JSON/table/CSV formatting (ANSI-aware)
│       ├── run-formatters.ts     # Run row curation, baseline deltas, colored variants
│       ├── scenario-launcher.ts  # Capacity validation + test start
│       ├── threshold.ts          # Pipeline gate threshold evaluation (5 metrics)
│       └── types.ts              # API response type definitions
├── test/
│   └── lib/                      # Unit tests
├── generate-version.mjs          # Reads version from solution-manifest.yaml
└── package.json
```

## How It Works

1. **Configure** — stores Cognito and API Gateway settings from your DLT stack deployment
2. **Login** — three modes:
   - **Browser**: OAuth 2.0 Authorization Code + PKCE flow via Cognito Hosted UI → local HTTP callback → token exchange → Identity Pool credential exchange
   - **SRP**: USER_SRP_AUTH flow directly against Cognito (password never sent in plaintext) → token exchange → Identity Pool credential exchange
   - **IAM**: Reads ambient AWS credentials from the default provider chain (env vars, instance profile, ECS task role, etc.)
3. **API calls** — REST API requests are signed with AWS SigV4 using the temporary credentials
4. **Artifact downloads** — S3 objects are accessed directly using the same temporary credentials

The CLI targets the same REST API (IAM-authorized API Gateway) as the DLT web console.

## Command Reference

| Command                                           | Description                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `dlt configure`                                   | Configure CLI with stack settings                                     |
| `dlt login`                                       | Authenticate (browser, `--srp`, or `--iam`)                           |
| `dlt logout`                                      | Remove stored credentials                                             |
| `dlt token`                                       | Output access or ID token to stdout                                   |
| `dlt token status`                                | Show token and credential expiry status                               |
| `dlt scenarios list`                              | List all test scenarios                                               |
| `dlt scenarios get <testId>`                      | Get scenario details                                                  |
| `dlt scenarios create`                            | Create a new test scenario (with optional file upload/scheduling)     |
| `dlt scenarios spec-template`                     | Print a starter `--from-file` spec (`--test-type`, `--native-mode`)   |
| `dlt scenarios copy <testId>`                     | Duplicate a scenario into a new one (`--test-name`, `--dry-run`)      |
| `dlt scenarios update <testId>`                   | Update an existing test scenario                                      |
| `dlt scenarios delete <testId>`                   | Delete a test scenario                                                |
| `dlt scenarios cancel <testId>`                   | Cancel a running test scenario                                        |
| `dlt scenarios start [testId...]`                 | Start test run(s) (`--name`, `--wait`, `--poll-interval`, thresholds) |
| `dlt scenarios results <testId>`                  | Get results of the most recent completed run (with threshold gates)   |
| `dlt runs list <testId>`                          | List runs (`--baseline` for comparison deltas)                        |
| `dlt runs get <testId> <runId>`                   | Get run details                                                       |
| `dlt runs latest <testId>`                        | Get most recent run                                                   |
| `dlt runs baseline <testId>`                      | Get baseline run                                                      |
| `dlt runs baseline set <testId> --run-id <runId>` | Set a run as the baseline                                             |
| `dlt runs baseline clear <testId>`                | Clear the baseline run                                                |
| `dlt runs delete <testId> --run-id <runId>`       | Delete test run history                                               |
| `dlt runs active [testId]`                        | Show active (running/pending/provisioning) tests                      |
| `dlt runs artifacts <testId> <runId>`             | Show artifact S3 prefix                                               |
| `dlt runs download <testId> <runId>`              | Download artifacts locally                                            |
| `dlt --version`                                   | Show CLI version                                                      |
| `dlt --help`                                      | Show help                                                             |
