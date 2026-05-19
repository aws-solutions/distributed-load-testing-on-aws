# DLT CLI

Command-line interface for [Distributed Load Testing on AWS](https://aws.amazon.com/solutions/implementations/distributed-load-testing-on-aws/).

Provides headless authentication and access to test scenarios, test run results, artifact downloads, and the ability to start load tests via the DLT REST API.

## Installation

### Portable bundle (recommended for CI/CD)

The repo includes a pre-built single-file bundle (`dlt-cli.mjs`) at `deployment/cli/dlt-cli.mjs` that requires only Node.js — no `npm install` or build step needed:

```bash
# Download the bundle directly from the repo (no git clone required)
curl -sLo /usr/local/bin/dlt \
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
npm install            # installs all workspace dependencies
npm run build -w source/cli   # compiles TypeScript
npm link -w source/cli        # makes `dlt` available globally
```

Or run directly:

```bash
node source/cli/dist/index.js <command>
```

### Building the bundle locally

```bash
npm run bundle -w source/cli   # produces source/cli/dist/dlt-cli.mjs
```

Or via Make:

```bash
make bundle-cli
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
          curl -sLo /usr/local/bin/dlt \
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
          curl -sLo /usr/local/bin/dlt \
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

| Option                          | Description                                         |
| ------------------------------- | --------------------------------------------------- |
| `--name <name>`                 | Start a scenario by name instead of testId          |
| `--wait`                        | Wait for the test(s) to complete before exiting     |
| `--poll-interval <seconds>`     | Polling interval in seconds when using `--wait` (default: 15) |
| `--format <format>`             | Output format: `json` or `table`                    |

Wait for completion (useful in CI/CD):

```bash
dlt scenarios start my-test-id --wait --poll-interval 30 --format table
```

When `--wait` is used, the CLI polls until all started tests finish, then prints the final run results. The exit code is set to 1 if any test had errors or failed to start.

Example CI/CD usage:

```bash
dlt scenarios start my-test-id --format table
```

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
dlt runs baseline <testId>
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

All data commands support `--format table` (default) or `--format json`.

- **json**: Pretty-printed JSON to stdout
- **table**: Aligned text table to stdout with semantic coloring

### Table Coloring

When outputting to a terminal (TTY), table output includes color to improve readability:

| Element               | Color                                      |
| --------------------- | ------------------------------------------ |
| Column headers        | **Bold**                                   |
| Separator line        | Dim                                        |
| Status: complete(d)   | Green                                      |
| Status: running/pending/provisioning | Yellow                        |
| Status: failed/cancelled | Red                                     |
| Error count > 0       | Red                                        |
| Baseline run ID       | Cyan `◆ baseline` marker                   |
| Baseline Δ (good)     | Green (↑ throughput or ↓ latency/errors)   |
| Baseline Δ (bad)      | Red (↓ throughput or ↑ latency/errors)     |
| Baseline Δ (neutral)  | Dim (`0.0%` or `--`)                       |

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
│   │   ├── scenarios.ts          # dlt scenarios list/get/start
│   │   └── runs.ts               # dlt runs list/get/latest/baseline/artifacts/active/download
│   └── lib/
│       ├── api-client.ts         # Shared API client (SigV4, error handling)
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
│       ├── paths.ts              # Shared paths and directory helpers
│       ├── http-client.ts        # SigV4 HTTP client + unsigned helpers
│       ├── output.ts             # JSON/table formatting (ANSI-aware)
│       ├── run-formatters.ts     # Run row curation, baseline deltas, colored variants
│       ├── scenario-launcher.ts  # Capacity validation + test start
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

| Command                               | Description                                      |
| ------------------------------------- | ------------------------------------------------ |
| `dlt configure`                       | Configure CLI with stack settings                |
| `dlt login`                           | Authenticate (browser, `--srp`, or `--iam`)      |
| `dlt logout`                          | Remove stored credentials                        |
| `dlt token`                           | Output access or ID token to stdout              |
| `dlt token status`                    | Show token and credential expiry status          |
| `dlt scenarios list`                  | List all test scenarios                          |
| `dlt scenarios get <testId>`          | Get scenario details                             |
| `dlt scenarios start [testId...]`     | Start test run(s) (`--name`, `--wait`, `--poll-interval`) |
| `dlt runs list <testId>`              | List runs (`--baseline` for comparison deltas)   |
| `dlt runs get <testId> <runId>`       | Get run details                                  |
| `dlt runs latest <testId>`            | Get most recent run                              |
| `dlt runs baseline <testId>`          | Get baseline run                                 |
| `dlt runs active [testId]`            | Show active (running/pending/provisioning) tests |
| `dlt runs artifacts <testId> <runId>` | Show artifact S3 prefix                          |
| `dlt runs download <testId> <runId>`  | Download artifacts locally                       |
| `dlt --version`                       | Show CLI version                                 |
| `dlt --help`                          | Show help                                        |
