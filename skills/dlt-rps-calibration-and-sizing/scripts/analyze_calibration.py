#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Analyze a DLT Native mode calibration run and fit the per-task cost model.

Point it at the directory `dlt runs download <testId> <runId> --output-dir DIR` produced, which
holds one folder per task (DIR/<region>/<taskId>/) with kpi.jtl or kpi-1s.csv and, if the plan
included the telemetry sampler, telemetry.csv and telemetry-meta.json. Give it the schedule the
plan ran, as the .profile.json file make_calibration_plan.py wrote. Without telemetry, give it the
task CPU from Container Insights with --ci-events (see references/calibration-procedure.md).

For each task and each scheduled hold it reports: scheduled and achieved rate, latency, CPU, heap
after GC, container memory, requests in flight, network, and GC share. It fits
cpu = c0 + c1 * rps over the steps below the CPU limit, finds the knee, and computes the
CPU-limited capacity R_cpu = (cpu_max - c0) / c1. Across tasks it reports the 10th percentile,
the spread, and R_cpu per host CPU model. With --baseline-out it writes an input file for
plan_from_baseline.py.

It uses only the Python standard library.

Examples:
    python3 analyze_calibration.py run-artifacts/ --profile calibration.jmx.profile.json
    python3 analyze_calibration.py run-artifacts/ --profile calibration.jmx.profile.json \\
        --ci-events ci-events.json --baseline-out baseline.json --target-rps 100000 \\
        --region us-east-1=2000
"""

import argparse
import csv
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jtl_aggregate  # noqa: E402


def mean(values):
    values = [v for v in values if v is not None]
    return statistics.fmean(values) if values else None


def median(values):
    values = [v for v in values if v is not None]
    return statistics.median(values) if values else None


def hist_pct(hist, q):
    total = sum(hist)
    if not total:
        return None
    running = 0
    for i, n in enumerate(hist):
        running += n
        if running >= q * total:
            return float(jtl_aggregate.BOUNDS_MS[i]) if i < len(jtl_aggregate.BOUNDS_MS) else float("inf")
    return None


def load_seconds(task_dir):
    """Per-second request rows for one task, from kpi-1s.csv or the raw kpi.jtl."""
    agg = task_dir / "kpi-1s.csv"
    if agg.exists():
        with open(agg, encoding="utf-8") as f:
            reader = csv.reader(f)
            next(reader)
            raw = {int(r[0]): [int(x) for x in r[1:]] for r in reader}
    else:
        with open(task_dir / "kpi.jtl", encoding="utf-8", errors="replace", newline="") as f:
            raw = dict(jtl_aggregate.aggregate(f))
    return {sec: {"count": v[0], "errors": v[1], "elapsed_sum": v[2], "connects": v[3],
                  "bytes": v[4], "sent": v[5], "threads": v[6], "hist": v[7:]} for sec, v in raw.items()}


def load_telemetry(path, vcpus):
    """Per-second derived series from telemetry.csv, keyed by epoch second."""
    with open(path, encoding="utf-8") as f:
        lines = [line for line in f if not line.startswith("#")]
    raw = [{k: (float(v) if v not in ("", None) else None) for k, v in r.items()} for r in csv.DictReader(lines)]
    out = {}
    for prev, cur in zip(raw, raw[1:]):
        dt_s = (cur["ts_ms"] - prev["ts_ms"]) / 1000.0
        if dt_s <= 0:
            continue

        def delta(key):
            if cur.get(key) is None or prev.get(key) is None:
                return None
            return cur[key] - prev[key]

        cg, proc = delta("cg_cpu_usage_us"), delta("process_cpu_ns")
        gc = None
        if delta("young_gc_ms") is not None and delta("old_gc_ms") is not None:
            gc = delta("young_gc_ms") + delta("old_gc_ms")
        mem = None
        if cur.get("cg_mem_bytes") is not None:
            mem = (cur["cg_mem_bytes"] - (cur.get("cg_mem_inactive_file") or 0)) / 2**20
        net = None
        if delta("net_rx_bytes") is not None and delta("net_tx_bytes") is not None:
            net = (delta("net_rx_bytes") + delta("net_tx_bytes")) / dt_s
        out[int(cur["ts_ms"] // 1000)] = {
            "cpu": cg / (dt_s * 1e6 * vcpus) if cg is not None else None,
            "jvm_cpu": proc / (dt_s * 1e9 * vcpus) if proc is not None else None,
            "gc_frac": gc / (dt_s * 1000) if gc is not None else None,
            "throttled": delta("cg_nr_throttled"),
            "old_after_gc_mb": cur["old_used_after_gc"] / 2**20 if cur.get("old_used_after_gc") is not None else None,
            "container_mem_mb": mem,
            "net_bytes_per_s": net,
            "active_threads": cur.get("jmeter_active_threads"),
        }
    return out


def load_ci_events(path):
    """Container Insights task performance events keyed by TaskId, then by minute start (epoch s)."""
    text = Path(path).read_text(encoding="utf-8")
    messages = []
    try:
        doc = json.loads(text)
        messages = [e["message"] for e in doc.get("events", [])] if isinstance(doc, dict) else []
    except json.JSONDecodeError:
        messages = [line for line in text.splitlines() if line.strip()]
    events = defaultdict(dict)
    for message in messages:
        for part in message.split("\t"):
            try:
                e = json.loads(part)
            except json.JSONDecodeError:
                continue
            if e.get("Type") == "Task" and e.get("TaskId"):
                events[e["TaskId"]][int(e["Timestamp"]) // 1000] = e
    return events


def ci_series(task_events, vcpus):
    """Spread each Container Insights minute evenly over its seconds."""
    out = {}
    for minute, e in task_events.items():
        for sec in range(minute, minute + 60):
            out[sec] = {"cpu": e["CpuUtilized"] / (1024.0 * vcpus), "jvm_cpu": None, "gc_frac": None, "throttled": None,
                        "old_after_gc_mb": None, "container_mem_mb": e.get("MemoryUtilized"),
                        "net_bytes_per_s": None, "active_threads": None}
    return out


def windows(profile, t0, discard):
    """Steady-state windows (epoch seconds) for each constant-rate profile row."""
    result, offset = [], 0
    for i, (start, end, dur) in enumerate(profile):
        if float(start) == float(end) and dur > discard:
            result.append({"step": i, "scheduled_rps": float(start), "from": t0 + offset + discard, "to": t0 + offset + int(dur)})
        offset += int(dur)
    return result


def step_stats(seconds, series, w):
    lo, hi = w["from"], w["to"]
    span = max(1, hi - lo)
    cells = [seconds[s] for s in range(lo, hi) if s in seconds]
    secs = [series[s] for s in range(lo, hi) if s in series]
    count = sum(c["count"] for c in cells)
    hist = [sum(col) for col in zip(*[c["hist"] for c in cells])] if cells else []
    rps = count / span
    lat_mean = sum(c["elapsed_sum"] for c in cells) / count if count else None
    return {
        "step": w["step"], "scheduled_rps": w["scheduled_rps"], "rps": rps,
        "achieved_ratio": rps / w["scheduled_rps"] if w["scheduled_rps"] else None,
        "errors": sum(c["errors"] for c in cells), "samples": count,
        "lat_mean_ms": lat_mean, "lat_p50_ms": hist_pct(hist, 0.5), "lat_p99_ms": hist_pct(hist, 0.99),
        "connects": sum(c["connects"] for c in cells),
        "inflight": rps * (lat_mean or 0) / 1000.0,
        "cpu": mean([s["cpu"] for s in secs]), "jvm_cpu": mean([s["jvm_cpu"] for s in secs]),
        "gc_frac": mean([s["gc_frac"] for s in secs]),
        "throttled": sum(s["throttled"] or 0 for s in secs) if secs else None,
        "heap_after_gc_mb": median([s["old_after_gc_mb"] for s in secs]),
        "container_mem_mb": mean([s["container_mem_mb"] for s in secs]),
        "bytes_per_s": mean([s["net_bytes_per_s"] for s in secs]),
        "active_threads": mean([s["active_threads"] for s in secs]),
    }


def linear_fit(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    intercept = my - slope * mx
    ss_tot = sum((y - my) ** 2 for y in ys)
    ss_res = sum((y - intercept - slope * x) ** 2 for x, y in zip(xs, ys))
    return intercept, slope, (1 - ss_res / ss_tot) if ss_tot else 1.0


def saturation(step, base_latency, args):
    reasons = []
    if step["cpu"] is not None and step["cpu"] > args.cpu_max:
        reasons.append(f"cpu {step['cpu']:.2f}")
    if step["container_mem_mb"] is not None and step["container_mem_mb"] > 0.85 * 4096:
        reasons.append(f"container memory {step['container_mem_mb']:.0f} MB")
    if step["heap_after_gc_mb"] is not None and step["heap_after_gc_mb"] > 0.70 * 3072:
        reasons.append(f"heap after GC {step['heap_after_gc_mb']:.0f} MB")
    if step["gc_frac"] is not None and step["gc_frac"] > 0.05:
        reasons.append(f"GC {step['gc_frac']:.1%} of wall time")
    lat = step["lat_mean_ms"]
    if lat is not None and base_latency is not None and lat > base_latency * 1.2 and lat - base_latency >= 1:
        reasons.append(f"mean latency {lat:.2f} ms against {base_latency:.2f} ms at the lowest step")
    if step["samples"] and step["errors"] / step["samples"] > 0.001:
        reasons.append(f"errors {step['errors'] / step['samples']:.2%}")
    return reasons


def analyze_task(task_dir, profile, ci, args):
    seconds = load_seconds(task_dir)
    if not seconds:
        return None
    meta_path = task_dir / "telemetry-meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    tele_path = task_dir / "telemetry.csv"
    series, cpu_source = {}, None
    if tele_path.exists():
        series, cpu_source = load_telemetry(tele_path, args.vcpus), "telemetry"
    if not series or all(v["cpu"] is None for v in series.values()):
        if ci.get(task_dir.name):
            series, cpu_source = ci_series(ci[task_dir.name], args.vcpus), "container insights"
    t0 = min(seconds)
    steps = [step_stats(seconds, series, w) for w in windows(profile, t0, args.discard)]
    with_cpu = [s for s in steps if s["cpu"] is not None]
    base_latency = min((s["lat_mean_ms"] for s in steps if s["lat_mean_ms"] is not None), default=None)
    knee, pool_warnings = None, []
    for s in steps:
        reasons = saturation(s, base_latency, args)
        shortfall = s["achieved_ratio"] is not None and s["achieved_ratio"] < 0.98
        if shortfall and not reasons:
            pool_warnings.append(f"step {s['step']} ({s['scheduled_rps']:.0f}/s): achieved {s['achieved_ratio']:.3f} "
                                 f"with cpu {s['cpu'] if s['cpu'] is not None else float('nan'):.2f}; raise spare threads")
        elif reasons and knee is None:
            knee = {"step": s["step"], "scheduled_rps": s["scheduled_rps"], "rps": s["rps"],
                    "reasons": reasons + ([f"achieved {s['achieved_ratio']:.3f}"] if shortfall else [])}
    fit = None
    used = [s for s in with_cpu if s["cpu"] <= args.cpu_max]
    if len(used) >= 2 and len({round(s["rps"]) for s in used}) >= 2:
        c0, c1, r2 = linear_fit([s["rps"] for s in used], [s["cpu"] for s in used])
        fit = {"c0": c0, "c1": c1, "r_squared": r2, "steps_used": len(used),
               "r_cpu": (args.cpu_max - c0) / c1 if c1 > 0 else None}
    return {"task": task_dir.name, "cpu_model": meta.get("cpuModel"), "cpu_source": cpu_source,
            "steps": steps, "fit": fit, "knee": knee, "pool_warnings": pool_warnings, "used_steps": used}


def pct(values, q):
    values = sorted(values)
    k = (len(values) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (k - lo)


def write_baseline(path, tasks, summary, args):
    fitted = [t for t in tasks if t["fit"] and t["fit"]["r_cpu"]]
    chosen = min(fitted, key=lambda t: t["fit"]["r_cpu"])
    steps = []
    for s in chosen["used_steps"]:
        step = {"rps": round(s["rps"], 1), "cpu": round(s["cpu"], 4)}
        for key in ("inflight", "heap_after_gc_mb", "container_mem_mb", "bytes_per_s"):
            if s[key] is not None:
                step[key] = round(s[key], 3)
        steps.append(step)
    latency = median([s["lat_mean_ms"] for s in chosen["used_steps"]]) or 1.0
    regions = []
    for token in args.region or ["us-east-1=2000"]:
        name, _, avail = token.partition("=")
        regions.append({"name": name, "available_tasks": int(avail or 2000), "rt_ms": round(latency, 2), "weight": 1})
    peak = args.target_rps or 100000
    doc = {
        "_comment": (f"Written by analyze_calibration.py from task {chosen['task']} ({chosen['cpu_model']}), the "
                     f"lowest R_cpu of {len(fitted)} fitted tasks. Set target.peak_rps, target.shape, and each "
                     "Region's available_tasks and rt_ms (latency from that Region to the target) before planning."),
        # One calibration at a fixed target latency cannot separate memory per request in flight from
        # memory that grows with rate, so the slope comes from a latency experiment (measured at
        # about 0.2 MB on DLT JMeter tasks) unless you pass your own.
        "baseline": {"script": args.label or "calibration", "target_rt_ms": round(latency, 2), "steps": steps,
                     "mem_per_inflight_mb": args.mem_per_inflight,
                     "mem_base_mb": round(min(s["container_mem_mb"] for s in chosen["used_steps"]
                                              if s["container_mem_mb"] is not None), 1)
                     if any(s["container_mem_mb"] is not None for s in chosen["used_steps"]) else None},
        "limits": {"cpu_max": args.cpu_max, "heap_max_mb": 2150, "mem_max_mb": 3480, "net_max_bytes_s": None,
                   "margin": args.margin, "min_achieved_ratio": 0.0},
        "target": {"peak_rps": peak, "think_ms": 0,
                   "shape": [{"duration_s": 300, "rps": peak, "ramp": True}, {"duration_s": 600, "rps": peak}]},
        "regions": regions,
    }
    Path(path).write_text(json.dumps(doc, indent=2), encoding="utf-8")


def report(tasks, summary):
    def f(v, spec):
        return format(v, spec) if v is not None else "-"

    for t in tasks:
        print(f"task {t['task'][:12]} [{t['cpu_model'] or 'cpu model unknown'}] cpu from {t['cpu_source'] or 'nowhere'}")
        if not t["steps"]:
            print("  no constant-rate hold is longer than --discard; lower --discard or lengthen the holds")
        for s in t["steps"]:
            print(f"  step {s['step']}: sched {s['scheduled_rps']:>8,.0f} got {s['rps']:>9,.1f}/s ratio {f(s['achieved_ratio'], '.3f')} "
                  f"| cpu {f(s['cpu'], '.3f')} | lat mean {f(s['lat_mean_ms'], '.2f')} p99 {f(s['lat_p99_ms'], '.0f')} ms "
                  f"| heap {f(s['heap_after_gc_mb'], '.0f')} MB mem {f(s['container_mem_mb'], '.0f')} MB "
                  f"| in flight {s['inflight']:.1f} | errors {s['errors']}")
        if t["fit"]:
            fit = t["fit"]
            print(f"  fit over {fit['steps_used']} steps: c0 {fit['c0']:.4f}, c1 {fit['c1'] * 1000:.4f} per 1,000 rps, "
                  f"r2 {fit['r_squared']:.4f}, R_cpu {f(fit['r_cpu'], ',.0f')}")
        else:
            print("  fit: need at least two steps with CPU below the limit")
        if t["knee"]:
            print(f"  knee at step {t['knee']['step']} ({t['knee']['scheduled_rps']:,.0f}/s): " + "; ".join(t["knee"]["reasons"]))
        else:
            print("  knee: not reached within the schedule")
        for w in t["pool_warnings"]:
            print(f"  pool shortfall, not saturation: {w}")
    if summary:
        print(f"\nR_cpu across {summary['tasks']} tasks: p10 {summary['p10']:,.0f}, mean {summary['mean']:,.0f}, "
              f"min {summary['min']:,.0f}, max {summary['max']:,.0f}, coefficient of variation {summary['cv']:.1%}")
        for model, values in summary["by_model"].items():
            print(f"  {model}: {len(values)} task(s), R_cpu mean {statistics.fmean(values):,.0f}")
        print(f"per-task capacity with a {summary['margin']:.0%} margin: R* = {summary['r_star']:,.0f} requests per second")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("artifacts", help="directory produced by dlt runs download (one folder per task)")
    ap.add_argument("--profile", required=True, help="the .profile.json that make_calibration_plan.py wrote")
    ap.add_argument("--ci-events", help="Container Insights task events (aws logs filter-log-events --output json)")
    ap.add_argument("--discard", type=int, default=60, help="seconds to drop at the start of each hold (default 60)")
    ap.add_argument("--vcpus", type=int, default=2, help="task vCPUs (DLT tasks have 2)")
    ap.add_argument("--cpu-max", type=float, default=0.75, help="CPU limit as a fraction of task CPU (default 0.75)")
    ap.add_argument("--margin", type=float, default=0.10, help="variance margin applied to the 10th percentile (default 0.10)")
    ap.add_argument("--baseline-out", help="write a plan_from_baseline.py input file here")
    ap.add_argument("--target-rps", type=float, help="peak total RPS to put in the baseline file")
    ap.add_argument("--region", action="append", metavar="NAME=AVAILABLE_TASKS", help="Region for the baseline file; repeatable")
    ap.add_argument("--label", help="script description for the baseline file")
    ap.add_argument("--mem-per-inflight", type=float, default=0.2,
                    help="container MB per request in flight for the baseline file (default 0.2, measured on DLT JMeter tasks)")
    ap.add_argument("--json", action="store_true", help="print the full analysis as JSON")
    args = ap.parse_args(argv)

    profile = json.loads(Path(args.profile).read_text(encoding="utf-8"))["profile"]
    ci = load_ci_events(args.ci_events) if args.ci_events else {}
    root = Path(args.artifacts)
    task_dirs = sorted({p.parent for p in root.rglob("kpi-1s.csv")} | {p.parent for p in root.rglob("kpi.jtl")})
    if not task_dirs:
        print(f"error: no kpi.jtl or kpi-1s.csv under {root}", file=sys.stderr)
        return 2
    tasks = [t for t in (analyze_task(d, profile, ci, args) for d in task_dirs) if t]

    r_cpu = [t["fit"]["r_cpu"] for t in tasks if t["fit"] and t["fit"]["r_cpu"]]
    summary = {}
    if r_cpu:
        by_model = defaultdict(list)
        for t in tasks:
            if t["fit"] and t["fit"]["r_cpu"]:
                by_model[t["cpu_model"] or "unknown"].append(t["fit"]["r_cpu"])
        p10 = pct(r_cpu, 0.1)
        summary = {"tasks": len(r_cpu), "p10": p10, "mean": statistics.fmean(r_cpu), "min": min(r_cpu), "max": max(r_cpu),
                   "cv": statistics.pstdev(r_cpu) / statistics.fmean(r_cpu) if len(r_cpu) > 1 else 0.0,
                   "by_model": dict(by_model), "margin": args.margin, "r_star": (1 - args.margin) * p10}
    if args.baseline_out:
        if not r_cpu:
            print("error: no task produced a fit, so no baseline file was written", file=sys.stderr)
            return 1
        write_baseline(args.baseline_out, tasks, summary, args)
    if args.json:
        for t in tasks:
            t.pop("used_steps", None)
        print(json.dumps({"tasks": tasks, "summary": summary}, indent=2))
    else:
        report(tasks, summary)
        if args.baseline_out:
            print(f"wrote {args.baseline_out}; next: python3 plan_from_baseline.py {args.baseline_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
