# Sizing Model: From One Calibrated Task to N Tasks Across Regions

This reference explains the cost model behind the `dlt-rps-calibration-and-sizing` skill: why the
skill sizes by requests per second (RPS), and which costs a load-generator task pays. It then shows
how the per-task capacity `R*` follows from those costs, and how a plan turns `R*` into task counts
per Region.
The values quoted here come from the controlled study summarized in
[measured-reference-values.md](measured-reference-values.md).

## Why RPS, and Why an Open Model

In a closed workload, a fixed number of threads each send a request, wait for the response, think,
and repeat. Little's Law then fixes the rate:

```text
RPS = threads / (RT + think)
```

Doubling the target's latency halves the RPS for the same threads. A virtual-user count therefore
says nothing about RPS until you know the latency, and latency is what a load test measures, so
sizing by virtual users is circular. In the study, 50 closed-loop threads delivered exactly 50
divided by the latency: 4,780 RPS at 10 ms, 983 RPS at 50 ms, and 249 RPS at 200 ms.

In an open workload, requests arrive at a scheduled rate regardless of how fast earlier ones
finished. The rate is the controlled variable and latency is the measurement, so the generator's
cost per request can be read directly. On DLT the practical way to get that is a Concurrency
Thread Group paced by a Throughput Shaping Timer (see [jmeter-load-model.md](jmeter-load-model.md)).

## Cost Terms for One Task

A DLT task has 2 vCPU and 4 GiB of memory, and JMeter runs in a JVM capped at a 3 GB heap. A task
holding a sustained rate `R` pays four costs.

**CPU.** `cpu(R) = c0 + c1 * R`, as a fraction of the task's 2 vCPU. `c0` is fixed overhead: the
JVM, the DLT runner, JTL writing, the pool's idle threads, and the telemetry sampler if you add it.
`c1` is the cost per request, set by the request mix, TLS, payload size, and any extractors,
assertions, or listeners. CPU starvation does not kill a task. It lowers the achieved rate and
inflates client latency. In the study, CPU was linear in rate with r² of at least 0.997 on every
task.

**Requests in flight.** By Little's Law, a task holding `R` against a target with latency `RT`
(plus think time) has `L = R * (RT + think)` requests in flight. Each one holds a thread, so the
pool must be able to grow to `L` plus spare threads.

**Memory.** Old-generation heap after garbage collection, `heap(L) = h0 + h1 * L`, and container
memory without page cache, `mem(L) = m0 + m1 * L`. Thread stacks, metaspace, and the DLT runner
live outside the heap, so the container can reach its 4 GiB limit (exit code 137) while the heap
still has room. In the study, heap after GC stayed flat at 29 to 30 MB up to 500 requests in
flight, so `h1` is near zero. Container memory grew about 0.2 MB per request in flight, which is
`m1`.

**Network.** `bytes(R) = b * R`, both directions. A plain GET cost about 778 bytes per request. A
2 vCPU task sustained 1.75 Gbps for 10 minutes without throttling, so network binds only for large
responses.

## Per-Task Capacity

```text
R_cpu    = (CPU_MAX - c0) / c1
R_heap_r = (HEAP_MAX - h0) / (h1 * (RT_r + think))
R_mem_r  = (MEM_MAX - m0) / (m1 * (RT_r + think))
R_net    = NET_MAX / b
R*_r     = (1 - margin) * min(R_cpu, R_heap_r, R_mem_r, R_net)
```

Default limits: `CPU_MAX` 0.75 and `MEM_MAX` 0.85 of 4,096 MB (about 3,480 MB), matching the
BlazeMeter calibration guide, Azure Load Testing's engine health thresholds, and the DLT
Implementation Guide. `HEAP_MAX` is 0.70 of 3,072 MB (about 2,150 MB), `NET_MAX` is 0.70 of
measured sustained bandwidth, and `margin` is 0.10. Apply the margin to the 10th percentile of
`R_cpu` across calibration tasks, not to the mean.

`R*` is the unified metric this skill reports: the sustained RPS one DLT task delivers for this
script against this target before any generator limit is reached, with margin. Unlike a
virtual-user count, it is comparable across JMeter, k6, and Locust. For the HTTP workloads in the
study, CPU bound first every time.

## From R* to a Plan

DLT uploads one script per scenario, and every task in every Region runs a full, uncoordinated copy
of it. One per-task rate therefore applies everywhere:

```text
R_task_max = min over Regions r of R*_r
N          = ceil(peak_RPS / R_task_max)
R_task     = peak_RPS / N
```

`N` is split across Regions by weight, capped by each Region's available tasks
(`floor((vCPU quota - vCPUs in use) / 2)`), and each Region then delivers `n_r * R_task`. A shape
defined in total RPS (ramps, holds, steps) becomes the per-task shape by dividing every point by
`N`. Scaling the whole test up or down changes `N` and the per-task shape together. In the study,
shapes at 10, 50, and 100 percent of a 100,000-RPS plan each tracked their schedule within 0.25
percent of peak.

## Fitting From a Calibration Run

- **Three or more levels below the knee.** Fit `c0` and `c1` by least squares over every hold
  below `CPU_MAX`. A weak fit usually means a step was already saturated, too short, or affected
  by a pool shortfall.
- **One level.** A proportional estimate `c1 = cpu / R` folds `c0` into the per-request cost. That
  understates `R_cpu`, so the plan is conservative; in the study it came out about 13 percent low.
  With `c0` measured by a separate idle run, a single low step predicted capacity within 4 percent.
- **Higher steps run slightly optimistic.** CPU per request rises a little toward the top of the
  range, so a straight line from mid-range steps overshoots the true crossing by about 4 to 7
  percent. The 10 percent margin is sized to cover that.
- **`m1` needs a latency experiment.** At one target latency, requests in flight rise with rate,
  so a fit cannot separate memory per request in flight from memory that grows with rate. Use the
  measured 0.2 MB unless you run your own latency steps.

## Host Generation

Fargate chooses the host, and the task cannot. The same task landed on Intel Xeon Platinum 8259CL,
8175M, and 8488C, Intel Xeon 6975P-C, and AMD EPYC 9R14 hosts, and the mix changed from one run to
the next. Per request, the newer generations needed about half the CPU of the 8259CL and 8175M
hosts. Size for the slowest generation you observe: a newer host only adds headroom, and the next
run may land on older ones.
