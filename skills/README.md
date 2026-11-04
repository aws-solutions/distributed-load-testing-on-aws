# Agent Skills for Distributed Load Testing on AWS (Preview)

This directory holds a collection of agent skills for [Distributed Load Testing on AWS](https://aws.amazon.com/solutions/implementations/distributed-load-testing-on-aws/) (DLT). The skills help an AI coding agent author, validate, size, run, analyze, and diagnose load tests on a DLT stack that you have deployed. They are written for people who use DLT to test their own applications.

**This is a preview for DLT v4.3.x.** It covers every v4.3 release, from v4.3.0 to the latest v4.3 patch, and it states where a patch changed the behavior a skill describes. When DLT v4.4.0 ships, the skills move to this repository's `main` branch and are updated for v4.4.0. If your stack runs v4.4.0 or later, reinstall the skills from `main`. Each skill also tells your agent to suggest that reinstall.

Distributed Load Testing on AWS supports the Reliability Pillar of the [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/reliability.html). The framework cites DLT in two best practices: [REL07-BP04 Load test your workload](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_adapt_to_changes_load_tested_adapt.html) and [REL12-BP03 Test scalability and performance requirements](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_testing_resiliency_test_non_functional.html). The skills apply DLT to that work.

The skills follow the [Agent Skills](https://agentskills.io/) format: each one is a directory with a `SKILL.md` file and any references, templates, and scripts it needs. Any agent client that reads `SKILL.md` skills can load them. They were tested with Claude Code and Kiro CLI.

## Contents

- [Prerequisites](#prerequisites)
- [Install](#install)
- [Update](#update)
- [Remove](#remove)
- [Manual Install](#manual-install)
- [Version Compatibility](#version-compatibility)
- [Security](#security)
- [Known Limitations](#known-limitations)
- [Skills](#skills)
- [Skill Reference](#skill-reference)
- [Contributing](#contributing)

## Prerequisites

- A DLT v4.3.x stack that you own or operate. The skills act on a real DLT environment.
- Node.js 22.20 or later, to run the `npx skills` command line tool.
- Python 3.9 or later, for the bundled scripts. Most scripts use only the standard library. The scripts that call AWS need `boto3`, and their skill says so.
- Optionally, the `dlt` command line interface (CLI) and the DLT Model Context Protocol (MCP) server. The skills prefer them over the raw API, Amazon S3, and Amazon CloudWatch. The CLI ships as `deployment/cli/dlt-cli.mjs` in this repository, and [source/cli/README.md](../source/cli/README.md) explains how to install it. The MCP server is an optional stack component (`DeployMCPServer=Yes`), and the `dlt-mcp-authorization` skill connects it to your agent.

## Install

Install the whole collection with the [`skills`](https://github.com/vercel-labs/skills) command line tool:

```bash
npx skills add 'https://github.com/aws-solutions/distributed-load-testing-on-aws#agent-skills-preview/v4.3.4'
```

The text after `#` names the preview branch, `agent-skills-preview/v4.3.4`. Keep the quotes, because some shells treat `#` as a special character.

The command asks which agents to install for and whether to install for the current project or for your user account. These options answer the questions in advance:

| Option | Effect |
| --- | --- |
| `-g` | Installs for your user account instead of the current project. |
| `-a claude-code` | Installs for one agent. Other values include `kiro-cli`, `cursor`, and `codex`. |
| `-s dlt-k6-generation dlt-test-packaging-and-lint` | Installs only the named skills. |
| `-l` | Lists the skills in the collection without installing them. |

Install the whole collection, because the skills refer to each other. The generation skills load the authentication skills, for example, and the diagnosis skill points to the deploy and network skills.

### Claude Code Skill Listing

Claude Code lists the name and description of every installed skill in its context, within a budget of 1% of the model's context window. When the listing overflows, Claude Code drops the descriptions of the skills you use least and keeps only their names. On a model with a 200,000-token context window, this collection's descriptions alone exceed that budget, so some DLT skills can appear by name only and activate less reliably. Two settings keep the descriptions visible:

- Raise the budget with the [`skillListingBudgetFraction`](https://code.claude.com/docs/en/settings-reference#skilllistingbudgetfraction) setting, for example `0.03` for 3%.
- Set skills you rarely use to `"name-only"` in the `skillOverrides` setting, which frees budget for the rest.

The Claude Code documentation explains both settings in [Skill descriptions are cut short](https://code.claude.com/docs/en/skills#skill-descriptions-are-cut-short).

## Update

`npx skills check` reports whether a newer version is available, and `npx skills update` installs it. An install from this preview branch tracks the branch, so an update picks up fixes to the preview. After DLT v4.4.0 ships, this branch receives no further changes. Remove the preview skills and install the collection again from `main`:

```bash
npx skills add https://github.com/aws-solutions/distributed-load-testing-on-aws/tree/main/skills
```

## Remove

`npx skills remove` takes the names of the skills to remove:

```bash
npx skills remove dlt-k6-generation dlt-test-packaging-and-lint
```

To remove the whole collection, name every skill in the [Skills](#skills) table. Add `-a kiro-cli` to remove only one agent's copy, and add `-g` to remove skills that you installed for your user account.

## Manual Install

Copy each skill directory under `skills/` into the folder your agent loads skills from, for example `~/.claude/skills/` for Claude Code or `~/.kiro/skills/` for Kiro CLI. Keep each skill's directory whole. A skill links to its `references/`, `templates/`, and `scripts/` files by relative path. Start a new session, or reload skills in an open one, to load the collection.

## Version Compatibility

Every skill needs DLT v4.3.0 or a later v4.3.x release. Some capabilities need a later v4.3 patch:

| Capability | Minimum DLT version |
| --- | --- |
| Native mode, Locust `requirements.txt` and `packages/` installs, framework exit reporting | v4.3.0 |
| `dlt scenarios create` and the other CLI test-management commands | v4.3.0 |
| MCP write tools (`MCPServerAccessMode=ReadWrite`) | v4.3.0 |
| OAuth callback URLs for Kiro, Claude, Cursor, VS Code, and OpenCode on the MCP server | v4.3.1 |
| `ramp-up` and `hold-for` in hours, days, or plain seconds | v4.3.2 |
| A Fargate vCPU quota check on the server at every run start | v4.3.2 |

Where behavior differs between v4.3 releases, the skill names the release and tells a user of an earlier release what to do instead.

## Security

- The bundled scripts run on your machine with your AWS credentials. Read a script before you run it, and use read-only credentials for the scripts that only read.
- Keep your agent client's permission prompts on while you use these skills, and answer each prompt yourself. Several skills delete resources, start load, or change Cognito, and the approvals they ask for are text that the agent follows. Your client's prompt is the check the agent cannot answer for you. Do not auto-approve commands such as `cleanup_retained.py --delete`, `aws cloudformation delete-stack`, `dlt scenarios delete`, `dlt scenarios start`, or `aws cognito-idp` writes, whether through a bypass-permissions or trust-all-tools mode or a broad allow rule such as `Bash(aws:*)` or `Bash(python3:*)`.
- The skills tell the agent to treat repositories, API documents, logs, run artifacts, scenario fields, and tool output as data, never as instructions. A scanned repository or a scenario name can still carry text written to steer an agent, so read what the agent proposes before you approve it.
- `dlt-stack-teardown-and-cleanup/scripts/cleanup_retained.py` deletes resources. It runs as a dry run by default and deletes only with `--delete`. The skill hands you the final `--delete --plan <file>` command to run in your own terminal, where the script asks you to type the stack name.
- `dlt-mcp-authorization/scripts/get_mcp_token.py` handles an app client secret. Pass the secret through an environment variable rather than a command line argument, so that it stays out of your shell history.
- The `npx skills` tool sends anonymous usage telemetry. Set `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` to turn it off.

To report a potential security issue, follow [SECURITY.md](../SECURITY.md). Do not open a public GitHub issue.

## Known Limitations

- The API scanner's redaction and the bundle linter's credential scan catch common credential patterns, but they are not secret scanners. Never put long-term or production credentials in a repository you scan, a test bundle, or a test plan.
- The cleanup script's checks and the skills' approval steps rely on your agent client's permission prompts, so keep those prompts on.
- This preview targets DLT v4.3.x only.

## Skills

| Area | Skill | Description |
| ---- | ----- | ----------- |
| Authoring | [`dlt-locust-generation`](#dlt-locust-generation) | Generate a runnable Locust bundle (`locustfile.py`, `helpers.py`, `loadtest_config.yaml`) from an application's source code, ready to zip and upload to DLT. Scans a repo for REST endpoints, data models, and auth. |
| Authoring | [`dlt-jmeter-generation`](#dlt-jmeter-generation) | Generate a DLT-ready Apache JMeter plan (`.jmx`) plus optional CSV data sets from source code or an OpenAPI spec, with the thread-group load model and bundled-plugin constraints. |
| Authoring | [`dlt-k6-generation`](#dlt-k6-generation) | Scaffold a DLT-ready k6 script (TypeScript or JavaScript) with scenarios, thresholds, and checks. The script targets Native mode, where its own `options` block sets the load and must end the run. It uses only built-in k6 modules by default, because an extension import makes k6 download a different build at run time. |
| Validate and package | [`dlt-scenario-preflight-validation`](#dlt-scenario-preflight-validation) | Validate a create-test payload against the product schema before you submit it, to catch schema errors before the API rejects the payload with an opaque HTTP 400. Ships a standard-library validator. |
| Validate and package | [`dlt-test-packaging-and-lint`](#dlt-test-packaging-and-lint) | Check that a script or zip is structurally correct for the DLT container (per-framework entry-point contract, Native versus Standard differences) before upload. Ships a standard-library linter. |
| Capacity and deployment | [`dlt-capacity-and-region-planning`](#dlt-capacity-and-region-planning) | Size task count and concurrency within the account Fargate vCPU quota, plan multi-Region fan-out, and avoid JMeter heap exhaustion. Ships a standard-library capacity calculator. |
| Capacity and deployment | [`dlt-rps-calibration-and-sizing`](#dlt-rps-calibration-and-sizing) | Size a test by requests per second from a short calibration run. Measures how much load one task delivers for your JMeter script and what it costs the task in CPU, memory, and network, then computes the task count per Region and the per-task rate for a target such as 100,000 RPS. Ships standard-library scripts that build a paced calibration plan, analyze the run, and plan the full test. |
| Capacity and deployment | [`dlt-deploy-and-upgrade-triage`](#dlt-deploy-and-upgrade-triage) | Diagnose CloudFormation deploy, upgrade, and multi-Region expansion failures. Covers custom-resource errors, unsupported Regions, API Gateway blocked by a service control policy (SCP), regional stack version mismatches, and v3 to v4 migration breaks. |
| Capacity and deployment | [`dlt-network-and-permissions-preflight`](#dlt-network-and-permissions-preflight) | Verify IAM permissions, SCPs, VPC subnet IP capacity, bring-your-own VPC requirements, and egress paths before a run. Ships a standard-library IP-capacity checker and a read-only boto3 VPC validator. |
| Capacity and deployment | [`dlt-console-access-and-federation`](#dlt-console-access-and-federation) | Diagnose Cognito login and console-access problems and configure federated identity (OIDC or SAML) for the DLT web console. |
| Capacity and deployment | [`dlt-stack-teardown-and-cleanup`](#dlt-stack-teardown-and-cleanup) | Delete a DLT deployment cleanly and remove what a stack delete leaves behind (versioned buckets, DynamoDB tables, log groups, the API Gateway CloudWatch role, and ECR pull through cache repositories). Otherwise a deleted stack leaves orphaned resources that accrue cost and hold data. Ships a boto3 cleanup tool that is dry-run by default. |
| Run and analyze | [`dlt-results-analysis`](#dlt-results-analysis) | Locate, interpret, and report on a completed run from the Native mode `dlt.result.v1` artifacts or the Taurus XML artifacts of Standard mode. Decodes per-framework response codes and reproduces the aggregation. Ships a standard-library aggregator. |
| Run and analyze | [`dlt-diagnose-run`](#dlt-diagnose-run) | Diagnose a run that failed, is stuck, or completed with fewer requests than expected, with a symptom-first decision tree. Covers Native mode script failures, runs stopped by the Safety duration (the Native mode run-time cap), and the framework-exit report that explains them. |
| Connect | [`dlt-mcp-authorization`](#dlt-mcp-authorization) | Authorize the DLT MCP server and connect it to Claude Code or Kiro CLI, using interactive OAuth sign-in (authorization code with PKCE) or machine-to-machine credentials. Ships a standard-library token helper. |
| Reference | [`dlt-api-auth-detection`](#dlt-api-auth-detection) | Determine an API's real auth mechanism from infrastructure-as-code first, then application code. Resolves to sigv4, cognito_sigv4, bearer, api_key, basic, or none, including the Cognito-authenticates-but-API-uses-IAM case. Reusable beyond load testing. |
| Reference | [`dlt-sigv4-request-signing`](#dlt-sigv4-request-signing) | Sign HTTP requests with AWS Signature Version 4 using only the Python standard library, no boto3. Covers the canonical request, string to sign, signing-key derivation, required headers, and the Cognito Identity Pool credential flow. |

[Skill Reference](#skill-reference) has a card for each skill, with an example request that should activate it.

### How They Fit Together

A load test moves through the skills in order. You author a test with one of the generation skills (`dlt-locust-generation`, `dlt-jmeter-generation`, `dlt-k6-generation`), each of which draws on the two reusable reference skills to get authentication right. `dlt-scenario-preflight-validation` and `dlt-test-packaging-and-lint` then check the test so the API does not reject it and the container can find and run it. Before launching at scale you plan with `dlt-capacity-and-region-planning`. When the goal is a request rate, `dlt-rps-calibration-and-sizing` first measures what one task delivers for your script and turns that into a task count and a per-task rate. If the environment is new, `dlt-deploy-and-upgrade-triage`, `dlt-network-and-permissions-preflight`, and `dlt-console-access-and-federation` resolve deployment, network, and sign-in problems first. After a run you interpret it with `dlt-results-analysis` and, when something goes wrong, work through `dlt-diagnose-run`. When you are finished with a deployment, `dlt-stack-teardown-and-cleanup` deletes it and removes the resources CloudFormation retains.

The other skills reuse two reference skills:

- `dlt-api-auth-detection` determines how clients must authenticate, which the generators record in the bundle and which is useful on its own for integration test setup or security review.
- `dlt-sigv4-request-signing` provides the standard-library signer embedded in the generated Locust `helpers.py` when the API uses IAM auth. The k6 and JMeter generators use it as the reference algorithm for their own signers, and it serves as a general reference for signing AWS requests where boto3 is unavailable.

`dlt-mcp-authorization` connects the DLT MCP server to your client, so the analysis and diagnosis skills can query DLT through MCP instead of raw API calls.

### Behaviors That Are Easy to Trip On

These notes come from live testing on DLT stacks, rechecked against the source of every v4.3 release. Where a patch release changed the behavior, the note names the release.

- **The mode is Standard unless Native is explicitly selected, and test type does not choose it.** Standard mode runs through Taurus and produces Taurus XML artifacts; Native mode runs the framework directly and produces `result.json`. Native is selected only when the request carries `nativeRunMode`: the web console's Traffic shape control, `--native-mode` on `dlt scenarios create`, or `native_run_mode` on the MCP write tools. A create request without it runs on Taurus even for `k6`, `jmeter`, and `locust` tests. In live testing, such a k6 test produced Taurus XML artifacts and a k6 `kpi.csv`, not `result.json`. Read Standard mode aggregates from the API or DynamoDB rather than parsing the XML. Native mode has no load overrides: the script alone sets the load and must end the run itself.
- **Creating a scenario starts a run immediately** for a non-scheduled test, through `dlt scenarios create` or a raw `POST /scenarios`. Do not also call start, because the scenario is already provisioning. Pass `--save-only` to the CLI, or `saveOnly` in the raw request, to create without running. The MCP `create_test` tool always saves without running.
- **A raw create-test request must include `regionalTaskDetails`.** The request schema requires it, with a positive `dltAvailableTasks` per Region, so only a hand-built `POST /scenarios` has to supply it. The web console and the MCP write tools fill it from `GET /vCPUDetails` and `GET /tasks`, `dlt scenarios start` fills it from `GET /vCPUDetails`, and `dlt scenarios create`, `update`, and `copy` fill it with the requested task count. On v4.3.2 and later, the API checks every run start against the account's Fargate vCPU quota. On v4.3.0 and v4.3.1, it trusts the task ceiling the client sends, so check capacity before you start a large run. See `dlt-capacity-and-region-planning`.
- **On v4.3.0 and v4.3.1, durations need `s` or `m`.** A run starts only when `ramp-up` and `hold-for` are written in seconds or minutes with an `s` or `m` suffix, for example `120m` rather than `2h`. v4.3.2 and later also accept `h`, `d`, and plain integers of seconds. See `dlt-scenario-preflight-validation`.
- **A newly invited admin user is in `FORCE_CHANGE_PASSWORD`.** Set a permanent password in the console before CLI logins that use Cognito's Secure Remote Password (SRP) flow will work.
- **How a broken script surfaces depends on the mode.** In Native mode, a script that loads but errors at runtime does not fail its task, so the run can report `complete` with fewer requests than expected. DLT records the framework's non-zero exit and shows it in an alert on the run details page that names the framework and the number of tasks that reported errors. In Native mode, a Region in which no task recorded a request fails the run with `Failed to parse the results - No requests were recorded in ...`, so a script that breaks on every task shows up as a failed run instead of an empty success. Sometimes enough tasks in a Region exit non-zero to breach the healthy threshold (the share of tasks that must stay healthy) while the rest are still running. If those tasks do not all finish within a two-minute grace period, the run fails. On every v4.3 release, a run that fails during or after execution usually ends with the generic scenario reason `Step function execution failed`. The per-Region reason, `Framework warning threshold breached`, appears only in the orchestration logs. See `dlt-diagnose-run`. Standard mode fails the task instead when a script fails at load. In an earlier live test, a Standard k6 script whose `k6/x/...` import k6 could not resolve failed with "unknown dependency ... failed to provision a k6 binary". The run ended `failed` with "Task failure threshold breached". Native mode handles the same unresolvable import differently: k6 exits non-zero before it sends a request. DLT records that exit as a framework warning rather than a task failure, so the run fails with `No requests were recorded`, and the alert quotes k6's message.
- **k6 downloads extensions on demand.** DLT pins k6 1.5.0, but k6's automatic extension resolution is on. A script that imports an Official or Community `k6/x/...` extension therefore makes k6 download a custom build from Grafana when each task starts. In live testing, a Native script importing `k6/x/kafka` ran normally on a provisioned build that reported k6 v1.8.1 rather than 1.5.0. The download needs internet egress from the tasks and changes the k6 version the test runs on, so `dlt-k6-generation` avoids extensions unless you ask for one.

## Skill Reference

Each card says what a skill does, what it ships, what it needs, and whether it changes anything in your AWS account. The quoted request at the end of each card is an example that should activate the skill.

### dlt-locust-generation

Generates a DLT-ready Locust bundle (`locustfile.py`, `helpers.py`, and `loadtest_config.yaml`) from your service's source code or OpenAPI spec.

**Use it when** you scaffold Locust tests from a service repository or prepare a Locust bundle to upload to DLT.

**What it does**

1. Scans your repository or spec for endpoints, data models, and the real auth type.
2. Writes the files for your traffic shape: Native mode needs a `LoadTestShape`, and Standard mode forbids one.
3. Adds short-lived credentials to a private copy of the bundle, then zips and lints it.

- **Ships:** `scripts/scan_apis.py` (standard library, redacts common credential patterns), templates for the three bundle files, and a note on the Native and Standard runtime contracts.
- **Needs:** Python 3.9 or later to generate. Running needs a DLT v4.3.x stack, and the `dlt` CLI is optional. An AWS Signature Version 4 (SigV4) target needs a role that can only invoke its API. Filling in its short-lived credentials needs the AWS CLI and `sts:AssumeRole` on that role.
- **Changes your account:** It can upload the bundle and save a scenario without running it. Before it starts load, or saves or updates a scheduled test, it shows you the stack, hosts, and load, and asks you to confirm that you may test each host. An uploaded bundle stays in the stack's versioned scenarios bucket, where every console user can download it and old versions outlive the stack, so put only short-lived credentials in it.
- **Related:** [dlt-api-auth-detection](#dlt-api-auth-detection), [dlt-sigv4-request-signing](#dlt-sigv4-request-signing), [dlt-test-packaging-and-lint](#dlt-test-packaging-and-lint)

> "Generate a Locust bundle from this repo, ready to upload to DLT."

### dlt-jmeter-generation

Generates a DLT-ready Apache JMeter plan (`.jmx`), plus optional CSV data sets, from source code or an OpenAPI spec. The plan's thread groups set the load.

**Use it when** you turn an API repository or OpenAPI document into a `.jmx`, or fix an existing plan so that it runs on DLT.

**What it does**

1. Reads your code or spec for endpoints, test data, and the real auth type.
2. Writes thread groups that set the load, using only core JMeter and the plugins DLT bundles.
3. Adds short-lived credentials to a private copy of the plan, then zips and lints it.

- **Ships:** `templates/loadtest-plan.jmx` (a JMeter 5.6.3 scaffold) and `templates/users.csv` (sample data), plus notes on the bundled plugins and the runtime contract.
- **Needs:** No AWS credentials to generate, and Python 3.9 or later to lint. Running needs a DLT v4.3.x stack and the `dlt` CLI, the MCP server in `ReadWrite` mode, or AWS credentials that can upload and create tests.
- **Changes your account:** It can upload the plan and save a scenario without running it. Before it starts load, or saves or updates a scheduled test, it shows you the stack, hosts, and load, and asks you to confirm that you may test each host. An uploaded bundle stays in the stack's versioned scenarios bucket, where every console user can download it and old versions outlive the stack, so put only short-lived credentials in it.
- **Related:** [dlt-api-auth-detection](#dlt-api-auth-detection), [dlt-capacity-and-region-planning](#dlt-capacity-and-region-planning), [dlt-test-packaging-and-lint](#dlt-test-packaging-and-lint)

> "Create a DLT-ready JMeter .jmx for my checkout API from its OpenAPI spec."

### dlt-k6-generation

Scaffolds a DLT-ready k6 script in TypeScript or JavaScript, with scenarios, thresholds, and checks, for Native mode.

**Use it when** you turn an API repository or OpenAPI document into a k6 test, or need to know why Native mode passes k6 no load flags.

**What it does**

1. Reads your code or spec for endpoints, data models, and the real auth type.
2. Writes an `options` block that sets the load and ends the run, plus checks, thresholds, and named requests.
3. Adds any short-lived credentials to a private copy, then lints the file you upload.

- **Ships:** `templates/loadtest.ts.tmpl` and `templates/loadtest.js.tmpl` (scaffolds that use only built-in k6 modules), plus a note on the runtime contract and results.
- **Needs:** No AWS credentials to generate, and Python 3.9 or later to lint. Running needs a DLT v4.3.x stack, and the `dlt` CLI and the MCP server are optional.
- **Changes your account:** It can upload the script and save a scenario without running it. Before it starts load, or saves or updates a scheduled test, it shows you the stack, hosts, and load, and asks you to confirm that you may test each host. An uploaded bundle stays in the stack's versioned scenarios bucket, where every console user can download it and old versions outlive the stack, so put only short-lived credentials in it.
- **Related:** [dlt-api-auth-detection](#dlt-api-auth-detection), [dlt-capacity-and-region-planning](#dlt-capacity-and-region-planning), [dlt-diagnose-run](#dlt-diagnose-run)

> "Scaffold a k6 load test in TypeScript for my service and package it for DLT."

### dlt-scenario-preflight-validation

Checks a DLT create-test payload against the product's request schema before you submit it, so that you catch the errors the API would reject with an opaque HTTP 400.

**Use it when** you check a payload before you submit it, decode an `INVALID_REQUEST_BODY` rejection, or build a `POST /scenarios` request by hand.

**What it does**

1. Runs `validate_scenario.py` on your payload, or walks the checklist by hand.
2. Reports each failing rule as `path: message`, with an approximate preview of the 400 response.
3. Lists, separately, the checks that the API makes after the schema passes.
4. Notes durations that v4.3.0 and v4.3.1 cannot start, and tags that DLT rewrites or drops.

- **Ships:** `scripts/validate_scenario.py` (standard library, exits 0 only when the payload is clean), plus a note on every field's bounds and error messages.
- **Needs:** Python 3.9 or later. The validator needs no boto3, AWS credentials, network access, or deployed stack.
- **Changes your account:** No. It does not submit tests, call AWS, or edit the payload.
- **Related:** [dlt-network-and-permissions-preflight](#dlt-network-and-permissions-preflight), [dlt-capacity-and-region-planning](#dlt-capacity-and-region-planning), [dlt-test-packaging-and-lint](#dlt-test-packaging-and-lint), [dlt-diagnose-run](#dlt-diagnose-run)

> "Check this DLT create-test payload before I submit it."

### dlt-test-packaging-and-lint

Checks that a JMeter, k6, or Locust script or zip meets the DLT container's entry-point contract, and names each packaging problem it finds.

**Use it when** you prepare a bundle, setup fails because the script was not found, or a zip that worked in Standard mode fails in Native mode.

**What it does**

1. Simulates how Native mode unwraps a zip and finds the top-level entry point.
2. Flags dotfiles, `__MACOSX` folders, nested entry points, unsafe paths, and undeclared Locust imports.
3. Scans every text file in the bundle for AWS access keys.
4. Guides the upload through the console, the `dlt` CLI, or the MCP tools.

- **Ships:** `scripts/lint_bundle.py` (standard library, runs offline), plus notes on Native and Standard packaging and the file names DLT ignores.
- **Needs:** Python 3.9 or later and no AWS credentials to lint. Uploading needs a deployed stack and the console, the `dlt` CLI, or the MCP server in `ReadWrite` mode. The raw S3 fallback needs the AWS CLI and write access to the scenarios bucket.
- **Changes your account:** Linting changes nothing. An upload saves or updates a scenario and its script, and the raw S3 fallback overwrites an existing test's script in place. Before it starts or schedules a run, updates a scheduled test, or overwrites a script, it asks you to confirm that you may test each host.
- **Related:** [dlt-locust-generation](#dlt-locust-generation), [dlt-scenario-preflight-validation](#dlt-scenario-preflight-validation), [dlt-diagnose-run](#dlt-diagnose-run), [dlt-network-and-permissions-preflight](#dlt-network-and-permissions-preflight)

> "Will this zip run as a Native mode DLT Locust test? Lint it."

### dlt-capacity-and-region-planning

Splits a target number of virtual users into a task count and concurrency for each Region, within that Region's AWS Fargate vCPU quota.

**Use it when** you size a test by virtual users, a run is rejected for its task count or Region, or JMeter tasks run out of memory.

**What it does**

1. Reads the tasks available in each Region from the console or `GET /vCPUDetails`.
2. Splits the target with the bundled calculator, or reports the shortfall.
3. Names the regional stacks to deploy outside the hub Region.
4. Lowers JMeter concurrency to avoid heap exhaustion, and sizes any quota increase.

- **Ships:** `scripts/capacity_split.py` (standard library, runs offline), plus notes on the capacity model and regional stacks.
- **Needs:** Python 3.9 or later and a deployed DLT stack. Capacity comes from the console or SigV4-signed API calls, and the `dlt` CLI and the MCP server are optional. Deploying a regional stack needs CloudFormation access in that Region, and `make regional-deploy` also needs a source checkout at the hub's version with its build tools.
- **Changes your account:** The calculator changes nothing. The skill can deploy a regional stack, which creates billable resources, and `make regional-deploy` also bootstraps AWS CDK in that Region. Before it deploys one, it shows you the Region, the account, and the hub stack, and waits for your explicit approval. You request quota increases yourself in the Service Quotas console.
- **Related:** [dlt-rps-calibration-and-sizing](#dlt-rps-calibration-and-sizing), [dlt-deploy-and-upgrade-triage](#dlt-deploy-and-upgrade-triage), [dlt-scenario-preflight-validation](#dlt-scenario-preflight-validation), [dlt-diagnose-run](#dlt-diagnose-run)

> "I want 50,000 virtual users across two Regions. What task count and concurrency do I need, and will the quota allow it?"

### dlt-rps-calibration-and-sizing

Sizes a JMeter test by requests per second (RPS) from a short calibration run, and returns the task count for each Region and the rate each task must deliver.

**Use it when** you plan for a target RPS, measure what one task delivers, or need to know whether the load generators or the target limited a run.

**What it does**

1. Builds, lints, and runs a paced calibration plan on 3 to 5 Native mode tasks.
2. Measures each task's CPU cost per request and finds where the task saturates.
3. Plans the full test, then runs a staged test at 10 to 25 percent of the load first.

- **Ships:** four standard-library scripts that build the calibration plan, analyze the run, and plan the full test. `templates/` holds a JMeter telemetry sampler and an example baseline, and the notes explain the method.
- **Needs:** Python 3.9 or later, a deployed stack, the `dlt` CLI, and AWS CLI read access to CloudWatch Logs and the scenarios bucket. Raising a log group's retention also needs `logs:PutRetentionPolicy`.
- **Changes your account:** It saves scenarios and starts the calibration, staged, and full runs, each only after you confirm that you may test each host. It can also raise the retention of the Container Insights performance log group after you approve the change. An uploaded plan stays in the versioned scenarios bucket, so put only short-lived credentials in it.
- **Related:** [dlt-capacity-and-region-planning](#dlt-capacity-and-region-planning), [dlt-jmeter-generation](#dlt-jmeter-generation), [dlt-test-packaging-and-lint](#dlt-test-packaging-and-lint)

> "How many DLT tasks do I need to drive 100,000 requests per second against my API? Calibrate my script first."

### dlt-deploy-and-upgrade-triage

Diagnoses DLT CloudFormation deploy, upgrade, and Region expansion failures from stack events, custom-resource Lambda logs, and AWS CloudTrail.

**Use it when** a deploy or upgrade fails, a regional stack reports `UUID not supported`, or tests fail with `Incompatible regional stacks`.

**What it does**

1. Reads the oldest failed stack event to find the class of failure.
2. Follows it to the custom-resource Lambda logs or the CloudTrail denials.
3. Matches the evidence to known failure signatures, supported Regions, and upgrade paths.
4. Gives the fix, such as upgrading the hub first or running `continue-update-rollback`.

- **Ships:** Guidance and reference notes only: failure signatures, supported Regions, and upgrade paths.
- **Needs:** The AWS CLI and read-only access to CloudFormation, CloudWatch Logs, and CloudTrail. Applying a fix needs write access. It needs no Python, `dlt` CLI, or MCP server.
- **Changes your account:** Diagnosis only reads. A fix can retry or upgrade a stack, continue a rollback past resources that failed to roll back, redeploy regional stacks, or delete a new stack in `ROLLBACK_COMPLETE`. It never deletes an existing environment. Before each stack write, it shows you the stack, Region, account, and command, and waits for your explicit approval.
- **Related:** [dlt-capacity-and-region-planning](#dlt-capacity-and-region-planning), [dlt-network-and-permissions-preflight](#dlt-network-and-permissions-preflight), [dlt-diagnose-run](#dlt-diagnose-run), [dlt-test-packaging-and-lint](#dlt-test-packaging-and-lint)

> "My DLT CloudFormation deploy failed with a UUID not supported error. What is wrong?"

### dlt-network-and-permissions-preflight

Checks the IAM permissions, service control policies (SCPs), subnet IP capacity, VPC setup, and egress paths that a DLT run needs, and gives the fix or escalation for each gap.

**Use it when** a run hangs in `provisioning`, a call returns `AccessDenied`, or you plan a large or multi-Region test.

**What it does**

1. Reads CloudTrail for denied Amazon ECS calls and `iam:PassRole` denials.
2. Tells an SCP deny apart from a missing grant.
3. Compares the free subnet IPs with the task count in each Region.
4. Validates a bring-your-own VPC's subnets, routes, DNS settings, and Availability Zones.
5. Checks that tasks can reach container images, framework downloads, logs, and your target.

- **Ships:** `scripts/ip_capacity_check.py` (standard library) and `scripts/validate_vpc.py` (boto3, read-only), plus notes on IAM, VPC, and egress requirements.
- **Needs:** Python 3.9 or later, plus boto3 and read-only Amazon EC2 access for `validate_vpc.py`. The other checks read CloudTrail, ECS service events, and logs. A fix needs write access to the resource it changes.
- **Changes your account:** Its checks and scripts only read. A fix can restore an IAM grant, redeploy a stack with new subnet or egress settings, or copy container images into Amazon ECR. It can also add a route, a NAT gateway, or a VPC endpoint. Before each change, it shows you the resource, Region, account, and change, and waits for your explicit approval.
- **Related:** [dlt-capacity-and-region-planning](#dlt-capacity-and-region-planning), [dlt-diagnose-run](#dlt-diagnose-run), [dlt-deploy-and-upgrade-triage](#dlt-deploy-and-upgrade-triage), [dlt-sigv4-request-signing](#dlt-sigv4-request-signing)

> "Before I run a 500-task test, check my subnet IP capacity and IAM permissions."

### dlt-console-access-and-federation

Diagnoses DLT web console sign-in failures, and connects Okta, Microsoft Entra ID, or another OIDC or SAML identity provider to the stack's Amazon Cognito user pool.

**Use it when** a user cannot sign in, a callback URL is rejected, or you want single sign-on for the console.

**What it does**

1. Matches the symptom to a cause with read-only Cognito calls.
2. Fixes causes such as a missing invitation or an unregistered callback URL.
3. Has you restrict the provider app to assigned users first, because every federated user gets full access.
4. Adds the provider, maps the email attribute, enables it on the app client, and verifies sign-in.

- **Ships:** Guidance and reference notes only: Cognito settings, callback URLs for each deployment mode, and Okta and Entra ID steps.
- **Needs:** The AWS CLI and `jq`. Diagnosis needs read-only Cognito access, and changes need administrator access to the user pool and to your identity provider.
- **Changes your account:** Yes. It can create Cognito users, edit the app client, and add an identity provider, each after your explicit approval. To set a permanent password, it gives you a command to run in your own terminal. A later stack update can reset edits to the app client.
- **Related:** [dlt-mcp-authorization](#dlt-mcp-authorization), [dlt-deploy-and-upgrade-triage](#dlt-deploy-and-upgrade-triage), [dlt-api-auth-detection](#dlt-api-auth-detection)

> "I cannot log in to the DLT console with Okta. How do I set up federation?"

### dlt-stack-teardown-and-cleanup

Deletes a DLT deployment and removes what the stack delete leaves behind. That includes versioned S3 buckets, DynamoDB tables, log groups, the API Gateway CloudWatch role, and ECR pull through cache repositories.

**Use it when** you decommission a stack, find DLT buckets or tables that no live stack owns, or cannot delete a versioned DLT bucket.

**What it does**

1. Confirms nothing is running and previews what the stack delete will leave.
2. Deletes the saved tests, then the regional stacks, then the main stack.
3. Writes a cleanup plan with a dry run for you to review.
4. Hands you the `--delete --plan` command to run in your own terminal, then confirms nothing remains.

- **Ships:** `scripts/cleanup_retained.py` (boto3, dry run by default), plus notes on each retained resource and how to remove it.
- **Needs:** Python 3.9 or later, boto3, the AWS CLI, and read-only credentials to plan. Deleting the saved tests needs the `dlt` CLI, the console, or the MCP server in `ReadWrite` mode, and the delete step needs credentials that can delete.
- **Changes your account:** Yes. It cancels a running test first. Then it permanently deletes the saved tests, the stacks, and the resources in the plan, each after an approval that names the stack, Region, and account. Pointing the Region's API Gateway logging setting at another role needs its own approval. It never deletes a KMS key. Its script never deletes a leftover matched only by name, and the skill removes one by hand only after you approve that resource.
- **Related:** [dlt-diagnose-run](#dlt-diagnose-run), [dlt-deploy-and-upgrade-triage](#dlt-deploy-and-upgrade-triage), [dlt-capacity-and-region-planning](#dlt-capacity-and-region-planning)

> "Tear down my DLT stack and remove the buckets and tables it leaves behind."

### dlt-results-analysis

Finds a completed DLT run's results and per-task artifacts in Native or Standard mode, explains the metrics, and turns the run into a report you can share.

**Use it when** you want a run's metrics explained, its response codes decoded, or a Markdown report or CSV export.

**What it does**

1. Locates the run through the `dlt` CLI, the MCP server, the REST API, or raw storage.
2. Downloads the per-task `result.json` files when it needs them.
3. Interprets request counts, latency percentiles, per-label results, and response codes.
4. Reproduces the Native mode aggregation for each Region and in total, offline.
5. Writes a summary, Markdown report, or CSV export with explicit units.

- **Ships:** `scripts/aggregate_results.py` (standard library, Native mode only), plus notes on result fields, aggregation rules, units, and response codes.
- **Needs:** Python 3.9 or later, the test ID, and one access path: the `dlt` CLI (preferred), the MCP server, the REST API, or read access to DynamoDB and S3.
- **Changes your account:** No. It only lists, gets, describes, and downloads, and it never modifies or deletes results.
- **Related:** [dlt-diagnose-run](#dlt-diagnose-run), [dlt-capacity-and-region-planning](#dlt-capacity-and-region-planning)

> "Explain the results of my last DLT run and turn them into a report."

### dlt-diagnose-run

Diagnoses a DLT run that failed, is stuck, or completed with fewer requests than expected, and names the likely cause, the fix, and the safe recovery path.

**Use it when** a run ended `failed`, is stuck, or reports `complete` with far fewer requests than you expected.

**What it does**

1. Reads the run's status, error reason, and results from the scenario and run records.
2. Notes the traffic shape and DLT version, then follows the branch for the symptom.
3. Checks the framework-exit report, then CloudWatch Logs and stopped ECS tasks.
4. Recommends a fix, or cancels a stuck run through the product.

- **Ships:** Guidance and reference notes only: error reasons, exit and stop codes, where to find logs, and the saved Logs Insights queries that DLT deploys.
- **Needs:** A DLT v4.3.x stack, the `dlt` CLI or the MCP server, and read access to CloudWatch Logs and Amazon ECS.
- **Changes your account:** It can cancel a run with `dlt scenarios cancel` or the MCP `stop_run` tool. It stops ECS tasks by hand only if the product cancel fails, and only after you approve. Before it starts load again, it shows you the stack, hosts, and load, and waits for your explicit approval.
- **Related:** [dlt-results-analysis](#dlt-results-analysis), [dlt-test-packaging-and-lint](#dlt-test-packaging-and-lint), [dlt-deploy-and-upgrade-triage](#dlt-deploy-and-upgrade-triage), [dlt-network-and-permissions-preflight](#dlt-network-and-permissions-preflight)

> "My DLT test says complete but sent far fewer requests than I expected. What happened?"

### dlt-mcp-authorization

Connects the optional DLT MCP server to Claude Code or Kiro CLI with an Amazon Cognito access token, through interactive OAuth sign-in or machine-to-machine credentials.

**Use it when** you connect the DLT MCP server, need a fresh token, or troubleshoot an MCP authorization failure.

**What it does**

1. Reads the stack's `McpEndpoint` output to confirm that the server is deployed.
2. Chooses interactive OAuth with Proof Key for Code Exchange (PKCE) or machine-to-machine `client_credentials`.
3. Gets a token from your client's OAuth flow, the `dlt` CLI, or the bundled helper.
4. Adds the server to your client's MCP configuration, then tests it with `list_scenarios`.

- **Ships:** `scripts/get_mcp_token.py` (standard library, sends machine-to-machine credentials only to an Amazon Cognito domain unless you pass `--allow-custom-domain`), plus notes on the OAuth flows, callback URLs, and MCP tools.
- **Needs:** A DLT v4.3.x stack, the AWS CLI with read-only credentials for the lookups, and Python 3.9 or later for the helper. The server runs only on a stack deployed with `DeployMCPServer=Yes`.
- **Changes your account:** It edits your agent client's MCP configuration. Deploying the server or turning on `ReadWrite` mode updates the stack, so it does that only after your explicit confirmation. The skill keeps the client secret out of arguments, files, and the conversation, and never displays tokens.
- **Related:** [dlt-results-analysis](#dlt-results-analysis), [dlt-diagnose-run](#dlt-diagnose-run), [dlt-console-access-and-federation](#dlt-console-access-and-federation)

> "Connect the DLT MCP server to my Claude Code."

### dlt-api-auth-detection

Determines how clients must authenticate to a REST API by reading its infrastructure as code first, then its application code. It reports `sigv4`, `cognito_sigv4`, `bearer`, `api_key`, `basic`, or `none`, with the evidence.

**Use it when** you generate a load test, set up integration tests, or review an API's security.

**What it does**

1. Reads the authorization settings in CDK, CloudFormation, AWS SAM, or Terraform first.
2. Resolves Cognito sign-in in front of IAM-authorized methods to `cognito_sigv4`, not `bearer`.
3. Falls back to application middleware only when the infrastructure code is absent or silent.
4. Reports the type and its chain of evidence, and trusts the infrastructure when the two disagree.

- **Ships:** Guidance only, with no scripts, templates, or reference notes.
- **Needs:** The API's source and infrastructure code. It only reads code, so it needs no AWS credentials, Python, or DLT stack.
- **Changes your account:** No.
- **Related:** [dlt-sigv4-request-signing](#dlt-sigv4-request-signing), [dlt-locust-generation](#dlt-locust-generation), [dlt-k6-generation](#dlt-k6-generation), [dlt-jmeter-generation](#dlt-jmeter-generation)

> "How does my API actually authenticate? Work it out from the infrastructure and code."

### dlt-sigv4-request-signing

Explains SigV4 signing, provides a Python standard-library signer, and covers the Amazon Cognito identity pool credential flow for `cognito_sigv4` APIs.

**Use it when** a client must sign API Gateway requests in a runtime without boto3, such as a DLT Locust bundle that declares no dependencies.

**What it does**

1. Builds the canonical request, then the string to sign with its credential scope.
2. Derives the signing key from the secret access key with chained HMAC-SHA256.
3. Adds the `Authorization`, `x-amz-date`, and `x-amz-content-sha256` headers, plus `x-amz-security-token` for temporary credentials.
4. Checks the request against a correctness checklist and common failure modes.

- **Ships:** `templates/sigv4_signer.py` (standard library, returns the signed headers and sends nothing). Its path encoding suits every service except Amazon S3.
- **Needs:** Python 3.9 or later, with no boto3 or botocore. A DLT bundle needs temporary credentials from a role that can only call `execute-api:Invoke` on the target API. Signing needs no DLT stack.
- **Changes your account:** No. After a test, it advises you to revoke the role's sessions in IAM and change the Cognito test user's password. A credential in a DLT bundle stays in the versioned scenarios bucket even after the stack is deleted, so use short-lived credentials.
- **Related:** [dlt-api-auth-detection](#dlt-api-auth-detection), [dlt-locust-generation](#dlt-locust-generation)

> "Sign this API Gateway request with SigV4 using only the Python standard library."

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md). A new skill follows these rules:

1. Create `skills/dlt-<name>/SKILL.md`. Its frontmatter has `name`, which matches the directory, `description`, `license: Apache-2.0`, and `compatibility`, which states the minimum DLT version and any Python requirement. Leave out `allowed-tools`, which the validator rejects, because it pre-approves tools in some clients and removes the user's permission prompt. Put the key use case first in the description, and end it with the Reliability Pillar sentence that every other skill uses.
2. Put supporting files in `references/`, `templates/`, or `scripts/` beside `SKILL.md`, and link them by relative path. Links must stay inside the skill's own directory, so that a skill installed on its own still works.
3. Start every script, and every template whose format allows comments, with the Amazon copyright line and the `SPDX-License-Identifier: Apache-2.0` line. The validator checks the first five lines of each Python, shell, JavaScript, TypeScript, Groovy, YAML, and JMX file under `scripts/` and `templates/`. Data templates such as CSV and JSON files carry no header. Make every script run `--help` with no network and no AWS credentials.
4. Add the skill to the [Skills](#skills) table, and give it a card in [Skill Reference](#skill-reference).
