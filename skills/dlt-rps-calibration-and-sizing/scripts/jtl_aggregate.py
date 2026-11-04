#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Fold a JMeter kpi.jtl (DLT Native mode CSV) into one row per second.

A calibration task at tens of thousands of requests per second writes gigabytes of JTL. This
script reduces one task's kpi.jtl to kpi-1s.csv: one row per second with the sample count, errors,
elapsed sum, an elapsed-time histogram, TCP connects, bytes received and sent, and peak thread
count. scripts/analyze_calibration.py rebuilds step statistics, including percentiles, from those
rows, so you can stream a large JTL straight from S3 and keep only the summary.

It uses only the Python standard library.

Usage:
    python3 jtl_aggregate.py kpi.jtl -o kpi-1s.csv
    aws s3 cp s3://<scenarios bucket>/results/<testId>/<prefix>/<region>/<taskId>/kpi.jtl - \\
        | python3 jtl_aggregate.py - -o kpi-1s.csv

The JTL must have a header row with at least timeStamp, elapsed, and success, which DLT Native
mode always writes. Connect, bytes, sentBytes, and allThreads are used when present.
"""

import argparse
import csv
import io
import sys
from collections import defaultdict

# Upper bounds of the elapsed-time histogram in milliseconds; the last bucket is open-ended.
BOUNDS_MS = [0, 1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000]
HIST_COLUMNS = [f"le_{b}" for b in BOUNDS_MS] + ["le_inf"]
COLUMNS = ["second", "count", "errors", "elapsed_sum_ms", "connects", "bytes", "sent_bytes", "max_threads"] + HIST_COLUMNS


def bucket(ms):
    for i, bound in enumerate(BOUNDS_MS):
        if ms <= bound:
            return i
    return len(BOUNDS_MS)


def aggregate(lines):
    """Return {second: row} from an iterable of JTL text lines (header first)."""
    reader = csv.reader(lines)
    header = next(reader)
    idx = {name: i for i, name in enumerate(header)}
    t_i, e_i, ok_i = idx["timeStamp"], idx["elapsed"], idx["success"]
    c_i, b_i, s_i, th_i = idx.get("Connect"), idx.get("bytes"), idx.get("sentBytes"), idx.get("allThreads")
    rows = defaultdict(lambda: [0, 0, 0, 0, 0, 0, 0] + [0] * len(HIST_COLUMNS))
    for rec in reader:
        if len(rec) < len(header):
            continue
        try:
            second = int(rec[t_i]) // 1000
            elapsed = int(rec[e_i])
        except ValueError:
            continue
        r = rows[second]
        r[0] += 1
        if rec[ok_i] != "true":
            r[1] += 1
        r[2] += elapsed
        if c_i is not None and rec[c_i] not in ("", "0"):
            r[3] += 1
        if b_i is not None and rec[b_i]:
            r[4] += int(rec[b_i])
        if s_i is not None and rec[s_i]:
            r[5] += int(rec[s_i])
        if th_i is not None and rec[th_i]:
            r[6] = max(r[6], int(rec[th_i]))
        r[7 + bucket(elapsed)] += 1
    return rows


def write_csv(rows, out):
    w = csv.writer(out)
    w.writerow(COLUMNS)
    for second in sorted(rows):
        w.writerow([second] + rows[second])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("jtl", help="path to kpi.jtl, or - to read standard input")
    ap.add_argument("-o", "--output", help="output CSV path (default: standard output)")
    args = ap.parse_args(argv)
    if args.jtl == "-":
        source = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace", newline="")
    else:
        source = open(args.jtl, encoding="utf-8", errors="replace", newline="")
    with source:
        rows = aggregate(source)
    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="") as out:
            write_csv(rows, out)
    else:
        write_csv(rows, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
