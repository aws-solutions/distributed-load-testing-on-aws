# Native versus Standard packaging matrix

DLT ships two container engines, and the scenario's traffic shape picks between them. **Standard** mode, the default and the only mode before v4.3.0, uses the `load-test.sh` shell runner that drives bzt (Taurus). **Native** mode, a preview from v4.3.0, uses a per-framework container that resolves and executes the script through its own code path. They agree on the S3 key layout, the wrapper-folder flatten, and the Locust dependency install. Four things differ: entry-point discovery inside a zip, which hidden names each skips, which Python modules exist without a `requirements.txt`, and JMeter user plugins. Only one direction is safe: the Standard engine also finds a bundle that satisfies the Native engine, given lowercase extensions and no leading `_` on the entry point or wrapper folder, but the reverse is not guaranteed. Load shapes do not carry over at all; see the naming and load-shape note below.

## What the Console Calls These Modes

The console, the CLI, the MCP server, and the API now use the same two names. Keep in mind how those names map to the wire fields:

| Mode | How it is selected | Duration control |
|---|---|---|
| **Standard** | No `nativeRunMode` on the scenario; the console's Traffic shape control set to Standard; the CLI without `--native-mode` | Ramp up and hold for, applied by Taurus |
| **Native** (Preview badge in the console) | `nativeRunMode` present; Traffic shape set to Native; `--native-mode` in the CLI; `native_run_mode` in the MCP tools | `nativeRunMode.maxTestDurationSeconds`, labelled **Safety duration** on the create form and shown as "Native Mode · <duration> max duration" in the read-only Load Configuration summary |

Selecting Native replaces the Standard mode's Test Duration section with the single Safety duration field. That field sits at the bottom of the Upload test file section, defaults to 4 hours, and accepts up to 24 hours. A Native scenario also shows a Native Mode Checklist panel on the create form.

**The load shape does not port between the modes.** Native mode passes the framework no load or duration flags, so the script must define its own shape and its own stop condition. In Standard mode Taurus supplies them, so a script that defines its own shape fights the one Taurus passes. A bundle is therefore authored for one mode or the other; check which before packaging. See [[dlt-k6-generation]], [[dlt-locust-generation]], and [[dlt-jmeter-generation]].

This matrix is grounded in the DLT source:

- Native entry-point discovery: `source/load-tester/src/archive/find-script.ts`
- Native zip flatten and copy: `source/load-tester/src/archive/unzip.ts`
- Native safe extraction (symlink and zip-slip guards): `source/load-tester/src/archive/extract-zip.ts`
- Native ignore rule: `source/load-tester/src/archive/ignored-files.ts`
- Native Locust dependency install: `source/load-tester/src/locust/install-dependencies.ts`
- Native runtime working directory: `source/load-tester/src/runners/locust.ts` (and the sibling runners)
- Native lifecycle (setup throws, runtime completes): `source/load-tester/src/lifecycle/run.ts`
- Standard runner: `deployment/ecr/distributed-load-testing-on-aws-load-tester/load-test.sh`
- S3 keys: `source/common/src/s3-keys.ts`

## S3 Key Layout (Both Engines)

```
public/test-scenarios/{framework}/{testId}.{extension}
```

| Framework | Bare-script extensions (in lookup order) | Zip extension |
|---|---|---|
| jmeter | `jmx` | `zip` |
| k6 | `ts`, then `js` | `zip` |
| locust | `py` | `zip` |

The scenario's `fileType` decides which key the container reads: `zip` reads the `.zip` key, and `script` reads the bare-script keys in order. A separate object, `test-scenarios/{testId}-{region}.json`, holds the scenario configuration.

## Entry-Point Discovery Inside a Zip

Both engines first flatten a single wrapper directory. If the archive's root contains exactly one entry, ignoring hidden names, and that entry is a directory, the contents of that directory become the effective top level. Otherwise the archive root is the effective top level. The engines differ on which root names count as hidden for this decision. Native ignores names that start with `.` and the exact name `__MACOSX`, while Standard ignores any root name that starts with `.` or `_`. In Standard mode a root entry such as `_extras/` beside a single wrapper folder is therefore dropped when the wrapper is flattened.

After that flatten, discovery diverges.

| Behavior | Native | Standard |
|---|---|---|
| Search scope | Immediate files of the effective top level only. No recursion into subdirectories. | Recursive `find` from the working directory. Any depth. |
| jmeter | First top-level file ending in `.jmx` (case-insensitive; sorted, so pick one and keep only one). | First `.jmx` found by `find` (lowercase extension only), excluding the JMeter bundle and dot or underscore paths. |
| k6 | First top-level `.ts`; if none, first top-level `.js`. | First `.ts` found by `find`; if none, first `.js` (lowercase extension only). This search does not skip dot or underscore paths, so remove `__MACOSX` from k6 zips. |
| locust | A file named exactly `locustfile.py` at the top level. | A file named exactly `locustfile.py` found by `find`, excluding dot or underscore paths. |
| Not found | Throws at setup. The task hard-fails with `TASK_FAILED`. | `fatal_exit`. The task hard-fails. |

The practical consequence: Standard finds a nested entry point (more than one directory deep, or inside one of several top-level folders), and Native misses it.

## Worked Archive Layouts

`OK` means the Native engine finds the entry point. `FAIL` means Native hard-fails at setup. Standard finds all of these except the wrong name, the dot-prefixed entry, and the empty or unsafe archives.

Locust examples:

```
locustfile.py                         OK   (top-level entry)
helpers.py
requirements.txt                      (optional, installed in both modes from v4.3.0)
packages/                             (optional wheels for an offline install)

myproject/                            OK   (single wrapper folder, flattened)
  locustfile.py
  helpers.py

myproject/                            FAIL (entry is two levels deep; Standard finds it, Native does not)
  tests/
    locustfile.py

app/                                  FAIL (two top-level folders, no flatten; entry not at root)
  locustfile.py
data/
  users.csv

LocustFile.py                         FAIL (wrong name; must be exactly locustfile.py)

.locustfile.py                        FAIL (dot-prefixed, silently ignored)

__MACOSX/                             FAIL if it is the only real content (empty after ignoring)
```

JMeter examples:

```
plan.jmx                              OK
data.csv

bundle/                               OK   (single wrapper, flattened)
  plan.jmx

suite/                                FAIL (entry nested under a second folder)
  jmeter/
    plan.jmx
```

k6 examples:

```
scenario.ts                           OK
scenario.js                           OK   (used only if no .ts present)
src/                                  FAIL (entry nested under a folder alongside no root script)
  scenario.ts
```

## Dependencies and Plugins

| Mechanism | Native | Standard |
|---|---|---|
| Locust Python dependencies (v4.3.0 and later) | Pip installs a `requirements.txt` next to `locustfile.py` into a private directory on the Locust process's `PYTHONPATH`. With a `packages/` directory of wheels beside it, the install runs offline (`--no-index --find-links=packages/`); without it, pip installs from PyPI and needs network egress. The install must finish within 180 seconds. A `packages/` directory without a `requirements.txt` is ignored with a warning in the task log, and a `locust` pin in the file overrides the image's Locust. | Pip installs a `requirements.txt` in the working directory (the effective top level), offline from `packages/` when present and from PyPI otherwise. A `packages/` directory without a `requirements.txt` is ignored. |
| Locust modules without a `requirements.txt` | The standard library and `locust` (with Locust's own dependencies). There is no `PyYAML`, so `import yaml` fails. | The standard library, `locust`, and every package Taurus and the AWS CLI install, `PyYAML` among them. |
| Locust dependencies before v4.3.0 | Not applicable: Native mode does not exist. | Not installed. Only the image's modules are available. |
| A failed install | Throws during setup, before the health check passes. The run usually ends as a stabilization failure; the task log carries pip's own error. | `fatal_exit` during setup, with the same effect. |
| JMeter plugins | Bundle-only. DLT's JMeter bundle ships a fixed plugin set. User `plugins/*.jar` are ignored. | User `plugins/*.jar` in a `plugins/` folder next to the `.jmx` are installed into the JMeter `lib/ext` directory and can override bundled plugins by name. |
| k6 modules | Resolved by k6 itself (the `k6` module and remote imports). No user install step. | Same. |

## Working Directory and Included Files

At runtime the working directory is the directory that holds the entry-point script (after any single-wrapper flatten). Relative reads resolve from there: data sets, `locust.conf`, and relatively imported helper modules must live inside the zip. A bare-script upload carries no companions, so any external file requires a zip.

## Safe Extraction Guarantees (Native)

- Symlink entries and other non-regular entries (devices, FIFOs, sockets) are skipped and never recreated. A file that depends on a symlink will be missing at runtime, and the task log carries a warning that names the skipped entries.
- Entries that record only permission bits and no file type, which is what Python's `zipfile.writestr` produces, are treated as regular files and extract normally.
- A backslash in an entry name is read as a folder separator, as PowerShell 5.1 `Compress-Archive` writes it, so `wrap\script.jmx` extracts as `wrap/script.jmx`.
- Any entry whose path would escape the destination (a `..` traversal, an absolute path, or a drive letter such as `C:`, the zip-slip class) aborts the whole extraction, and setup hard-fails.
- Only regular files and directories inside the destination are ever written.
- An archive with no usable entries throws, and the error says whether it held no files, only non-regular entries, or only names the ignore rule drops.

## Failure Timing Summary

- Setup problems (script not found, empty archive, zip-slip, checksum or install failure, a failed `pip install`) throw and hard-fail the task with `TASK_FAILED`. You get a clear error in the task log.
- Runtime problems in Native mode (the script runs but errors, targets the wrong host, or throws inside a task) do not fail the container. The run completes and reports partial results, and a framework that exits non-zero is reported as a framework warning on the run. A Region in which no task recorded a request fails the run with `No requests were recorded` instead of completing. Diagnose these from the results and the framework warning, not from a task failure.
- Runtime problems in Standard mode can fail the task: the Taurus runner exits non-zero when `bzt` does, or when no `results.xml` is produced.
