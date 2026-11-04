#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Plan a large DLT load test from a small baseline run, sized by RPS.

The calculator reads a JSON file that describes a baseline calibration run, the
generator limits to respect, a target RPS shape, and the Regions to use. It fits
a per-task cost model, derives the per-task capacity R* for each Region, and
returns the task count per Region plus the per-task rate schedule to bake into
the script.

The model (see references/sizing-model.md):
  cpu(R)   = c0 + c1 * R          fraction of the task's 2 vCPU
  L        = R * (RT + think)     requests in flight per task (Little's Law)
  heap(L)  = h0 + h1 * L          old-generation MB after GC
  mem(L)   = m0 + m1 * L          container MB without page cache (thread stacks,
                                  metaspace, and the Node runner sit outside the heap)
  bytes(R) = b * R                bytes per second, both directions

  R*_r     = (1 - margin) * min(R_cpu, R_heap_r, R_mem_r, R_net)
  N        = ceil(peak_rps / min_r R*_r)
  R_task   = peak_rps / N         every task runs the same script and rate

Every DLT task in a scenario runs a full copy of the same script, so the
per-task rate is uniform across Regions and the regional split is by task
count. The rate must be safe for the Region with the highest latency.

It uses only the Python standard library. Run with --example to print an input
file to start from.

Examples:
  python3 plan_from_baseline.py --example > baseline.json
  python3 plan_from_baseline.py baseline.json
  python3 plan_from_baseline.py baseline.json --peak-rps 25000 --json
"""

import argparse
import json
import math
import statistics
import sys

VCPUS_PER_TASK = 2

EXAMPLE = {
    "_comment": (
        "Illustrative numbers only, not measurements. Replace the steps with "
        "steady-state values from a calibration run."
    ),
    "baseline": {
        "script": "plain GET, HTTP keep-alive, open model",
        "target_rt_ms": 4,
        "steps": [
            {"rps": 500, "cpu": 0.16, "heap_after_gc_mb": 180, "container_mem_mb": 1450,
             "inflight": 2.0, "bytes_per_s": 290000, "achieved_ratio": 1.0},
            {"rps": 1000, "cpu": 0.27, "heap_after_gc_mb": 185, "container_mem_mb": 1460,
             "inflight": 4.1, "bytes_per_s": 580000, "achieved_ratio": 1.0},
            {"rps": 2000, "cpu": 0.49, "heap_after_gc_mb": 192, "container_mem_mb": 1480,
             "inflight": 8.3, "bytes_per_s": 1160000, "achieved_ratio": 0.999},
        ],
        "idle_cpu": None,
        "heap_base_mb": None,
        "heap_per_inflight_mb": 0.5,
        "mem_base_mb": None,
        "mem_per_inflight_mb": 1.2,
    },
    "limits": {
        "cpu_max": 0.75,
        "heap_max_mb": 2150,
        "mem_max_mb": 3480,
        "net_max_bytes_s": None,
        "margin": 0.10,
        "min_achieved_ratio": 0.98,
    },
    "target": {
        "peak_rps": 100000,
        "think_ms": 0,
        "shape": [
            {"duration_s": 600, "rps": 100000, "ramp": True},
            {"duration_s": 900, "rps": 100000},
        ],
    },
    "regions": [
        {"name": "us-west-2", "available_tasks": 2000, "rt_ms": 4, "weight": 1},
        {"name": "us-east-2", "available_tasks": 2000, "rt_ms": 55, "weight": 1},
        {"name": "us-east-1", "available_tasks": 2000, "rt_ms": 70, "weight": 1},
        {"name": "eu-west-1", "available_tasks": 2000, "rt_ms": 135, "weight": 1},
    ],
}


class PlanError(ValueError):
    """Raised when the input cannot produce a plan."""


def linear_fit(xs, ys):
    """Ordinary least squares y = a + b*x. Returns (a, b, r_squared)."""
    n = len(xs)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    sxx = sum((x - mean_x) ** 2 for x in xs)
    if sxx == 0:
        raise PlanError("cannot fit a line through points with identical x values")
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    slope = sxy / sxx
    intercept = mean_y - slope * mean_x
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    ss_res = sum((y - (intercept + slope * x)) ** 2 for x, y in zip(xs, ys))
    r_squared = 1.0 - ss_res / ss_tot if ss_tot > 0 else 1.0
    return intercept, slope, r_squared


def fit_inflight_term(model, warnings, usable, baseline, label, field, base_key, slope_key, prefix):
    """Fit y = base + slope * inflight for heap or container memory into model[prefix0/1]."""
    slope = baseline.get(slope_key)
    base = baseline.get(base_key)
    points = [s for s in usable if field in s and "inflight" in s]
    if slope is not None:
        if base is None:
            base = min(s[field] for s in points) if points else 0.0
        model.update({f"{prefix}0": base, f"{prefix}1": slope, f"{prefix}_fit": "given"})
    elif len({s["inflight"] for s in points}) >= 2:
        base_fit, slope_fit, r2 = linear_fit([s["inflight"] for s in points], [s[field] for s in points])
        model.update({f"{prefix}0": base if base is not None else base_fit, f"{prefix}1": slope_fit,
                      f"{prefix}_fit": "linear", f"{prefix}_r_squared": r2})
        if slope_fit <= 0:
            warnings.append(f"{label} does not grow with requests in flight in this data; {label} limit not applied")
    else:
        warnings.append(
            f"{label} cost per request in flight is unmeasured; {label} limit not applied "
            "(run the latency experiment to measure it)"
        )


def fit_model(baseline, limits):
    """Fit c0, c1, h0, h1, and b from the baseline steps. Returns (model, warnings)."""
    warnings = []
    min_ratio = limits.get("min_achieved_ratio", 0.98)
    steps = baseline.get("steps") or []
    usable = [s for s in steps if s.get("achieved_ratio", 1.0) >= min_ratio and s["rps"] > 0]
    dropped = len(steps) - len(usable)
    if dropped:
        warnings.append(
            f"dropped {dropped} step(s) whose achieved ratio is below {min_ratio}; "
            "those are past the knee and do not belong in the cost fit"
        )
    if not usable:
        raise PlanError("no usable baseline steps; every step is past the knee or empty")

    model = {"steps_used": len(usable)}

    # CPU: intercept and slope when there are two or more load levels. One level
    # gives only a proportional cost, which folds the fixed overhead into the
    # per-request cost and so understates capacity.
    rps = [s["rps"] for s in usable]
    cpu = [s["cpu"] for s in usable]
    idle_cpu = baseline.get("idle_cpu")
    if len(set(rps)) >= 2:
        c0, c1, r2 = linear_fit(rps, cpu)
        model.update(c0=c0, c1=c1, cpu_fit="linear", cpu_r_squared=r2)
        if r2 < 0.95:
            warnings.append(f"CPU fit is weak (r^2 = {r2:.3f}); check the steps for noise or a knee")
        if c0 < 0:
            warnings.append("fitted CPU intercept is negative; treating fixed overhead as 0")
            model["c0"] = 0.0
    elif idle_cpu is not None:
        c1 = (cpu[0] - idle_cpu) / rps[0]
        model.update(c0=idle_cpu, c1=c1, cpu_fit="single point with measured idle CPU")
    else:
        model.update(c0=0.0, c1=cpu[0] / rps[0], cpu_fit="proportional (single point)")
        warnings.append(
            "one load level and no idle_cpu: cost per request includes fixed overhead, "
            "so R_cpu is conservative; add steps or measure idle CPU to tighten it"
        )
    if model["c1"] <= 0:
        raise PlanError("CPU cost per request is not positive; the baseline steps are inconsistent")

    # Heap and container memory: cost per request in flight, from an explicit
    # value (latency experiment) or from a fit across steps whose in-flight
    # counts differ.
    for label, field, base_key, slope_key, prefix in (
        ("heap", "heap_after_gc_mb", "heap_base_mb", "heap_per_inflight_mb", "h"),
        ("container memory", "container_mem_mb", "mem_base_mb", "mem_per_inflight_mb", "m"),
    ):
        fit_inflight_term(model, warnings, usable, baseline, label, field, base_key, slope_key, prefix)

    # Network: median bytes per request across steps.
    per_request = [s["bytes_per_s"] / s["rps"] for s in usable if "bytes_per_s" in s]
    if per_request:
        model["b"] = statistics.median(per_request)
    return model, warnings


def region_capacity(model, limits, rt_ms, think_ms):
    """Per-task capacity R* in one Region and the limit that binds it."""
    candidates = {"cpu": (limits["cpu_max"] - model["c0"]) / model["c1"]}
    seconds_in_flight = (rt_ms + think_ms) / 1000.0
    for name, prefix, limit_key in (("heap", "h", "heap_max_mb"), ("memory", "m", "mem_max_mb")):
        slope = model.get(f"{prefix}1")
        if slope and slope > 0 and seconds_in_flight > 0 and limits.get(limit_key):
            candidates[name] = (limits[limit_key] - model[f"{prefix}0"]) / (slope * seconds_in_flight)
    net_max = limits.get("net_max_bytes_s")
    if net_max and model.get("b"):
        candidates["network"] = net_max / model["b"]
    binding = min(candidates, key=candidates.get)
    raw = candidates[binding]
    if raw <= 0:
        raise PlanError(f"no headroom: the {binding} limit is already used by fixed overhead")
    return (1.0 - limits.get("margin", 0.10)) * raw, binding, candidates


def allocate(n_tasks, regions):
    """Split n_tasks across Regions by weight (largest remainder), capped by availability."""
    alloc = {r["name"]: 0 for r in regions}
    remaining = n_tasks
    open_regions = [r for r in regions if r.get("weight", 1) > 0 and r["available_tasks"] > 0]
    while remaining > 0 and open_regions:
        total_weight = sum(r.get("weight", 1) for r in open_regions)
        shares = [(r, remaining * r.get("weight", 1) / total_weight) for r in open_regions]
        handed_out = 0
        for r, share in shares:
            take = min(int(share), r["available_tasks"] - alloc[r["name"]])
            alloc[r["name"]] += take
            handed_out += take
        leftover = remaining - handed_out
        by_remainder = sorted(shares, key=lambda item: item[1] - int(item[1]), reverse=True)
        for r, _ in by_remainder:
            if leftover == 0:
                break
            if alloc[r["name"]] < r["available_tasks"]:
                alloc[r["name"]] += 1
                leftover -= 1
        remaining = leftover
        open_regions = [r for r in open_regions if alloc[r["name"]] < r["available_tasks"]]
    return alloc, remaining


def format_rate(rps):
    """Short decimal for schedule strings."""
    return f"{rps:.2f}".rstrip("0").rstrip(".") if rps % 1 else str(int(rps))


def per_task_shape(shape, n_tasks):
    """Divide the total RPS shape by N and render JMeter schedule strings."""
    segments = []
    previous = 0.0
    for seg in shape:
        start = previous if seg.get("ramp") else seg["rps"]
        end = seg["rps"]
        segments.append({
            "duration_s": seg["duration_s"],
            "total_start_rps": start,
            "total_end_rps": end,
            "task_start_rps": start / n_tasks,
            "task_end_rps": end / n_tasks,
        })
        previous = end

    # Open Model Thread Group schedule: a rate before and after random_arrivals
    # ramps linearly between them; a lone random_arrivals holds the last rate.
    omtg = []
    current = None
    for seg in segments:
        if current is None or seg["task_start_rps"] != current:
            omtg.append(f"rate({format_rate(seg['task_start_rps'])}/sec)")
        omtg.append(f"random_arrivals({seg['duration_s']} sec)")
        if seg["task_end_rps"] != seg["task_start_rps"]:
            omtg.append(f"rate({format_rate(seg['task_end_rps'])}/sec)")
        current = seg["task_end_rps"]

    # Throughput Shaping Timer load_profile: line(start,end,duration) and const(rps,duration).
    # A rate of 0 makes the timer compute an effectively infinite delay, so threads sleep and the
    # test never ends; ramps start at 1 request per second instead.
    tst = []
    for seg in segments:
        a, b, d = max(1.0, seg["task_start_rps"]), max(1.0, seg["task_end_rps"]), seg["duration_s"]
        if a == b:
            tst.append(f"const({format_rate(a)},{d}s)")
        else:
            tst.append(f"line({format_rate(a)},{format_rate(b)},{d}s)")

    return segments, " ".join(omtg), " ".join(tst)


def plan(config, peak_override=None):
    limits = config["limits"]
    target = config["target"]
    regions = config["regions"]
    peak = peak_override or target["peak_rps"]
    think_ms = target.get("think_ms", 0)
    if not regions:
        raise PlanError("at least one Region is required")

    model, warnings = fit_model(config["baseline"], limits)

    per_region = {}
    used = [r for r in regions if r.get("weight", 1) > 0]
    for r in used:
        capacity, binding, candidates = region_capacity(model, limits, r["rt_ms"], think_ms)
        per_region[r["name"]] = {"r_star": capacity, "binding": binding, "limits": candidates}
    worst = min(per_region, key=lambda name: per_region[name]["r_star"])
    r_task_max = per_region[worst]["r_star"]

    n_tasks = math.ceil(peak / r_task_max)
    alloc, shortfall = allocate(n_tasks, used)
    r_task = peak / n_tasks

    result = {
        "feasible": shortfall == 0,
        "peak_rps": peak,
        "model": model,
        "limits": limits,
        "r_task_max": r_task_max,
        "rate_limited_by": {"region": worst, "limit": per_region[worst]["binding"]},
        "tasks": n_tasks,
        "r_task": r_task,
        "regions": [],
        "warnings": warnings,
    }
    if shortfall:
        result["shortfall_tasks"] = shortfall
        result["shortfall_vcpus"] = shortfall * VCPUS_PER_TASK

    # dlt scenarios create --task-count, and a --from-file spec, apply one task count to every
    # Region, so a plan whose Regions get different counts needs another way to create it.
    counts = {alloc[r["name"]] for r in used if alloc[r["name"]] > 0}
    if len(counts) > 1:
        warnings.append(
            "The task counts differ across Regions. dlt scenarios create and a --from-file spec "
            "apply one task count to every Region, so create this plan in the console or with the "
            "MCP create_test tool, which takes a task_count per Region."
        )

    for r in used:
        n = alloc[r["name"]]
        inflight = r_task * (r["rt_ms"] + think_ms) / 1000.0
        entry = {
            "region": r["name"],
            "available_tasks": r["available_tasks"],
            "task_count": n,
            "rps": n * r_task,
            "vcpus": n * VCPUS_PER_TASK,
            "rt_ms": r["rt_ms"],
            "r_star": per_region[r["name"]]["r_star"],
            "binding_limit": per_region[r["name"]]["binding"],
            "predicted_cpu_per_task": model["c0"] + model["c1"] * r_task,
            "predicted_inflight_per_task": inflight,
        }
        if model.get("h1"):
            entry["predicted_heap_mb_per_task"] = model["h0"] + model["h1"] * inflight
        if model.get("m1"):
            entry["predicted_container_mem_mb_per_task"] = model["m0"] + model["m1"] * inflight
        if model.get("b"):
            entry["predicted_bytes_per_s_per_task"] = model["b"] * r_task
        result["regions"].append(entry)

    shape = target.get("shape") or [{"duration_s": 600, "rps": peak}]
    if peak_override:
        scale = peak_override / target["peak_rps"]
        shape = [dict(seg, rps=seg["rps"] * scale) for seg in shape]
    segments, omtg, tst = per_task_shape(shape, n_tasks)
    result["shape"] = {
        "segments": segments,
        "open_model_schedule": omtg,
        "throughput_shaping_profile": tst,
    }
    return result


def format_report(result):
    m = result["model"]
    lines = ["DLT plan from baseline (sized by RPS)", "=" * 72]
    lines.append(f"Peak target RPS          : {result['peak_rps']:,.0f}")
    lines.append(f"CPU model                : cpu = {m['c0']:.3f} + {m['c1'] * 1000:.4f} per 1k RPS ({m['cpu_fit']})")
    if m.get("h1"):
        lines.append(f"Heap model               : heap_mb = {m['h0']:.0f} + {m['h1']:.3f} per request in flight ({m['h_fit']})")
    if m.get("m1"):
        lines.append(f"Memory model             : mem_mb = {m['m0']:.0f} + {m['m1']:.3f} per request in flight ({m['m_fit']})")
    if m.get("b"):
        lines.append(f"Bytes per request        : {m['b']:.0f}")
    lines.append(f"Per-task capacity (min)  : {result['r_task_max']:,.0f} RPS, set by "
                 f"{result['rate_limited_by']['limit']} in {result['rate_limited_by']['region']}")
    lines.append(f"Tasks                    : {result['tasks']}")
    lines.append(f"Per-task rate            : {result['r_task']:,.1f} RPS (bake this into the script)")
    lines.append("")
    header = f"{'Region':<14}{'avail':>7}{'tasks':>7}{'RPS':>10}{'vCPU':>7}{'RT ms':>7}{'R*':>8}{'bind':>9}{'cpu/task':>10}{'in-flight':>11}"
    lines.append(header)
    lines.append("-" * len(header))
    for r in result["regions"]:
        lines.append(
            f"{r['region']:<14}{r['available_tasks']:>7}{r['task_count']:>7}{r['rps']:>10,.0f}"
            f"{r['vcpus']:>7}{r['rt_ms']:>7}{r['r_star']:>8,.0f}{r['binding_limit']:>9}"
            f"{r['predicted_cpu_per_task']:>10.0%}{r['predicted_inflight_per_task']:>11.1f}"
        )
    lines.append("-" * len(header))
    lines.append("")
    if result["feasible"]:
        lines.append("FEASIBLE")
    else:
        lines.append(
            f"INFEASIBLE: short by {result['shortfall_tasks']} tasks ({result['shortfall_vcpus']} vCPU). "
            "Add Regions, raise the Fargate vCPU quota (L-3032A538), or lower the target."
        )
    lines.append("")
    lines.append("Per-task schedule")
    lines.append(f"  Throughput Shaping Timer: {result['shape']['throughput_shaping_profile']}")
    lines.append(f"  Open Model Thread Group : {result['shape']['open_model_schedule']}")
    lines.append("    (reference only: the Open Model Thread Group opens a new connection per request)")
    if result["warnings"]:
        lines.append("")
        lines.append("Warnings")
        for w in result["warnings"]:
            lines.append(f"  - {w}")
    return "\n".join(lines)


def build_parser():
    parser = argparse.ArgumentParser(
        description="Plan per-Region task counts and a per-task rate from a DLT baseline run.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("input", nargs="?", help="Baseline and target JSON file.")
    parser.add_argument("--peak-rps", type=float, help="Override the peak; the shape scales with it.")
    parser.add_argument("--json", action="store_true", help="Emit the plan as JSON.")
    parser.add_argument("--example", action="store_true", help="Print an example input file and exit.")
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.example:
        print(json.dumps(EXAMPLE, indent=2))
        return 0
    if not args.input:
        parser.error("an input file is required (or use --example)")
    with open(args.input, encoding="utf-8") as handle:
        config = json.load(handle)
    try:
        result = plan(config, peak_override=args.peak_rps)
    except PlanError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2) if args.json else format_report(result))
    return 0 if result["feasible"] else 1


if __name__ == "__main__":
    sys.exit(main())
