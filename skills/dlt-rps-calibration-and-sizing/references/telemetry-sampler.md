# Telemetry Sampler

DLT records load results (requests, latency, errors) but no resource data from inside the
load-generator container. The telemetry sampler in [../templates/telemetry.groovy](../templates/telemetry.groovy)
fills that gap without changing DLT. It runs inside the JMeter plan, records the task's own CPU,
memory, heap, garbage collection, network, and sockets once per second, and writes the result next
to `kpi.jtl`. DLT Native mode uploads every file at the top level of `/tmp/artifacts`, so the data
arrives with the task's other artifacts.

You need the sampler for heap, GC, throttling, and per-second resolution. For CPU alone,
Container Insights is enough: its per-task events agreed with the sampler within about 3 percent
in every steady minute. See [calibration-procedure.md](calibration-procedure.md).

## Adding It to a Plan

`scripts/make_calibration_plan.py` adds it unless you pass `--no-telemetry`. To add it to your own
plan:

1. Add a setUp Thread Group with 1 thread and 1 loop.
2. Under it, add a JSR223 Sampler with language `groovy` and "Cache compiled script" on.
3. Paste the contents of `templates/telemetry.groovy` as its script.

The sampler starts a daemon thread and returns at once, so the setUp group finishes and the main
thread groups start normally. It marks its own sample as ignored, so it never appears in `kpi.jtl`
or in DLT's results. When JMeter exits, the JVM stops the thread.

The output directory is the JMeter property `dlt.telemetry.dir`, which defaults to
`/tmp/artifacts`. DLT does not set `dlt.telemetry.dir` in Native mode (it passes only JTL format
and engine properties on the JMeter command line), so the default applies there.
Override it only when you run the plan elsewhere, for example `-Jdlt.telemetry.dir=./out` on a
local JMeter.

Standard (Taurus) mode uploads a fixed set of files, so `telemetry.csv` does not arrive. Use
Container Insights for Standard mode CPU.

## Files

`telemetry-meta.json`, written once:

| Field | Meaning |
|---|---|
| `cpuModel` | the host CPU model from `/proc/cpuinfo`; the most important field for sizing |
| `availableProcessors`, `maxHeapBytes`, `jvmArgs`, `javaVersion` | the JVM's view of the task |
| `cgroupVersion` | `v1`, `v2`, or `none` |
| `gcCollectors`, `oldGenPool` | which collectors and pool the sampler reads |
| `taskArn`, `availabilityZone`, `limits`, `launchType` | from the ECS task metadata endpoint v4 |

`telemetry.csv`, one row per second, aligned to the wall-clock second. Every counter is raw and
cumulative, so take differences between rows.

| Column | Meaning |
|---|---|
| `ts_ms` | epoch milliseconds |
| `jmeter_active_threads`, `jvm_threads` | JMeter's active threads and all JVM threads |
| `process_cpu_ns` | JVM process CPU time |
| `heap_used`, `heap_committed` | current heap, in bytes |
| `old_used`, `old_used_after_gc` | old-generation occupancy now and after the last collection |
| `young_gc_count`, `young_gc_ms`, `old_gc_count`, `old_gc_ms` | collector counts and time |
| `cg_cpu_usage_us` | container CPU time from the cgroup, in microseconds |
| `cg_nr_throttled`, `cg_throttled_us` | CFS throttling periods and time |
| `cg_mem_bytes`, `cg_mem_inactive_file` | container memory and its reclaimable page cache |
| `net_rx_bytes`, `net_tx_bytes` | task network bytes from `/proc/net/dev`, loopback excluded |
| `tcp_inuse`, `tcp_tw`, `tcp_alloc` | TCP sockets in use, in TIME_WAIT, and allocated |

Derived values that `scripts/analyze_calibration.py` computes:

- Task CPU fraction: the change in `cg_cpu_usage_us` divided by (seconds times 1,000,000 times 2
  vCPU).
- Container memory: `cg_mem_bytes` minus `cg_mem_inactive_file`.
- GC share: the change in GC milliseconds divided by elapsed milliseconds.
- Network rate: the change in received plus sent bytes per second.

## Overhead

On a 2 vCPU task at 1 request per second, the sampler added 0.17 points of task CPU and about
54 MB of container memory. Container Insights measured both against the same plan without the
sampler. The sampler found cgroup v1 on Fargate and populated every column.
