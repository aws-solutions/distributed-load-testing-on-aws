#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Aggregate downloaded DLT dlt.result.v1 artifacts into a per-region and total summary.

It uses only the Python standard library, so it runs anywhere Python 3.9 or newer
is available, with no boto3 and no third-party packages. Point it at a single result.json file or a
directory of downloaded run artifacts and it reproduces the results parser's own
aggregation for a Native mode run.

The parser does not average the per-task display values. Each result.json carries
a mergeable statistics block. It holds request and byte counts, a Welford and Chan
mean and variance state, the exact minimum and maximum, a fixed-layout latency
histogram, and response-code counts. The parser merges those blocks per region and then into the
total, and derives every average, standard deviation, and percentile from the
merged state. This script does the same, in the same order, then applies the
parser's rounding and success-code stripping. Only the observed concurrency and
the test duration are averaged across tasks, because the statistics block does not
carry them.

By default the script shows latency in milliseconds, matching the console and the
CLI. Use --raw-seconds to show the exact rounded seconds values the results parser
stores in DynamoDB. With --format json it emits the stored results object itself,
so you can diff it against the API or the History table.

Usage:
    python3 aggregate_results.py <path> [options]

    <path>                 A result.json file, or a directory to search recursively
                           for dlt.result.v1 files.

    --labels               Include the per-label (per-request) breakdown.
    --format {text,markdown,csv,json}
                           Output format, text by default. The json format emits
                           the stored shape (results, completeTasks, succPercent)
                           and always uses the stored seconds values.
    --raw-seconds          Emit latency in the exact seconds values the parser
                           stores, instead of the default milliseconds.
    -o, --output <file>    Write the report to a file instead of stdout.

This script is part of the dlt-results-analysis skill. See
references/dlt-result-v1-reference.md for the field definitions and the
aggregation rules it reproduces.
"""

import argparse
import hashlib
import json
import math
import os
import sys
from decimal import Decimal, ROUND_HALF_UP

SCHEMA = "dlt.result.v1"
HISTOGRAM_LAYOUT_ID = "dlt.latency-us.rel-0p5pct.0-24h.v1"

# Success and redirect codes the parser strips before storing rc. Kept in sync with
# acceptedCodes in source/results-parser/lib/parser/index.js.
ACCEPTED_CODES = {
    "200", "201", "202", "204",
    "300", "301", "302", "303", "304", "307", "308",
    "101", "1000",
}

# Keys the parser sums across tasks.
SUM_KEYS = ("succ", "fail", "throughput")
# Keys stored with 0 decimals.
AVG0_KEYS = ("bytes", "concurrency", "testDuration")
# Keys stored with 5 decimals.
AVG5_KEYS = ("avg_ct", "avg_lt", "avg_rt")
# Keys stored with 3 decimals (percentiles and standard deviation).
AVG3_KEYS = ("p0_0", "p50_0", "p90_0", "p95_0", "p99_0", "p99_9", "p100_0", "stdev_rt")

# Field order of a stored aggregate, matching the object the parser writes.
STORED_KEYS = (
    "avg_ct", "avg_lt", "avg_rt", "bytes", "concurrency", "fail",
    "p0_0", "p100_0", "p50_0", "p90_0", "p95_0", "p99_0", "p99_9",
    "stdev_rt", "succ", "testDuration", "throughput",
)

# The fixed latency histogram layout, from
# source/common/src/streaming-statistics/latency-layout.ts. The SHA-256 of the
# canonical rows guards against drift from the product's table.
LATENCY_BUCKET_COUNT = 2184
MAX_LATENCY_US = 86_400_000_000
LATENCY_LAYOUT_SHA256 = "f4f2711a805b2fee2e607d6e93182be0d86b7ff9c93d99a2f23d75e4f2c40c53"

_REPRESENTATIVES = None


def bucket_representatives():
    """Build the bucket table once, exactly as the product generates it."""
    global _REPRESENTATIVES
    if _REPRESENTATIVES is not None:
        return _REPRESENTATIVES
    rows = []
    representatives = []
    lower = 1
    while lower <= MAX_LATENCY_US:
        representative = min((201 * lower) // 200, MAX_LATENCY_US)
        upper = min((200 * representative) // 199, MAX_LATENCY_US)
        rows.append(f"{lower},{upper},{representative}\n")
        representatives.append(representative)
        lower = upper + 1
    digest = hashlib.sha256("".join(rows).encode("ascii")).hexdigest()
    if len(representatives) != LATENCY_BUCKET_COUNT or digest != LATENCY_LAYOUT_SHA256:
        sys.exit("error: generated latency layout does not match the product's layout")
    _REPRESENTATIVES = representatives
    return representatives


def js_to_fixed(value, digits):
    """Format a number the way JavaScript's Number.prototype.toFixed does.

    toFixed rounds the exact binary value of the double, picking the larger
    candidate on an exact tie. Decimal(float) holds that exact binary value, so
    rounding it half up matches toFixed for every value a results run produces.
    """
    dec = Decimal(float(value))
    quant = Decimal(1) if digits <= 0 else Decimal(1).scaleb(-digits)
    return str(dec.quantize(quant, rounding=ROUND_HALF_UP))


def utf8_key(text):
    """Sort key matching the product's compareUtf8 ordering."""
    return text.encode("utf-8")


# ---------------------------------------------------------------------------
# Mergeable statistics (a port of source/common/src/streaming-statistics)
# ---------------------------------------------------------------------------

class Distribution:
    """Latency count, mean, M2, exact endpoints, and sparse histogram."""

    def __init__(self):
        self.count = 0
        self.mean = None
        self.m2 = 0.0
        self.min = None
        self.max = None
        self.zero_count = 0
        self.bins = {}

    def merge(self, count, mean, m2, minimum, maximum, zero_count, bins):
        """Chan's parallel-variance merge, in the product's operation order."""
        if count != 0:
            if self.count == 0:
                self.mean, self.m2 = mean, m2
            else:
                total = self.count + count
                delta = mean - self.mean
                self.mean = self.mean + (delta * count) / total
                self.m2 = self.m2 + m2 + (delta * delta * self.count * count) / total
        self.count += count
        if minimum is not None:
            self.min = minimum if self.min is None else min(self.min, minimum)
        if maximum is not None:
            self.max = maximum if self.max is None else max(self.max, maximum)
        if count > 0:
            self.zero_count += zero_count
            for index, bin_count in bins:
                self.bins[index] = self.bins.get(index, 0) + bin_count

    def merge_state(self, state):
        histogram = state.get("histogram") or {}
        self.merge(
            state.get("count", 0), state.get("meanUs"), state.get("m2UsSquared", 0),
            state.get("minUs"), state.get("maxUs"),
            histogram.get("zeroCount", 0), histogram.get("bins", []),
        )

    def merge_from(self, other):
        self.merge(other.count, other.mean, other.m2, other.min, other.max,
                   other.zero_count, sorted(other.bins.items()))

    def percentile_us(self, numerator, denominator):
        """Nearest-rank bucket representative, clamped to the exact endpoints."""
        if self.min is None or self.max is None:
            return None
        rank = (numerator * self.count + denominator - 1) // denominator
        cumulative = self.zero_count
        estimate = 0
        if cumulative < rank:
            representatives = bucket_representatives()
            for index in sorted(self.bins):
                cumulative += self.bins[index]
                if cumulative >= rank:
                    estimate = representatives[index]
                    break
        return min(max(estimate, self.min), self.max)


class Mean:
    """Count and weighted mean for waiting time or connect time."""

    def __init__(self):
        self.count = 0
        self.mean = None

    def merge(self, count, mean):
        if count != 0:
            if self.count == 0:
                self.mean = mean
            else:
                total = self.count + count
                self.mean = self.mean + ((mean - self.mean) * count) / total
        self.count += count

    def merge_state(self, state):
        self.merge(state.get("count", 0), state.get("meanUs"))


class Aggregate:
    """One row of merged statistics: the summary, or one label."""

    def __init__(self):
        self.requests = 0
        self.failures = 0
        self.bytes = 0
        self.latency = Distribution()
        self.waiting = Mean()
        self.connect = Mean()
        self.codes = {}

    def merge_state(self, state):
        requests = state.get("requests") or {}
        self.requests += requests.get("total", 0)
        self.failures += requests.get("failure", 0)
        self.bytes += state.get("bytesReceived", 0)
        self.latency.merge_state(state.get("latency") or {})
        self.waiting.merge_state(state.get("waitingTime") or {})
        self.connect.merge_state(state.get("connectTime") or {})
        for entry in state.get("responseCodes", []):
            self.codes[entry["code"]] = self.codes.get(entry["code"], 0) + entry["count"]

    def merge_from(self, other):
        self.requests += other.requests
        self.failures += other.failures
        self.bytes += other.bytes
        self.latency.merge_from(other.latency)
        self.waiting.merge(other.waiting.count, other.waiting.mean)
        self.connect.merge(other.connect.count, other.connect.mean)
        for code, count in other.codes.items():
            self.codes[code] = self.codes.get(code, 0) + count


class Group:
    """Merged state for one region or the total, plus the averaged fields."""

    def __init__(self):
        self.summary = Aggregate()
        self.labels = {}
        self.task_count = 0
        self.duration_sum = 0
        self.summary_concurrency_sum = 0
        self.label_concurrency = {}

    def label(self, name):
        if name not in self.labels:
            self.labels[name] = Aggregate()
        return self.labels[name]

    def add_task(self, artifact):
        statistics = artifact["statistics"]
        self.summary.merge_state(statistics["summary"])
        for state in statistics.get("labels", []):
            self.label(state["label"]).merge_state(state)
        self.task_count += 1
        self.duration_sum += artifact["testDurationSeconds"]
        self.summary_concurrency_sum += artifact["summary"]["concurrency"]
        for display in artifact.get("labels", []):
            entry = self.label_concurrency.setdefault(display["label"], [0, 0])
            entry[0] += display["concurrency"]
            entry[1] += 1

    def add_group(self, other):
        self.summary.merge_from(other.summary)
        for name, aggregate in other.labels.items():
            self.label(name).merge_from(aggregate)
        self.task_count += other.task_count
        self.duration_sum += other.duration_sum
        self.summary_concurrency_sum += other.summary_concurrency_sum
        for name, (total, count) in other.label_concurrency.items():
            entry = self.label_concurrency.setdefault(name, [0, 0])
            entry[0] += total
            entry[1] += count


# ---------------------------------------------------------------------------
# Finalizing into the stored shape
# ---------------------------------------------------------------------------

def _us_to_ms(value):
    return 0 if value is None else value / 1000


def stored_row(aggregate, concurrency, test_duration=None, label=None):
    """Finalize one merged row and apply the parser's units and rounding.

    Mirrors finalizeAggregate, then the native toStats mapping (milliseconds to
    seconds), then createFinalResults. Label rows carry no test duration, so they
    store "0", as the parser does.
    """
    latency = aggregate.latency
    stdev_ms = 0 if latency.count == 0 else math.sqrt(latency.m2 / latency.count) / 1000

    def percentile_s(numerator, denominator):
        value = latency.percentile_us(numerator, denominator)
        return 0 if value is None else (value / 1000) / 1000

    seconds = {
        "avg_ct": _us_to_ms(aggregate.connect.mean) / 1000,
        "avg_lt": _us_to_ms(aggregate.waiting.mean) / 1000,
        "avg_rt": _us_to_ms(latency.mean) / 1000,
        "p0_0": _us_to_ms(latency.min) / 1000,
        "p100_0": _us_to_ms(latency.max) / 1000,
        "p50_0": percentile_s(1, 2),
        "p90_0": percentile_s(9, 10),
        "p95_0": percentile_s(95, 100),
        "p99_0": percentile_s(99, 100),
        "p99_9": percentile_s(999, 1000),
        "stdev_rt": stdev_ms / 1000,
    }

    row = {}
    for key in STORED_KEYS:
        if key == "fail":
            row[key] = aggregate.failures
            if label is not None:
                row["label"] = label
        elif key == "succ":
            row[key] = aggregate.requests - aggregate.failures
        elif key == "throughput":
            row[key] = aggregate.requests
        elif key == "bytes":
            row[key] = js_to_fixed(aggregate.bytes, 0)
        elif key == "concurrency":
            row[key] = js_to_fixed(concurrency, 0)
        elif key == "testDuration":
            row[key] = js_to_fixed(test_duration if test_duration is not None else 0, 0)
        elif key in AVG5_KEYS:
            row[key] = js_to_fixed(seconds[key], 5)
        else:
            row[key] = js_to_fixed(seconds[key], 3)

    row["rc"] = [
        {"code": code, "count": aggregate.codes[code]}
        for code in sorted(aggregate.codes, key=utf8_key)
        if code != "" and code not in ACCEPTED_CODES
    ]
    return row


def finalize_group(group):
    """The stored aggregate for one region or the total."""
    row = stored_row(
        group.summary,
        group.summary_concurrency_sum / group.task_count,
        group.duration_sum / group.task_count,
    )
    labels = []
    for name in sorted(group.labels, key=utf8_key):
        total, count = group.label_concurrency.get(name, (0, 0))
        labels.append(stored_row(group.labels[name], total / count if count else 0, label=name))
    row["labels"] = labels
    return row


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

def collect_result_files(path):
    if os.path.isfile(path):
        return [path]
    if not os.path.isdir(path):
        sys.exit(f"error: no such file or directory: {path}")
    files = []
    for root, _dirs, names in os.walk(path):
        for name in names:
            if name.endswith(".json"):
                files.append(os.path.join(root, name))
    return sorted(files)


def load_artifacts(path):
    """Return (artifacts_by_region, warnings).

    Skips files that are not dlt.result.v1, files the parser would reject for a
    missing or foreign statistics block, and tasks that recorded zero requests.
    """
    files = collect_result_files(path)
    single = os.path.isfile(path)
    by_region = {}
    seen_regions = set()
    warnings = []
    matched = 0

    for file_path in files:
        try:
            with open(file_path, "r", encoding="utf-8") as handle:
                artifact = json.load(handle)
        except (OSError, ValueError) as err:
            if single:
                sys.exit(f"error: could not read {file_path}: {err}")
            warnings.append(f"skipped unreadable file {file_path}: {err}")
            continue

        if not isinstance(artifact, dict) or artifact.get("schema") != SCHEMA:
            if single:
                sys.exit(f"error: {file_path} is not a {SCHEMA} artifact")
            continue

        matched += 1
        region = artifact.get("region") or "unknown"
        seen_regions.add(region)
        statistics = artifact.get("statistics")
        if not isinstance(statistics, dict) or statistics.get("histogramLayout") != HISTOGRAM_LAYOUT_ID:
            warnings.append(
                f"skipped task {artifact.get('taskId')} in {region}: no usable statistics block, "
                "so the results parser rejects this file and reports the run's collection as incomplete"
            )
            continue

        if (statistics.get("summary") or {}).get("requests", {}).get("total", 0) == 0:
            warnings.append(f"skipped task {artifact.get('taskId')} in {region}: no requests recorded")
            continue

        by_region.setdefault(region, []).append(artifact)

    if matched == 0:
        sys.exit(f"error: no {SCHEMA} artifacts found under {path}")

    empty = sorted(seen_regions - set(by_region))
    if empty:
        warnings.append(
            f"no requests were recorded in {', '.join(empty)}; the results parser fails a run "
            "whose Region recorded no requests"
        )

    for artifacts in by_region.values():
        artifacts.sort(key=lambda item: str(item.get("taskId")))
    return by_region, warnings


def aggregate(by_region):
    """Merge per region in task order, then merge the regions into the total."""
    finals = {}
    task_counts = {}
    total = Group()
    for region in sorted(by_region):
        group = Group()
        for artifact in by_region[region]:
            group.add_task(artifact)
        total.add_group(group)
        finals[region] = finalize_group(group)
        task_counts[region] = group.task_count
    if total.task_count:
        finals["total"] = finalize_group(total)
        task_counts["total"] = total.task_count
    return finals, task_counts


# ---------------------------------------------------------------------------
# Presentation
# ---------------------------------------------------------------------------

def latency_value(seconds_string, raw_seconds):
    """Render a stored seconds string as either the raw seconds or milliseconds."""
    if raw_seconds:
        return seconds_string
    return f"{float(seconds_string) * 1000:.2f}"


def success_rate(final):
    throughput = final["throughput"]
    if throughput <= 0:
        return "0.00"
    return f"{(final['succ'] / throughput) * 100:.2f}"


def rc_string(rc):
    if not rc:
        return "(all success or redirect codes)"
    return "; ".join(f"{entry['code']}:{entry['count']}" for entry in rc)


def unit_label(raw_seconds):
    return "s" if raw_seconds else "ms"


ROWS = [
    ("avg_rt", "avg response"),
    ("p50_0", "p50"),
    ("p90_0", "p90"),
    ("p95_0", "p95"),
    ("p99_0", "p99"),
    ("p99_9", "p99.9"),
    ("p0_0", "min"),
    ("p100_0", "max"),
    ("stdev_rt", "stddev"),
    ("avg_lt", "avg latency"),
    ("avg_ct", "avg connect"),
]


def ordered_scopes(finals):
    regions = sorted(k for k in finals if k != "total")
    return regions + (["total"] if "total" in finals else [])


def render_text(scopes, finals, task_counts, include_labels, raw_seconds, warnings):
    unit = unit_label(raw_seconds)
    out = []
    for warn in warnings:
        out.append(f"note: {warn}")
    if warnings:
        out.append("")

    for scope in scopes:
        final = finals[scope]
        out.append(f"=== {scope} ===")
        out.append(f"tasks aggregated: {task_counts.get(scope, 0)}")
        out.append(
            f"requests: total={final['throughput']} success={final['succ']} "
            f"failure={final['fail']} success_rate={success_rate(final)}%"
        )
        out.append("  (throughput is a total request count, not requests per second)")
        out.append(f"response time ({unit}):")
        for key, label in ROWS:
            out.append(f"  {label:<12} {latency_value(final[key], raw_seconds)}")
        out.append(f"bytes received:     {final['bytes']}")
        out.append(f"avg concurrency:    {final['concurrency']}  (per-task peak, averaged)")
        out.append(f"avg test duration:  {final['testDuration']} s")
        out.append(f"error codes (rc):   {rc_string(final['rc'])}")

        if include_labels and final.get("labels"):
            out.append("labels:")
            for label in final["labels"]:
                out.append(f"  - {label['label'] or '(unnamed)'}")
                out.append(
                    f"      requests: total={label['throughput']} success={label['succ']} "
                    f"failure={label['fail']} success_rate={success_rate(label)}%"
                )
                out.append(
                    f"      avg={latency_value(label['avg_rt'], raw_seconds)} "
                    f"p90={latency_value(label['p90_0'], raw_seconds)} "
                    f"p95={latency_value(label['p95_0'], raw_seconds)} "
                    f"p99={latency_value(label['p99_0'], raw_seconds)} {unit}"
                )
                out.append(f"      error codes: {rc_string(label['rc'])}")
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def render_markdown(scopes, finals, task_counts, include_labels, raw_seconds, warnings):
    unit = unit_label(raw_seconds)
    out = ["# DLT Run Results", ""]
    if warnings:
        out.append("> Notes:")
        for warn in warnings:
            out.append(f"> - {warn}")
        out.append("")

    for scope in scopes:
        final = finals[scope]
        out.append(f"## {scope}")
        out.append("")
        out.append(f"- Tasks aggregated: {task_counts.get(scope, 0)}")
        out.append(f"- Total requests: {final['throughput']} (a count, not a rate)")
        out.append(f"- Success: {final['succ']}")
        out.append(f"- Failure: {final['fail']}")
        out.append(f"- Success rate: {success_rate(final)}%")
        out.append(f"- Bytes received: {final['bytes']}")
        out.append(f"- Avg concurrency (per-task peak): {final['concurrency']}")
        out.append(f"- Avg test duration: {final['testDuration']} s")
        out.append("")
        out.append(f"| Metric ({unit}) | Value |")
        out.append("|---|---|")
        for key, label in ROWS:
            out.append(f"| {label} | {latency_value(final[key], raw_seconds)} |")
        out.append("")
        out.append("Error codes:")
        out.append("")
        if final["rc"]:
            out.append("| Code | Count |")
            out.append("|---|---|")
            for entry in final["rc"]:
                out.append(f"| {entry['code']} | {entry['count']} |")
        else:
            out.append("_All requests returned a success or redirect code._")
        out.append("")

        if include_labels and final.get("labels"):
            out.append(f"### {scope}: Labels")
            out.append("")
            out.append(
                f"| Label | Requests | Success | Failure | Success % | "
                f"avg {unit} | p90 {unit} | p95 {unit} | p99 {unit} | Error codes |"
            )
            out.append("|---|---|---|---|---|---|---|---|---|---|")
            for label in final["labels"]:
                out.append(
                    f"| {label['label'] or '(unnamed)'} | {label['throughput']} | "
                    f"{label['succ']} | {label['fail']} | {success_rate(label)} | "
                    f"{latency_value(label['avg_rt'], raw_seconds)} | "
                    f"{latency_value(label['p90_0'], raw_seconds)} | "
                    f"{latency_value(label['p95_0'], raw_seconds)} | "
                    f"{latency_value(label['p99_0'], raw_seconds)} | {rc_string(label['rc'])} |"
                )
            out.append("")
    return "\n".join(out).rstrip() + "\n"


def render_csv(scopes, finals, task_counts, include_labels, raw_seconds, warnings):
    import csv
    import io

    unit = unit_label(raw_seconds)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    header = [
        "scope", "label", "tasks", "requests_total", "success", "failure", "success_rate_pct",
        f"avg_rt_{unit}", f"p50_{unit}", f"p90_{unit}", f"p95_{unit}", f"p99_{unit}",
        f"p999_{unit}", f"min_{unit}", f"max_{unit}", f"stdev_{unit}",
        f"avg_lt_{unit}", f"avg_ct_{unit}",
        "bytes", "avg_concurrency", "avg_test_duration_s", "error_codes",
    ]
    writer.writerow(header)

    def row(scope, label_name, obj, tasks):
        writer.writerow([
            scope, label_name, tasks,
            obj["throughput"], obj["succ"], obj["fail"], success_rate(obj),
            latency_value(obj["avg_rt"], raw_seconds),
            latency_value(obj["p50_0"], raw_seconds),
            latency_value(obj["p90_0"], raw_seconds),
            latency_value(obj["p95_0"], raw_seconds),
            latency_value(obj["p99_0"], raw_seconds),
            latency_value(obj["p99_9"], raw_seconds),
            latency_value(obj["p0_0"], raw_seconds),
            latency_value(obj["p100_0"], raw_seconds),
            latency_value(obj["stdev_rt"], raw_seconds),
            latency_value(obj["avg_lt"], raw_seconds),
            latency_value(obj["avg_ct"], raw_seconds),
            obj["bytes"], obj["concurrency"], obj["testDuration"],
            rc_string(obj["rc"]) if obj["rc"] else "",
        ])

    for scope in scopes:
        final = finals[scope]
        row(scope, "", final, task_counts.get(scope, 0))
        if include_labels:
            for label in final.get("labels", []):
                row(scope, label["label"] or "(unnamed)", label, task_counts.get(scope, 0))

    text = buffer.getvalue()
    if warnings:
        text = "".join(f"# {w}\n" for w in warnings) + text
    return text


def render_json(scopes, finals, task_counts, include_labels, raw_seconds, warnings):
    """The stored history fields: results, completeTasks, and succPercent."""
    for warn in warnings:
        print(f"note: {warn}", file=sys.stderr)
    results = {scope: finals[scope] for scope in scopes}
    if not include_labels:
        results = {scope: {k: v for k, v in obj.items() if k != "labels"} for scope, obj in results.items()}
    total = finals.get("total")
    succ_percent = 0
    if total and total["throughput"] > 0:
        succ_percent = js_to_fixed((total["succ"] / total["throughput"]) * 100, 2)
    document = {
        "results": results,
        "completeTasks": {scope: count for scope, count in task_counts.items() if scope != "total"},
        "succPercent": succ_percent,
    }
    return json.dumps(document, indent=2) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Aggregate downloaded DLT dlt.result.v1 artifacts per region and total."
    )
    parser.add_argument("path", help="A result.json file or a directory of downloaded artifacts.")
    parser.add_argument("--labels", action="store_true", help="Include the per-label breakdown.")
    parser.add_argument(
        "--format", choices=["text", "markdown", "csv", "json"], default="text", help="Output format."
    )
    parser.add_argument(
        "--raw-seconds", action="store_true",
        help="Emit latency in the exact seconds values the parser stores, not milliseconds.",
    )
    parser.add_argument("-o", "--output", help="Write the report to a file instead of stdout.")
    args = parser.parse_args(argv)

    by_region, warnings = load_artifacts(args.path)
    finals, task_counts = aggregate(by_region)
    scopes = ordered_scopes(finals)

    renderers = {"text": render_text, "markdown": render_markdown, "csv": render_csv, "json": render_json}
    report = renderers[args.format](
        scopes, finals, task_counts, args.labels, args.raw_seconds, warnings
    )

    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(report)
        print(f"wrote {args.format} report to {args.output}", file=sys.stderr)
    else:
        sys.stdout.write(report)


if __name__ == "__main__":
    main()
