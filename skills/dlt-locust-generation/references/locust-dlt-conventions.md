# Locust conventions for Distributed Load Testing on AWS

Reference for the `dlt-locust-generation` skill. This captures the Locust framework conventions, the two runtime contracts (Native and Standard), self-termination, source scanning rationale, and user-journey design patterns that a generated bundle must follow.

## The Two Runtime Contracts: Native and Standard

DLT can run a Locust bundle two ways, and they impose **opposite** load-shape requirements on the script. On the console's create form the **Traffic shape** control chooses which one applies; the CLI uses `--native-mode`, and the MCP tools use `native_run_mode`. In the request itself, the choice is whether the scenario carries `nativeRunMode`. Native exists from DLT v4.3.0, where it carries a Preview badge. Earlier versions run every test in Standard mode. Both images pin the same Locust release, read from the solution's `locust.json` (2.43.3 at the time of writing), on CPython 3.11.

**Native, the mode this skill authors for by default.** DLT runs the stock `locust` binary directly against your `locustfile.py`, alongside a DLT sidecar that records every request, and passes it **no** `--users`, **no** `--spawn-rate`, **no** `--run-time`, and **no** `--host`. The script is the sole authority on the load and on when the run ends.

- **The script MUST define its own shape and stop condition.** Provide a `LoadTestShape` whose `tick()` returns `None` at your deadline, which is how a Locust script tells Locust to stop. Without one the run never ends on its own. See "Self-Termination in Native Mode" below.
- **Each task runs a full copy of the script.** Total users are the shape's user count times the task count per Region times the Regions. The console's Native Mode Checklist suggests starting near 200 virtual users or 200 requests per second per task. Each task has 2 vCPU, 4 GiB of memory, and 20 GiB of disk.
- **Request failures do not fail the process.** DLT runs Locust with `--exit-code-on-error=0`, so failed requests and exceptions inside tasks are counted in the results but leave the exit code at 0. A non-zero exit, which DLT reports as a framework warning on the run, comes from a crash such as an import error or a bad `locustfile.py`.

**Standard (Taurus).** DLT runs the bundle through [Taurus](https://gettaurus.org/docs/Locust/), which passes `--users`, `--spawn-rate`, and `--run-time` derived from the scenario's concurrency, ramp-up, and hold-for.

- Taurus owns concurrency, ramp-up, and duration, so the script must **not** define a `LoadTestShape`, a user count, or a spawn rate. A shape in the script takes over from the values Taurus passes.

**Both modes.**

- **The script MUST carry the target `host`.** Taurus passes `--host` only when the scenario has a `default-address`, and DLT never sets one, so neither mode injects a host. A `locustfile.py` with no `host` has nothing to call. The template sets it from `target.base_url` in `loadtest_config.yaml`.
- **Third-party packages need a `requirements.txt`.** From v4.3.0, both modes pip-install a `requirements.txt` that sits at the top level next to `locustfile.py`. Include a `packages/` directory of wheels beside it and the install runs offline (`--no-index --find-links=packages/`); without it pip needs network egress to PyPI. A failed install fails the task during setup, and DLT stops the Native install after 180 seconds.
- **What exists without a `requirements.txt` differs.** Native provides the standard library and `locust` (with Locust's own dependencies). Standard also has `PyYAML`, because Taurus depends on it. An unguarded `import yaml` therefore works in Standard and fails in Native, which is why the template's `helpers.py` falls back to its own reader.

**Authoring for both.** A single bundle cannot satisfy both contracts, because one requires a `LoadTestShape` and the other forbids it. Ask which mode the customer runs before generating, and say in the file's header comment which one the bundle targets. When in doubt on a v4.3.0 or later deployment, author for Native, which honors the script's own shape and journeys. Note that the bundle must run with the Native traffic shape.

**Packaging (both modes).** The user zips the output files and uploads the archive through the DLT console. `locustfile.py` must sit at the root of the zip. Use `zip -j` to flatten paths, except when you ship a `packages/` directory, whose relative layout must be preserved.

## Self-Termination in Native Mode

Because DLT passes no `--run-time`, a bundle with no stop condition runs until the console's **Safety duration** force-stops it. That cap **defaults to 4 hours** and allows up to 24 hours. It is a force-stop only: it neither shapes the load nor shortens a script that would run longer. Letting it fire is expensive and misreports the result. DLT records a safety-capped run as **failed** even when every request succeeded. On every v4.3.x release, a run that fails during or after execution usually ends with the generic scenario reason `Step function execution failed`. See the `dlt-diagnose-run` skill. The console help and the API documentation describe this outcome as completed, but the recorded status is failed. A script that ends itself under the same cap records **complete**. Leave a few minutes of headroom between the script's own deadline and the cap. DLT checks for completion on an interval of up to a minute. It treats a run as capped when it first sees the run complete after the cap has passed.

```python
from locust import HttpUser, LoadTestShape, between, task

RUN_SECONDS = 300
USER_COUNT = 20
SPAWN_RATE = 2


class BoundedRun(LoadTestShape):
    """Hold a flat user count, then end the test.

    Returning None from tick() is how a Locust script asks Locust to stop, which
    is what makes the bundle self-terminating without a --run-time flag.
    """

    def tick(self):
        if self.get_run_time() >= RUN_SECONDS:
            return None
        return (USER_COUNT, SPAWN_RATE)
```

Ramp by returning a rising user count from `tick()` over time rather than a flat tuple.

## Locust Settings DLT Does Not Support

**Do not set `processes`.** DLT counts every request the test makes, and that only works while Locust runs as a single process. With `processes` set, most requests go uncounted and the results report far fewer than were actually sent. The console warns about this when Locust is paired with the Native traffic shape. Scale by raising the per-task user count and by adding DLT tasks and Regions instead.

## Required Output Bundle

| File | Purpose |
|---|---|
| `locustfile.py` | Main entry point: `HttpUser` subclasses, `@task` methods, `SequentialTaskSet` journeys, `@tag` categorization. |
| `helpers.py` | `load_config()`, `target_base_url()`, auth header and signing logic, payload factories, inline random data. Standard library only, using PyYAML when it is importable and a built-in reader otherwise. |
| `loadtest_config.yaml` | Runtime config the user edits: target base URL and auth settings, with `${ENV_VAR}` references for secrets in local runs. DLT sets no custom environment variables, so values the DLT run needs are written in before upload. Kept to plain nested keys, scalars, and lists of scalars so the built-in reader can parse it. |
| `requirements.txt` | Optional. Only when the bundle imports third-party packages; installed in both modes from v4.3.0. |
| `api_spec_source.md` | Audit reference: the source summary that was analyzed. Not uploaded to DLT. |

## Locust Authoring Conventions

- Import surface: `from locust import HttpUser, task, between, SequentialTaskSet, tag`.
- One or more `HttpUser` subclasses. Set `wait_time = between(1, 3)` for realistic pacing.
- Name tasks for what they do (`create_order`, `list_scenarios`), never `task1`.
- Use `@tag("crud")`, `@tag("read")`, `@tag("write")` so runs can target subsets.
- Validate responses explicitly:

  ```python
  with self.client.get(f"/items/{item_id}", catch_response=True, name="/items/[id]") as response:
      if response.status_code == 200:
          response.success()
      else:
          response.failure(f"unexpected status {response.status_code}")
  ```

- Pass a stable `name=` to grouped or parameterized URLs so per-endpoint stats do not explode into one row per ID.
- Do auth setup in `on_start`. Store tokens or signed session state on the user instance.

## User-Journey Design

Model realistic sequences of requests rather than isolated endpoint hits. Use `SequentialTaskSet` for ordered flows and carry state forward:

- **CRUD flow**: create then read then update then read then delete. Save the ID returned by the create response and reuse it in the later steps.
- **Browse flow**: list then filter then get detail then get related resource.
- **Auth flow**: acquire a token or credentials, then perform authenticated operations.

Weight the journeys and standalone tasks to reflect plausible traffic mixes (reads usually dominate writes).

## Source Scanning Rationale

The scanner (`scripts/scan_apis.py`) and the manual fallback both prioritize files by how likely they are to define the API surface. Scoring, per file:

- **API indicators, 3 points each**: route decorators and framework markers. These cover Python (Flask, FastAPI, Django, `@router.*`), JavaScript and TypeScript (Express, NestJS `@Get(`), Java and Kotlin (Spring `@GetMapping`, JAX-RS `@Path`), and Go (`HandleFunc`, `gin`, `r.GET`). OpenAPI and Swagger markers count too, as do infrastructure API resources (`AWS::ApiGateway`, `AWS::Serverless::Api`, `aws_api_gateway`, `RestApi`, ALB, Lambda, ECS service, App Runner). Auth-configuration markers score here too (`AuthorizationType`, `CognitoUserPool`, `IdentityPool`, `apiKeyRequired`, `aws_api_gateway_authorizer`, `addMethod(`) because auth detection depends on them.
- **Model indicators, 1 point each**: `BaseModel`, `dataclass`, `Schema`, `Serializer`, TypeScript `interface`/`type`, Go `struct`, JPA `@Entity`/`@Table`/`@Column`, Mongoose and Sequelize schemas, and infrastructure-as-code (IaC) structural keys (`Resources:`, `Properties:`, `resource `, `variable `, `output `).

The scanner includes files highest-score-first within a character budget (default 80,000), so route handlers and controllers land in the summary before utilities and configs. It truncates individual very large files so one file cannot consume the whole budget.

Included source extensions: `.py .js .ts .jsx .tsx .java .go .rb .rs .kt .scala .json .yaml .yml .toml`, plus IaC: `.tf .hcl .template .cfn .sam`.

Skipped directories: `.git node_modules __pycache__ .venv venv env .tox .eggs dist build .next .nuxt target vendor .bundle coverage .nyc_output .pytest_cache .mypy_cache .ruff_cache htmlcov .kiro .idea .vscode` and test directories (`test tests spec specs __tests__`).

Skipped paths: a symlinked directory, any file that resolves outside the repository root, and any file whose name, or whose link target's name, suggests a secret (`.env*`, `*.env`, `*credentials*`, `*secret*`, `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `.pypirc`, `terraform.tfstate*`, and similar). The scanner also redacts common credential patterns, which cannot catch every secret, and its Scan Notes section lists each skipped path.

## Extending Framework Support

To recognize a new framework, add its route markers to the API indicator list (3 points) and its model markers to the model indicator list (1 point) in `scripts/scan_apis.py`. The generation step already handles multi-framework analysis, so a template change is rarely needed.
