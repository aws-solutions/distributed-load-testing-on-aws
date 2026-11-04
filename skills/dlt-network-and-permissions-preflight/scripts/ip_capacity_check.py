#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Subnet IP capacity check for Distributed Load Testing on AWS (DLT).

Each Fargate load-generator task runs with awsvpc networking, so it attaches one
elastic network interface and consumes one private IP from a DLT subnet. A test
that requests more tasks in a Region than the Region's DLT subnets have free IPs
cannot place all of its tasks. ECS keeps retrying, the deployment circuit breaker
eventually trips, and the run surfaces as a stuck "provisioning" state or a
"Service failed to stabilize within 30 minutes" failure.

This calculator compares the tasks a run requests per Region against the free IPs
in that Region's DLT subnets and reports whether capacity is sufficient, how much
headroom is left, and an estimate of how long the Fargate task-launch throttle
will take to place the fleet.

The model this follows:
  - One task consumes one private IP. The public IP that DLT assigns
    (assignPublicIp is ENABLED) comes from an Amazon-managed pool and does not
    draw from the subnet, so required private IPs equals the task count.
  - A subnet's usable host count is 2^(32 - prefix) minus the 5 addresses AWS
    reserves in every subnet (network, VPC router, DNS, a future-use address,
    and broadcast).
  - DLT spreads a Region's tasks across its two subnets (subnet A and subnet B),
    so a Region's capacity is the sum of the free IPs across those subnets.
  - Other consumers in a shared subnet (other ENIs, other services) reduce the
    free IPs. Pass their footprint through --reserve, or supply an already
    netted free-IP integer instead of a CIDR.

Standard library only. No third-party dependencies. No boto3, no AWS calls.

Examples:
  # Two default /20 subnets, requesting 200 tasks in one Region.
  python3 ip_capacity_check.py --region us-east-1=200:192.168.0.0/20+192.168.16.0/20

  # Bring-your-own /24 subnets, holding back 16 IPs for other consumers.
  python3 ip_capacity_check.py \\
      --region us-east-1=150:10.0.1.0/24+10.0.2.0/24 --reserve 16

  # Supply observed free-IP counts directly (already net of other consumers).
  python3 ip_capacity_check.py --region eu-west-1=300:220+220 --json
"""

import argparse
import json
import math
import re
import sys

# AWS reserves 5 IP addresses in every subnet and they cannot be assigned to a
# task ENI. See the Amazon VPC subnet sizing documentation.
RESERVED_PER_SUBNET = 5

# Fargate throttles the rate at which it launches tasks with a token bucket.
# The values below are the commonly documented defaults and are approximate;
# override them with --launch-burst and --launch-rate if AWS has told you the
# account's actual limits. A large fan-out does not fail because of the throttle,
# it just takes longer to reach the desired count.
DEFAULT_LAUNCH_BURST = 100
DEFAULT_LAUNCH_RATE = 20

_CIDR_RE = re.compile(r"^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/(\d{1,2})$")


def usable_ips_for_cidr(cidr):
    """Return the assignable host count for an IPv4 CIDR, net of AWS reserves."""
    match = _CIDR_RE.match(cidr)
    if not match:
        raise argparse.ArgumentTypeError(
            f"not a valid IPv4 CIDR: {cidr!r} (expected x.x.x.x/n)"
        )
    octets = [int(match.group(i)) for i in range(1, 5)]
    prefix = int(match.group(5))
    for octet in octets:
        if octet > 255:
            raise argparse.ArgumentTypeError(f"octet out of range in {cidr!r}")
    if prefix > 32:
        raise argparse.ArgumentTypeError(f"prefix out of range in {cidr!r}")
    total = 2 ** (32 - prefix)
    return max(0, total - RESERVED_PER_SUBNET)


def parse_capacity(spec):
    """Parse a '+'-joined capacity spec into (total_free, [parts]).

    Each part is either an IPv4 CIDR (usable host count derived, net of the 5
    reserved addresses) or a plain integer (observed free IPs, used as-is).
    """
    parts = []
    total = 0
    for raw in spec.split("+"):
        token = raw.strip()
        if not token:
            continue
        if _CIDR_RE.match(token):
            free = usable_ips_for_cidr(token)
            parts.append({"kind": "cidr", "value": token, "free_ips": free})
        else:
            try:
                free = int(token)
            except ValueError:
                raise argparse.ArgumentTypeError(
                    f"capacity part must be a CIDR or an integer, got {token!r}"
                )
            if free < 0:
                raise argparse.ArgumentTypeError(
                    f"free-IP count must be >= 0, got {free}"
                )
            parts.append({"kind": "free", "value": token, "free_ips": free})
        total += free
    if not parts:
        raise argparse.ArgumentTypeError(f"empty capacity spec: {spec!r}")
    return total, parts


def parse_region_token(token):
    """Parse 'NAME=TASKS:CAP[+CAP...]' into a region dict."""
    token = token.strip()
    if "=" not in token:
        raise argparse.ArgumentTypeError(
            f"region must be NAME=TASKS:CAPACITY, got: {token!r}"
        )
    name, _, rest = token.partition("=")
    name = name.strip()
    if not name:
        raise argparse.ArgumentTypeError(f"region name is empty in {token!r}")
    if ":" not in rest:
        raise argparse.ArgumentTypeError(
            f"region {name!r} must be TASKS:CAPACITY (e.g. 200:10.0.1.0/24+10.0.2.0/24)"
        )
    tasks_str, _, cap_str = rest.partition(":")
    tasks_str = tasks_str.strip()
    try:
        tasks = int(tasks_str)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"requested tasks for {name!r} must be an integer, got {tasks_str!r}"
        )
    if tasks < 1:
        raise argparse.ArgumentTypeError(
            f"requested tasks for {name!r} must be >= 1, got {tasks}"
        )
    total_free, parts = parse_capacity(cap_str)
    return {"region": name, "requested_tasks": tasks, "free_ips": total_free, "subnets": parts}


def parse_region_list(value):
    return [parse_region_token(tok) for tok in value.split(",") if tok.strip()]


def non_negative_int(value):
    try:
        n = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected an integer, got {value!r}")
    if n < 0:
        raise argparse.ArgumentTypeError(f"must be >= 0, got {n}")
    return n


def positive_int(value):
    n = non_negative_int(value)
    if n < 1:
        raise argparse.ArgumentTypeError(f"must be >= 1, got {n}")
    return n


def build_parser():
    parser = argparse.ArgumentParser(
        description="Check DLT subnet IP capacity against the tasks a run "
        "requests per Region.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--region",
        dest="regions",
        action="append",
        type=parse_region_token,
        default=[],
        metavar="NAME=TASKS:CAP[+CAP]",
        help="A Region, the tasks it requests, and its subnet capacity. "
        "CAP is a '+'-joined list of CIDRs or free-IP integers. Repeatable.",
    )
    parser.add_argument(
        "--regions",
        dest="region_list",
        type=parse_region_list,
        default=None,
        metavar="NAME=TASKS:CAP,NAME=TASKS:CAP",
        help="Comma-separated list of the same NAME=TASKS:CAP form.",
    )
    parser.add_argument(
        "--reserve",
        type=non_negative_int,
        default=0,
        help="IPs to hold back per Region for other consumers and ENI churn. "
        "Applied to every Region. Default: 0.",
    )
    parser.add_argument(
        "--launch-burst",
        type=positive_int,
        default=DEFAULT_LAUNCH_BURST,
        help=f"Fargate task-launch burst budget. Default: {DEFAULT_LAUNCH_BURST}.",
    )
    parser.add_argument(
        "--launch-rate",
        type=positive_int,
        default=DEFAULT_LAUNCH_RATE,
        help=f"Fargate sustained task-launch rate per second. "
        f"Default: {DEFAULT_LAUNCH_RATE}.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit the result as JSON instead of a text report.",
    )
    return parser


def merge_regions(from_repeat, from_list):
    """Merge the two input forms, preserving order, last value wins per name."""
    merged = []
    index = {}
    for region in list(from_repeat) + list(from_list or []):
        name = region["region"]
        if name in index:
            merged[index[name]] = region
        else:
            index[name] = len(merged)
            merged.append(region)
    return merged


def estimate_launch_seconds(tasks, burst, rate):
    """Approximate seconds for the Fargate throttle to place `tasks` tasks."""
    return math.ceil(max(0, tasks - burst) / rate)


def evaluate(regions, reserve, burst, rate):
    evaluated = []
    all_sufficient = True
    for region in regions:
        available = region["free_ips"] - reserve
        required = region["requested_tasks"]
        headroom = available - required
        sufficient = headroom >= 0
        if not sufficient:
            all_sufficient = False
        evaluated.append(
            {
                "region": region["region"],
                "requested_tasks": required,
                "free_ips": region["free_ips"],
                "reserve": reserve,
                "available_ips": available,
                "headroom": headroom,
                "sufficient": sufficient,
                "shortfall_ips": max(0, -headroom),
                "estimated_launch_seconds": estimate_launch_seconds(required, burst, rate),
                "subnets": region["subnets"],
            }
        )
    return {
        "all_sufficient": all_sufficient,
        "reserve_per_region": reserve,
        "launch_burst": burst,
        "launch_rate_per_second": rate,
        "regions": evaluated,
    }


def format_report(result):
    lines = []
    lines.append("DLT subnet IP capacity check")
    lines.append("=" * 66)
    lines.append("One task consumes one private IP (one ENI). The assigned public IP")
    lines.append("comes from an Amazon pool and does not draw from the subnet.")
    lines.append(f"Reserve held back per Region : {result['reserve_per_region']} IPs")
    lines.append(
        f"Fargate launch throttle      : burst {result['launch_burst']}, "
        f"then ~{result['launch_rate_per_second']}/sec (approximate)"
    )
    lines.append("")

    header = (
        f"{'Region':<18}{'tasks':>7}{'freeIP':>9}{'avail':>8}"
        f"{'headroom':>10}{'launch~s':>10}  status"
    )
    lines.append(header)
    lines.append("-" * len(header))
    for r in result["regions"]:
        status = "OK" if r["sufficient"] else "SHORT"
        lines.append(
            f"{r['region']:<18}{r['requested_tasks']:>7}{r['free_ips']:>9}"
            f"{r['available_ips']:>8}{r['headroom']:>10}"
            f"{r['estimated_launch_seconds']:>10}  {status}"
        )
    lines.append("-" * len(header))
    lines.append("")

    if result["all_sufficient"]:
        lines.append("SUFFICIENT")
        lines.append(
            "Every Region has enough free IPs for its requested tasks. Remember "
            "the Fargate vCPU quota is a separate ceiling: confirm it too with "
            "dlt-capacity-and-region-planning."
        )
    else:
        lines.append("INSUFFICIENT")
        for r in result["regions"]:
            if not r["sufficient"]:
                lines.append(
                    f"  {r['region']}: short by {r['shortfall_ips']} IPs "
                    f"({r['requested_tasks']} tasks requested, "
                    f"{r['available_ips']} usable after reserve)."
                )
        lines.append("Options to close the gap:")
        lines.append(
            "  1. Use larger DLT subnets: redeploy the stack with wider "
            "SubnetACidrBlock and SubnetBCidrBlock, or point ExistingSubnetA and "
            "ExistingSubnetB at subnets with more free space."
        )
        lines.append(
            "  2. Lower the per-Region task count and spread load across more "
            "Regions (see dlt-capacity-and-region-planning)."
        )
        lines.append(
            "  3. Free IPs in the subnet by removing other consumers, or move "
            "DLT to a dedicated VPC and subnets."
        )
    return "\n".join(lines)


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    regions = merge_regions(args.regions, args.region_list)
    if not regions:
        parser.error(
            "at least one Region is required via --region NAME=TASKS:CAP "
            "or --regions NAME=TASKS:CAP,NAME=TASKS:CAP"
        )

    result = evaluate(regions, args.reserve, args.launch_burst, args.launch_rate)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(format_report(result))

    return 0 if result["all_sufficient"] else 1


if __name__ == "__main__":
    sys.exit(main())
