# Bundled JMeter plugins and the plugin constraint

This file is the reference for the `dlt-jmeter-generation` skill. A generated plan must run inside the JMeter runtime DLT provides. It lists exactly what that runtime carries so you can confirm every non-core element in a plan is available.

## Apache JMeter Version

DLT ships **Apache JMeter 5.6.3** (unmodified, with SHA-512 checksum verification). The single source of truth for the version and the plugin set is `jmeter.json` at the root of the Distributed Load Testing on AWS repository. Treat this file as a snapshot; if a deployment differs, re-read `jmeter.json`.

## The 12 Bundled Plugins

DLT packages these plugins into `jmeter-bundle.tgz` and installs them into `JMETER_HOME/lib/ext/` before JMeter parses the plan, in both traffic-shape modes. A Native-mode plan may use core JMeter plus any element from these, and nothing else.

| Plugin id | Version | What it gives you |
|---|---|---|
| jpgc-casutg | 3.1.1 | Custom Thread Groups: Concurrency, Ultimate, Stepping, and Arrivals thread groups. The template's Concurrency Thread Group is from here. |
| jpgc-tst | 2.6 | Throughput Shaping Timer: shape requests-per-second over time. Pairs with a Concurrency Thread Group to hit a target rate. |
| jpgc-json | 2.7 | JSON Path extractor and assertion (in addition to core JMeter's own JSON extractor). |
| jpgc-functions | 2.2 | Extra JMeter functions (for example `__chooseRandom`, `__unescapeHtml`). |
| jpgc-dummy | 0.4 | Dummy Sampler: emit a synthetic sample without a real request, useful for debugging a plan's flow. |
| jpgc-ffw | 2.0 | Flexible File Writer: write custom columns to a file. Do not point it at `kpi.jtl`. |
| jpgc-fifo | 0.2 | Inter-Thread Communication: pass values between threads through a FIFO queue. |
| jpgc-perfmon | 2.1 | PerfMon Metrics Collector: collect server-side metrics from a PerfMon agent. |
| jpgc-prmctl | 0.4 | Parameterized Controller: reusable controller with parameters. |
| jpgc-udp | 0.4 | UDP Sampler: drive UDP endpoints. |
| bzm-http2 | 2.0.6 | HTTP/2 sampler and connection support. |
| bzm-random-csv | 0.8 | Random CSV Data Set: read CSV rows in random rather than sequential order. |

All are from the [JMeter Plugins](https://jmeter-plugins.org/) project.

## What DLT Does NOT Provide, by Mode

This is the key difference between the two traffic-shape modes for plugins.

### Native Mode (DLT v4.3.0 and Later, Opt-In)

- Installs Apache JMeter plus the 12 plugins above and **nothing else.**
- **User-supplied `plugins/*.jar` in the upload are ignored.** The install step reads only the bundle's plugin set.
- There is **no way to add a custom sampler, a plugin outside the bundle, or a patched JMeter binary.**
- Consequence: a plan that references an element whose class is in neither core JMeter nor the bundle fails at parse time with a missing-class error. The run then produces no useful result. Verify every non-core element against the table above before packaging.

### Standard Mode (Taurus, the Default on Every Version)

The Standard runner (`load-test.sh` running `bzt`) is more permissive about plugins:

- **Custom plugins:** in a zip upload, place `plugins/*.jar` in a `plugins/` folder beside the `.jmx` (directly in that folder, not a subfolder). The runner copies them into `JMETER_HOME/lib/ext/` before the run.
- **Plugin version override:** a jar whose name matches a bundled plugin (for example `bzm-http2-3.0.jar`) replaces the bundled version; the runner removes the bundled versions first.
- **No custom JMeter binary.** The solution's documentation describes supplying a patched JMeter binary in the archive. However, the Standard runner always points Taurus at the bundled JMeter 5.6.3, so it never uses a binary from the archive. To address a JMeter CVE, use the plugin override for an affected plugin jar; there is no supported way to replace the JMeter core.

Use custom plugins only when the scenario will run in Standard mode, where Taurus also overrides the plan's thread-group load settings with the scenario's concurrency, ramp-up, and hold-for. A plan that needs a non-bundled plugin will not run in Native mode. When you must stay portable across both modes, restrict the plan to core JMeter plus the bundled set.

## Practical Selection Notes

- For the load shape, prefer the **Concurrency Thread Group** (jpgc-casutg). It expresses target virtual users, ramp-up, steps, and a hold time directly, which is what Native mode needs since DLT injects nothing.
- To drive a target request rate rather than a fixed concurrency, add a **Throughput Shaping Timer** (jpgc-tst) alongside the Concurrency Thread Group.
- Core JMeter already includes HTTP samplers, Header Manager, CSV Data Set Config, JSON and regex extractors, response and JSON assertions, and Transaction and Loop controllers. You rarely need a plugin for a standard REST load test; the bundle mainly adds thread-group shapes, HTTP/2, and helpers.
