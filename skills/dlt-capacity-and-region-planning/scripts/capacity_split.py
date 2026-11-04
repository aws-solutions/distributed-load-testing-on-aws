#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Capacity split calculator for Distributed Load Testing on AWS (DLT).

The calculator takes a target number of virtual users, a per-task concurrency,
the vCPUs each Fargate task consumes, and the tasks available in each Region.
It computes a feasible per-Region taskCount and concurrency split, and it flags
an infeasible target with the shortfall and concrete options to close the gap.

The model this follows:
  - Each Fargate task drives `concurrency` virtual users. For a Native run,
    where the uploaded script sets its own user count, pass the virtual users
    the script declares as --concurrency.
  - Tasks needed = ceil(target_vus / concurrency).
  - Each Region can run up to its available-task count,
    floor((vCPU quota - vCPUs in use) / vCPUs per task). The DLT API enforces
    that ceiling when a run starts on v4.3.2 and later; on v4.3.0 and v4.3.1,
    check it yourself.
  - Tasks are distributed across the Regions in the order given, without
    exceeding any Region's available tasks.
  - The DLT API rejects a Standard mode concurrency above 25,000 per task. The
    calculator warns about such a value but still computes the split, because
    in Native mode the script's own user count never reaches the API.

It uses only the Python standard library, with no third-party dependencies.

Examples:
  python3 capacity_split.py --target-vus 5000 --concurrency 50 \\
      --region us-east-1=60 --region eu-west-1=40

  python3 capacity_split.py --target-vus 3000 --concurrency 25 \\
      --regions us-east-1=100,eu-west-1=50 --json
"""

import argparse
import json
import math
import sys

# The DLT request schema accepts a per-Region concurrency from 1 to 25,000
# (source/common/src/api/schemas.ts in the solution). Native mode sends a
# placeholder concurrency of 1, so the limit applies to Standard mode only.
API_CONCURRENCY_MAX = 25000


def parse_region_token(token):
    """Parse a single 'name=available' token into (name, available_int)."""
    token = token.strip()
    if "=" not in token:
        raise argparse.ArgumentTypeError(
            f"region must be NAME=AVAILABLE_TASKS, got: {token!r}"
        )
    name, _, avail = token.partition("=")
    name = name.strip()
    avail = avail.strip()
    if not name:
        raise argparse.ArgumentTypeError(f"region name is empty in {token!r}")
    try:
        available = int(avail)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"available tasks for {name!r} must be an integer, got {avail!r}"
        )
    if available < 0:
        raise argparse.ArgumentTypeError(
            f"available tasks for {name!r} must be >= 0, got {available}"
        )
    return (name, available)


def parse_region_list(value):
    """Parse a comma-separated 'name=avail,name=avail' string into a list."""
    return [parse_region_token(tok) for tok in value.split(",") if tok.strip()]


def positive_int(value):
    try:
        n = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected a positive integer, got {value!r}")
    if n < 1:
        raise argparse.ArgumentTypeError(f"must be >= 1, got {n}")
    return n


def build_parser():
    parser = argparse.ArgumentParser(
        description="Compute a feasible per-Region taskCount/concurrency split "
        "for a DLT scenario within the Fargate vCPU quota.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--target-vus",
        type=positive_int,
        required=True,
        help="Target total virtual users for the scenario.",
    )
    parser.add_argument(
        "--concurrency",
        type=positive_int,
        required=True,
        help="Virtual users each Fargate task should drive (per-task concurrency).",
    )
    parser.add_argument(
        "--vcpus-per-task",
        type=positive_int,
        default=2,
        help="vCPUs each task consumes. DLT tasks are fixed at 2. Default: 2.",
    )
    parser.add_argument(
        "--region",
        dest="regions",
        action="append",
        type=parse_region_token,
        default=[],
        metavar="NAME=AVAILABLE_TASKS",
        help="A Region and its available-task count. Repeatable.",
    )
    parser.add_argument(
        "--regions",
        dest="region_list",
        type=parse_region_list,
        default=None,
        metavar="NAME=AVAIL,NAME=AVAIL",
        help="Comma-separated Regions and available-task counts.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit the plan as JSON instead of a text report.",
    )
    return parser


def merge_regions(from_repeat, from_list):
    """Merge the two region input forms, preserving order, last value wins."""
    merged = []
    index = {}
    for name, avail in list(from_repeat) + list(from_list or []):
        if name in index:
            merged[index[name]] = (name, avail)
        else:
            index[name] = len(merged)
            merged.append((name, avail))
    return merged


def plan_split(target_vus, concurrency, vcpus_per_task, regions):
    """Compute the split. Returns a result dict describing feasibility."""
    tasks_needed = math.ceil(target_vus / concurrency)
    total_available = sum(avail for _, avail in regions)
    max_vus = total_available * concurrency

    # Greedy fill in the order the Regions were given.
    remaining = tasks_needed
    allocations = []
    for name, avail in regions:
        take = min(avail, remaining) if remaining > 0 else 0
        allocations.append(
            {
                "region": name,
                "available_tasks": avail,
                "task_count": take,
                "concurrency": concurrency,
                "virtual_users": take * concurrency,
                "vcpus": take * vcpus_per_task,
            }
        )
        remaining -= take

    feasible = remaining <= 0
    warnings = []
    if concurrency > API_CONCURRENCY_MAX:
        warnings.append(
            f"A concurrency of {concurrency} per task is above the DLT API limit of "
            f"{API_CONCURRENCY_MAX:,}. A Standard mode scenario with this value fails "
            "request validation. In Native mode the script sets its own user count, "
            "so the API does not check it."
        )
    result = {
        "feasible": feasible,
        "target_vus": target_vus,
        "concurrency": concurrency,
        "vcpus_per_task": vcpus_per_task,
        "tasks_needed": tasks_needed,
        "total_available_tasks": total_available,
        "max_vus_at_this_concurrency": max_vus,
        "regions": allocations,
    }

    if feasible:
        used_tasks = sum(a["task_count"] for a in allocations)
        result["allocated_tasks"] = used_tasks
        result["achieved_vus"] = used_tasks * concurrency
        result["total_vcpus"] = used_tasks * vcpus_per_task
    else:
        shortfall_tasks = tasks_needed - total_available
        result["shortfall_tasks"] = shortfall_tasks
        result["shortfall_vcpus"] = shortfall_tasks * vcpus_per_task
        # Minimum per-task concurrency that would make the target fit in the
        # tasks that are available, if that is the lever the user prefers.
        result["min_concurrency_to_fit"] = (
            math.ceil(target_vus / total_available) if total_available > 0 else None
        )
        min_fit = result["min_concurrency_to_fit"]
        if min_fit and min_fit > API_CONCURRENCY_MAX and concurrency <= API_CONCURRENCY_MAX:
            warnings.append(
                f"Raising concurrency to {min_fit} per task would exceed the DLT API "
                f"limit of {API_CONCURRENCY_MAX:,}, so that option does not apply to a "
                "Standard mode scenario. Add capacity or lower the target instead."
            )
    result["warnings"] = warnings
    return result


def format_report(result):
    lines = []
    lines.append("DLT capacity split")
    lines.append("=" * 60)
    lines.append(f"Target virtual users : {result['target_vus']}")
    lines.append(f"Concurrency per task : {result['concurrency']}")
    lines.append(f"vCPUs per task       : {result['vcpus_per_task']}")
    lines.append(f"Tasks needed         : {result['tasks_needed']}")
    lines.append(f"Tasks available      : {result['total_available_tasks']}")
    lines.append(
        f"Max VUs at this concurrency : {result['max_vus_at_this_concurrency']}"
    )
    lines.append("")

    header = f"{'Region':<20}{'avail':>8}{'tasks':>8}{'conc':>8}{'VUs':>10}{'vCPUs':>8}"
    lines.append(header)
    lines.append("-" * len(header))
    for a in result["regions"]:
        lines.append(
            f"{a['region']:<20}{a['available_tasks']:>8}{a['task_count']:>8}"
            f"{a['concurrency']:>8}{a['virtual_users']:>10}{a['vcpus']:>8}"
        )
    lines.append("-" * len(header))

    if result["feasible"]:
        lines.append("")
        lines.append("FEASIBLE")
        lines.append(
            f"Allocated {result['allocated_tasks']} tasks, "
            f"{result['achieved_vus']} virtual users "
            f"(>= target; task count is rounded up), "
            f"{result['total_vcpus']} vCPUs total."
        )
        lines.append(
            "Each Region's task_count is within its available-task count, "
            "the ceiling the DLT API enforces when a run starts on v4.3.2 and later."
        )
    else:
        lines.append("")
        lines.append("INFEASIBLE")
        lines.append(
            f"Short by {result['shortfall_tasks']} tasks "
            f"({result['shortfall_vcpus']} vCPUs) across the Regions listed."
        )
        lines.append("Options to close the gap:")
        if result.get("min_concurrency_to_fit"):
            lines.append(
                f"  1. Raise concurrency per task to at least "
                f"{result['min_concurrency_to_fit']} so the target fits in "
                f"{result['total_available_tasks']} tasks. For JMeter, watch the "
                "3 GB heap in a 4 GiB task: heavier per-task load can run out of heap memory."
            )
        else:
            lines.append(
                "  1. No capacity is available in the listed Regions. Add Regions "
                "or request a quota increase."
            )
        lines.append(
            "  2. Add capacity: request a Fargate vCPU quota increase "
            "(Service Quotas code L-3032A538, ~2 vCPU per added task) and/or "
            "deploy additional regional stacks to spread the load."
        )
        lines.append("  3. Lower the target virtual-user count.")
    if result.get("warnings"):
        lines.append("")
        lines.append("Warnings")
        for warning in result["warnings"]:
            lines.append(f"  - {warning}")
    return "\n".join(lines)


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    regions = merge_regions(args.regions, args.region_list)
    if not regions:
        parser.error(
            "at least one Region is required via --region NAME=AVAIL "
            "or --regions NAME=AVAIL,NAME=AVAIL"
        )

    result = plan_split(
        target_vus=args.target_vus,
        concurrency=args.concurrency,
        vcpus_per_task=args.vcpus_per_task,
        regions=regions,
    )

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(format_report(result))

    return 0 if result["feasible"] else 1


if __name__ == "__main__":
    sys.exit(main())
