# Measured Reference Values

These values come from a controlled study of DLT load generators. Use them as reference points to
sanity-check your own calibration, not as defaults: your script, target, and host mix set your
numbers.

## Setup

- DLT v4.3.2 from the published template, one Region, Native mode, JMeter 5.6.3.
- Standard 2 vCPU, 4 GiB x86_64 Fargate tasks.
- The target: [go-httpbin](https://github.com/mccutchen/go-httpbin) v2.26.0 on a `c7g.4xlarge`
  instance (a `c7g.2xlarge` for the early runs) in the same Region, reached over its public IP.
  A wrapper logged the target's own request and connection counts every second, and its host CPU
  never exceeded 41 percent.
- The load model, unless a row says otherwise: a Concurrency Thread Group paced by a Throughput
  Shaping Timer, with `__tstFeedback` keeping 50 spare threads, HTTP keep-alive, and live data
  off.
- Task CPU came from the telemetry sampler and Container Insights, which agreed within about 3
  percent in every steady minute. Each hold dropped its first minute.

## Fixed Overhead

One task at 1 request per second for 7 minutes, after dropping two startup minutes:

| Configuration | Task CPU | Container memory |
|---|---|---|
| No sampler | 0.69 percent | about 261 MB |
| With the telemetry sampler | 0.85 percent | about 315 MB |
| With the sampler and live data | 0.82 percent | about 315 MB |

Task startup (installing JMeter and starting the JVM) used 11 to 20 percent CPU in its first
minute, so analysis always drops it.

## Connection Handling at 500 RPS

| Configuration | Task CPU | Latency p50 / p99 | New connections per second |
|---|---|---|---|
| HTTP, keep-alive | 3.6 percent | under 1 ms / 1 ms | 0.04 |
| HTTPS, keep-alive | 3.8 percent | under 1 ms / 1 ms | 0.04 |
| HTTPS, no keep-alive | 43.9 percent | 4 ms / 22 ms | 499 |
| HTTPS, Open Model Thread Group | 82.8 percent | 14 ms / 181 ms | 534 |

## Calibration Curve, Plain GET

Five tasks on Intel Xeon Platinum 8259CL hosts, with 5-minute holds from 1,000 to 20,000 RPS per
task, using a pool with a 10 percent spare:

| Quantity | Value |
|---|---|
| CPU per 1,000 RPS (`c1`) | 4.7 to 5.1 percent of task CPU |
| Fit quality | r² of 0.997 to 0.9997 per task |
| Fixed overhead (`c0`) | under 1 percent |
| `R_cpu` at 75 percent CPU | 14,535 to 15,960; 10th percentile 14,943; coefficient of variation 3.4 percent |
| Knee | CPU crossed 75 percent in the 16,000 hold on two tasks and the 20,000 hold on three |
| At 20,000 per task | CPU 95 to 98 percent, pools at their 400-thread maximum, p99 20 to 30 ms, 15,700 to 19,500 delivered |
| Heap after GC | flat at 29 to 30 MB |
| Container memory | 0.9 to 1.1 GB |
| Network | about 778 bytes per request |

With that 10 percent spare, three tasks fell to 95 percent of schedule at 4,000 RPS, with CPU at
18 percent: a pool shortfall, not saturation. Rerun on one task with a 50-thread spare:

| Configuration | CPU at 4,000 / 8,000 / 12,000 / 16,000 RPS | Achieved | `R_cpu` |
|---|---|---|---|
| 50 spare threads | 25 / 44 / 63 / 85 percent | 99.8 to 99.9 percent of schedule | 14,421 |
| 50 spare threads, live data on | 27 / 52 / 83 / 98 percent | 98.7 to 99.9 percent | 11,569 |

The larger pool raised `c0` to 5.7 percent and left `c1` unchanged. Live data raised CPU per request
by about 32 percent, all of it in the DLT runner, which re-reads the JTL.

## How Well One Light Run Predicts Capacity

Each prediction is the rate where task CPU would reach 75 percent, against the measured crossing:

| Prediction from | Mean error | Worst task |
|---|---|---|
| One 1,000-RPS hold, proportional | -12.9 percent | -14.8 percent |
| One 1,000-RPS hold, minus measured idle CPU | -1.7 percent | -4.1 percent |
| One 4,000-RPS hold, proportional | +4.9 percent | +7.2 percent |
| One 4,000-RPS hold, minus idle CPU | +8.0 percent | +10.7 percent |
| Linear fit over every hold below 75 percent | +4.2 percent | +5.7 percent |

A fixed 4,000-RPS run of 10 minutes with the 50-thread pool used 24.0 percent CPU, matching the
calibration's 4,000 hold.

## Latency, Payload, and Script Weight

One task each, 5-minute holds (10 minutes for the response-size runs):

| Run | Rate | Task CPU | Notes |
|---|---|---|---|
| `/delay` 0 ms | 1,000 | 7.0 percent | 0.7 requests in flight; container 932 MB |
| `/delay` 50 ms | 1,000 | 7.2 percent | 51 in flight; 947 MB |
| `/delay` 200 ms | 1,000 | 7.2 percent | 200 in flight; 969 MB |
| `/delay` 500 ms | 1,000 | 6.4 percent | 500 in flight on 551 threads; 1,031 MB |
| `/bytes` 1 KB | 4,000 | 22.5 percent | 6.0 MB/s |
| `/bytes` 32 KB | 1,000 | 10.1 percent | 278 Mbps |
| `/bytes` 256 KB | 300 | 5.0 percent | 655 Mbps held for 12 minutes |
| `/bytes` 256 KB | 500, then 800 | 7, then 11 percent | 1.10 Gbps, then 1.75 Gbps, 10 minutes each, no throttling |
| `/get` plus a JSON extractor and a JSON path assertion | 4,000 | 24.4 percent | about 0.4 points above the plain GET |

Latency costs no CPU. Heap after GC stayed at 30 MB at every delay, and container memory grew
about 0.2 MB per request in flight. The 500 ms run's only errors were "Socket closed" in its final
second, when shutdown cut off requests in flight.

## Closed Loop and Standard Mode

| Run | Result |
|---|---|
| Closed loop, 50 threads, `/delay` 10 / 50 / 200 ms | 4,780 / 983 / 249 RPS at 9.0 / 5.7 / 2.1 percent CPU |
| Standard (Taurus) mode, concurrency 50, the same paced plan at 4,000 / 8,000 / 12,000 RPS | 31 / 60 / 92 percent CPU, holding schedule at 99.6 to 99.9 percent |

Standard mode cost about 1.6 times Native mode's CPU per request, which puts its `R_cpu` near
10,000 for the plain GET.

## Scale Validation

Every run used the plain GET, the 50-thread pool, and live data off.

| Run | Delivered against scheduled | Task CPU, older hosts | Task CPU, newer hosts |
|---|---|---|---|
| 1 task at 9,000 | 8,988 (-0.13 percent) | 47.1 percent | none |
| 2 tasks at 9,000 | 17,979 (-0.12 percent) | 48.0, 49.9 percent | none |
| 4 tasks at 9,000 | 35,964 (-0.10 percent) | 48.1 percent | 19.1 to 25.1 percent |
| 8 tasks at 9,000 | 71,932 (-0.09 percent) | 43.5 percent | 18.8 to 26.3 percent |
| 9 tasks at 11,111 | 99,873 (-0.13 percent) | 55.2 to 61.4 percent | 23.2, 28.5 percent |
| 5 tasks at 10,000 | 49,942 (-0.12 percent) | 50.9, 51.0 percent | 23.7 to 30.3 percent |
| 1 task at 10,000 | 9,991 (-0.09 percent) | 54.0 percent | none |

The 9-task run was planned in advance from the calibration: `c0` from the 50-thread-pool rerun,
the most expensive task's `c1`, a 75 percent CPU limit, and a 10 percent margin. That gave
`R* = 12,182` and a plan of 9 tasks. It predicted 59 to 63 percent CPU per task, and every task
stayed under 75 percent. The ramps of the 1-, 5-, and 9-task shaped runs deviated from schedule by
0.16 to 0.23 percent of peak, and their holds by 0.09 to 0.13 percent. At the target, the request
count matched the generators' to within 0.05 percent.

DLT's results `throughput` for the 9-task run was 82,824, a whole-run average that includes the
ramp, while the hold delivered 99,873. Take steady rates from the per-task JTLs.

## Host Generations

| Host CPU | Generation | CPU per request, relative |
|---|---|---|
| Intel Xeon Platinum 8259CL | older | 1.0 |
| Intel Xeon Platinum 8175M | older | about 1.0 |
| Intel Xeon Platinum 8488C | newer | about 0.5 |
| Intel Xeon 6975P-C | newer | about 0.4 to 0.5 |
| AMD EPYC 9R14 | newer | about 0.5 |

Overnight, nearly every task landed on 8259CL or 8175M hosts. The next morning, most landed on the
newer generations. Because the calibration had run on older hosts, its plan was safe on every host
the full run used.
