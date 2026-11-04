# JMeter Load Model for Calibration on DLT

The load model is part of what a calibration measures, so the calibration and the full run must
use the same one. This reference covers the model that calibrates reliably on DLT JMeter 5.6.3
in Native mode, how to retrofit it into an existing plan, and the traps that distort the result.
Every figure comes from the controlled study in
[measured-reference-values.md](measured-reference-values.md).

## Recommended: Concurrency Thread Group Paced by a Throughput Shaping Timer

DLT bundles both pieces as JMeter plugins: the Concurrency Thread Group (`jpgc-casutg`) and the
Throughput Shaping Timer (`jpgc-tst`).

- **The timer holds the rate.** Its `load_profile` rows are `line(start, end, duration)` ramps and
  `const(rate, duration)` holds, per task.
- **The thread group holds the pool.** Set its target concurrency to
  `${__tstFeedback(<timer name>,<start>,<max>,<spare>)}`, a function that grows and shrinks the
  pool to what the rate needs, plus spare threads, up to `<max>`.
- **Its hold covers the whole profile.** Set the thread group's hold time to the sum of the
  profile's durations, in seconds.

`scripts/make_calibration_plan.py` generates exactly this structure for one HTTP request. To
retrofit an existing plan, replace its thread group with a Concurrency Thread Group configured as
above, and move the samplers under it. Then add the Throughput Shaping Timer as the thread group's
first child. Keep your samplers, extractors, and assertions unchanged, because they set the CPU
cost per request.

### Give the Pool a Floor of Spare Threads

Use an absolute spare count, for example `${__tstFeedback(dlt-shaping-timer,50,400,50)}`. With a
10 percent spare, the pool shrank to 2 to 5 threads at low latency, and each thread then had to
send about 1,000 requests per second. The timer paces with millisecond sleeps, so it cannot hold
sub-millisecond gaps. Three of five tasks fell to 95 percent of schedule at 4,000 RPS with CPU at
18 percent and flat latency. With 50 spare threads, every step held 99.8 to 99.9 percent of
schedule up to 16,000 RPS.

The floor is not free. Fifty idle threads raised the fixed overhead `c0` from about 0.7 to 5.7
percent of task CPU while leaving the per-request cost unchanged. That is why the calibration and
the full run must use the same pool settings.

### Size the Pool's Maximum for Requests in Flight

The pool must reach `R_task * (RT + think)` threads plus the spare. At 1,000 RPS against a target
with 500 ms latency, a task held about 500 requests in flight on about 550 threads. A pool that
hits its maximum stops holding the rate, which shows up as a shortfall together with rising
latency.

## Traps

### Never Schedule a Rate of 0

A Throughput Shaping Timer row that starts or ends at 0 requests per second makes the timer compute
an effectively infinite delay. The threads sleep, and the test never ends. Start ramps at 1.
`scripts/make_calibration_plan.py` and `scripts/plan_from_baseline.py` both do this for you.

### Avoid the Open Model Thread Group

JMeter 5.5 added the Open Model Thread Group, and JMeter 5.6.3 includes it. It starts a new thread
for every arrival, so every request opens a new TCP connection and, over HTTPS, pays a full TLS
handshake. A local check measured 1,000 new connections for 1,000 requests, against 8 for the
Concurrency Thread Group. On DLT at 500 HTTPS requests per second, the Open Model Thread Group used
83 percent of task CPU, against 3.8 percent with keep-alive. It also saturated for its first three
minutes and then caught up, delivering 534 RPS against a schedule of 500.

### Avoid the Precise Throughput Timer for High Rates

Its documentation says it works best below 36,000 requests per hour, which is 10 requests per
second.

### Keep Connections Reused

- Use the HttpClient4 implementation with keep-alive on.
- Keep "Same user on each iteration" checked on the thread group. When it is unchecked, JMeter's
  `httpclient.reset_state_on_thread_group_iteration` (default true) closes connections at every
  iteration.
- Expect some churn anyway. `httpclient4.time_to_live` (60 seconds) retires each connection, so a
  target sees about one new connection per open connection per minute. One thread opened 5
  connections in 5 minutes.

Many more new connections than that means every request pays a handshake. HTTPS without
keep-alive cost about 12 times the CPU per request of HTTPS with keep-alive (43.9 against 3.8
percent of task CPU at 500 RPS).

### Discard the Warm-Up

The JIT compiles hot paths during the first minutes. Without keep-alive, task CPU started near 98
percent and settled to about 40 percent after two minutes. Discard a warm-up of about 3 minutes,
and drop the first minute of every hold.

### Use a DNS Cache Manager for Multi-IP Targets

The JVM caches DNS, so without a DNS Cache Manager every thread in a task can pin to one node of an
Application Load Balancer or a CloudFront distribution.

## Pacing Costs CPU

A paced pool cost about 4.8 percent of task CPU per 1,000 RPS for a plain GET. An unpaced closed
loop of 50 threads against a target with 10 ms latency delivered 4,780 RPS at 9 percent CPU,
roughly a third of the paced cost per request. The closed loop is cheaper, but its rate follows
the target's latency. Calibrate with the model the real run will use.
