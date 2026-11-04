#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Validate a bring-your-own VPC against what a DLT load-generator run requires.

DLT runs its load generators as Fargate tasks with `awsvpc` networking, a public
IP, and a security group the solution creates in the VPC you named at deploy
time. A VPC that is fine for other workloads can still be wrong for DLT, and the
failure is almost never legible: tasks that cannot pull their image or route out
leave the run stuck in `provisioning` until the ECS deployment circuit breaker
trips, with no message naming the network as the cause.

This script checks the requirements that actually break a run, against the live
VPC. Every call it makes is a read: DescribeVpcs, DescribeVpcAttribute,
DescribeSubnets, DescribeRouteTables, DescribeAvailabilityZones, and (only when
you pass one) DescribeSecurityGroups. It never creates, modifies, or deletes
anything.

Requires boto3 and credentials that can describe EC2 resources in the target
Region. Read-only credentials are sufficient and preferred.

Usage:
    validate_vpc.py --region us-west-2 \\
        --vpc-id vpc-0123456789abcdef0 \\
        --subnet-a subnet-0aaa... --subnet-b subnet-0bbb... \\
        [--tasks 200] [--security-group sg-0ccc...] [--profile my-profile]

With --tasks, each subnet must also hold its even share of the tasks, rounded up,
because ECS spreads a service's tasks across its subnets' Availability Zones. A
large total therefore does not make up for one small subnet.

Find the values a deployed Region actually uses in the DLT scenarios table, in
the item whose `testId` is `region-<region>`: its `subnetA`, `subnetB`, and
`taskSecurityGroup` fields are what a run will really use.

Exit codes:
    0  every requirement met (warnings may still be printed)
    1  at least one requirement not met. This includes naming the same subnet
       twice, which is a real misconfiguration rather than a failure to run
    2  the checks could not be completed, so the report is incomplete: a missing
       VPC; boto3 or credentials missing; any describe call that failed for a
       reason other than a missing resource, whether access was denied or the
       request was throttled or failed outright (each is reported as a warning
       naming the check and the error, and is always exit 2 even when nothing
       else failed); or an argparse usage error such as a missing required
       argument or a --tasks value below 1
"""

import argparse
import sys

# boto3 is imported by load_boto3() after the arguments are parsed, so that
# --help works on a machine without boto3.
boto3 = None
BotoCoreError = ClientError = None

# Zone types where AWS Fargate is not offered. A subnet in one of these cannot
# place a DLT task, however healthy the rest of the VPC looks.
FARGATE_UNSUPPORTED_ZONE_TYPES = ("local-zone", "wavelength-zone")

PASS, WARN, FAIL = "PASS", "WARN", "FAIL"

# Error codes that mean the check could not be performed, as opposed to a
# requirement that was measured and found wanting. These map to exit 2, because a
# caller must not read "we were not allowed to look" as "the VPC is fine" or as
# "the VPC is broken". Every other error except a missing resource maps to exit 2
# as well, for the same reason: a throttled call measured nothing.
ACCESS_DENIED_CODES = frozenset({"AccessDenied", "AccessDeniedException", "UnauthorizedOperation", "AuthFailure"})


def error_code(err):
    return err.response.get("Error", {}).get("Code", "")


def error_message(err):
    return err.response.get("Error", {}).get("Message", str(err))


def is_access_denied(err):
    """True when a ClientError is an authorization failure rather than a real finding."""
    return error_code(err) in ACCESS_DENIED_CODES


def is_missing_resource(err):
    """True when EC2 answered that the named VPC, subnet, or group is unknown or malformed.

    That answer is a finding about the configuration, so it fails the check
    rather than leaving it unrun.
    """
    code = error_code(err)
    return code.startswith("Invalid") and code.endswith((".NotFound", ".Malformed"))


def record_error(results, check, err):
    """Record a describe error that kept a check from running."""
    if is_access_denied(err):
        results.add_denied(check, error_message(err))
    else:
        results.add_skipped(check, "{}: {}".format(error_code(err) or "error", error_message(err)))


class Results:
    """Collected check outcomes, rendered at the end."""

    def __init__(self):
        self.rows = []
        # Checks that could not be performed at all, as (check, reason) pairs.
        # Any entry outranks a pass or a failure: the report is incomplete and
        # the caller should know which checks are missing and why.
        self.skipped = []
        self.denied = self.errored = False

    @property
    def incomplete(self):
        return bool(self.skipped)

    def add(self, outcome, check, detail):
        self.rows.append((outcome, check, detail))

    def add_denied(self, check, detail):
        """Record a check that could not run because access was denied."""
        self.denied = True
        self._skip(check, detail)

    def add_skipped(self, check, detail):
        """Record a check that a throttled or otherwise failed call kept from running."""
        self.errored = True
        self._skip(check, detail)

    def _skip(self, check, detail):
        self.skipped.append((check, detail))
        self.rows.append((WARN, check, "could not be checked: {}".format(detail)))

    @property
    def failed(self):
        return any(outcome == FAIL for outcome, _, _ in self.rows)

    def render(self):
        width = max((len(check) for _, check, _ in self.rows), default=0)
        icon = {PASS: "PASS", WARN: "WARN", FAIL: "FAIL"}
        for outcome, check, detail in self.rows:
            print("[{}] {}  {}".format(icon[outcome], check.ljust(width), detail))
        failures = sum(1 for o, _, _ in self.rows if o == FAIL)
        warnings = sum(1 for o, _, _ in self.rows if o == WARN)
        print()
        if failures:
            print(
                "{} requirement(s) not met, {} warning(s). This VPC will not run a DLT test "
                "reliably as configured.".format(failures, warnings)
            )
        elif self.incomplete:
            print("No requirement failed in the checks that ran, but the report is incomplete.")
        elif warnings:
            print("All requirements met, with {} warning(s) worth reading.".format(warnings))
        else:
            print("All requirements met.")
        if self.skipped:
            print("\nThese checks could not run, so this report is incomplete:")
            for check, detail in self.skipped:
                print("  {}: {}".format(check, detail))
            if self.denied:
                print("Re-run with credentials that can describe EC2 resources.")
            if self.errored:
                print("Re-run once the failing calls succeed; a throttled call usually does on a later try.")


def check_vpc(ec2, results, vpc_id):
    """Confirm the VPC exists and has DNS resolution enabled."""
    try:
        vpcs = ec2.describe_vpcs(VpcIds=[vpc_id])["Vpcs"]
    except ClientError as err:
        if is_missing_resource(err):
            results.add(FAIL, "VPC exists", "{}: {}".format(vpc_id, error_message(err)))
        else:
            record_error(results, "VPC exists", err)
        return None
    vpc = vpcs[0]
    results.add(PASS, "VPC exists", "{} ({})".format(vpc_id, vpc.get("CidrBlock", "no CIDR reported")))

    # DLT's own VPC sets both attributes. Without DNS support the tasks cannot
    # resolve ECR, S3, CloudWatch Logs, or a target given by hostname.
    #
    # Note the casing asymmetry: the request takes `enableDnsSupport` but the
    # response keys it as `EnableDnsSupport`, so the two spellings are not
    # interchangeable here.
    for attribute, label in (("enableDnsSupport", "VPC DNS support"), ("enableDnsHostnames", "VPC DNS hostnames")):
        response_key = attribute[0].upper() + attribute[1:]
        try:
            value = ec2.describe_vpc_attribute(VpcId=vpc_id, Attribute=attribute)[response_key]["Value"]
        except ClientError as err:
            record_error(results, label, err)
            continue
        except KeyError as err:
            results.add_skipped(label, "the response has no {} field".format(err))
            continue
        if value:
            results.add(PASS, label, "enabled")
        elif attribute == "enableDnsSupport":
            results.add(
                FAIL,
                label,
                "disabled. Tasks cannot resolve ECR, S3, CloudWatch Logs, or a target named by "
                "hostname. DLT's own VPC enables this.",
            )
        else:
            results.add(
                WARN,
                label,
                "disabled. DLT's own VPC enables it; leave it on unless you know the tasks need "
                "no public DNS names.",
            )
    return vpc


def resolve_route_table(ec2, vpc_id, subnet_id):
    """Return the route table governing a subnet: its explicit one, else the VPC main table.

    Returns `(route_table, how, error)`, where `error` is the ClientError that
    kept the lookup from running. An error has to be signalled distinctly from
    "no table found": the caller treats a missing table as a routing FAIL, and
    reporting "we could not look" as a routing failure would be a false verdict
    of exactly the kind this script must not produce.
    """
    try:
        explicit = ec2.describe_route_tables(Filters=[{"Name": "association.subnet-id", "Values": [subnet_id]}])
        if explicit["RouteTables"]:
            return explicit["RouteTables"][0], "explicitly associated", None
        main = ec2.describe_route_tables(
            Filters=[
                {"Name": "vpc-id", "Values": [vpc_id]},
                {"Name": "association.main", "Values": ["true"]},
            ]
        )
        if main["RouteTables"]:
            return main["RouteTables"][0], "VPC main route table", None
    except ClientError as err:
        return None, "not readable", err
    return None, "none found", None


def has_internet_gateway_default_route(route_table):
    """True when the table sends 0.0.0.0/0 to an internet gateway."""
    for route in route_table.get("Routes", []):
        if route.get("DestinationCidrBlock") != "0.0.0.0/0":
            continue
        target = route.get("GatewayId") or ""
        if target.startswith("igw-") and route.get("State", "active") == "active":
            return True, target
    return False, None


def describe_default_route(route_table):
    """Human-readable summary of whatever the default route points at."""
    for route in route_table.get("Routes", []):
        if route.get("DestinationCidrBlock") != "0.0.0.0/0":
            continue
        for key in ("GatewayId", "NatGatewayId", "TransitGatewayId", "VpcPeeringConnectionId", "NetworkInterfaceId"):
            if route.get(key):
                return "{}={}".format(key, route[key])
        return "present but with no recognized target"
    return "no 0.0.0.0/0 route at all"


def check_subnets(ec2, results, vpc_id, subnet_ids, tasks_per_region):
    """Check subnet membership, routing, zone type, AZ spread, and free addresses."""
    # One call per subnet on purpose. A batched describe_subnets fails the whole
    # request with InvalidSubnetID.NotFound when ANY id is unknown, which would
    # report both ids as suspect when only one is wrong. Describing them
    # individually names the subnet that is actually missing.
    by_id = {}
    for subnet_id in subnet_ids:
        try:
            by_id[subnet_id] = ec2.describe_subnets(SubnetIds=[subnet_id])["Subnets"][0]
        except ClientError as err:
            if is_missing_resource(err):
                results.add(FAIL, "Subnet {} exists".format(subnet_id), error_message(err))
            else:
                record_error(results, "Subnet {} exists".format(subnet_id), err)
        except IndexError:
            results.add(FAIL, "Subnet {} exists".format(subnet_id), "not found")

    zone_types = {}
    try:
        for zone in ec2.describe_availability_zones(AllAvailabilityZones=True)["AvailabilityZones"]:
            zone_types[zone["ZoneName"]] = zone.get("ZoneType", "availability-zone")
    except ClientError as err:
        # Same contract as every other describe here: an error is not a pass.
        # Without zone types the Fargate zone check degrades to "unknown", so
        # swallowing a denial or a throttle would let an unchecked report exit 0.
        record_error(results, "Availability Zone types", err)

    azs = {}
    free_total = 0
    # ECS spreads a service's tasks across its subnets' Availability Zones, so
    # each subnet must hold its even share, rounded up, not only the pair.
    share = -(-tasks_per_region // len(subnet_ids)) if tasks_per_region else None
    for subnet_id in subnet_ids:
        subnet = by_id.get(subnet_id)
        if subnet is None:
            # Already reported by the describe loop above; skip the rest of the
            # checks for this subnet rather than reporting it twice.
            continue

        # 1. Membership. The task security group lives in the VPC above, and ECS
        #    rejects a CreateService whose subnets and security group disagree.
        if subnet["VpcId"] != vpc_id:
            results.add(
                FAIL,
                "Subnet {} in VPC".format(subnet_id),
                "belongs to {}, not {}. ECS rejects a service whose subnets and security group "
                "are in different VPCs.".format(subnet["VpcId"], vpc_id),
            )
            continue
        results.add(PASS, "Subnet {} in VPC".format(subnet_id), "yes")

        # 2. Egress. DLT always requests a public IP. The tested path out is an
        #    internet gateway; a NAT or transit gateway default route is
        #    unverified, so it is reported as a warning below.
        route_table, how, error = resolve_route_table(ec2, vpc_id, subnet_id)
        if error is not None:
            # Marks the report incomplete and forces exit 2, and the remaining
            # checks for this subnet and the others still run.
            record_error(results, "Subnet {} routing".format(subnet_id), error)
        elif route_table is None:
            results.add(FAIL, "Subnet {} routing".format(subnet_id), "no route table governs this subnet")
        else:
            ok, igw = has_internet_gateway_default_route(route_table)
            default_route = describe_default_route(route_table)
            if ok:
                results.add(
                    PASS, "Subnet {} routing".format(subnet_id), "0.0.0.0/0 to {} ({})".format(igw, how)
                )
            elif default_route == "no 0.0.0.0/0 route at all":
                results.add(
                    FAIL,
                    "Subnet {} routing".format(subnet_id),
                    "no 0.0.0.0/0 route at all ({}). The task cannot reach ECR, so it never starts "
                    "and the run sits in provisioning.".format(how),
                )
            else:
                # A NAT or transit-gateway default route is not proven broken, but it
                # is not the shape the solution ships or tests, and assignPublicIp
                # cannot be turned off. Report it as unverified rather than failed.
                results.add(
                    WARN,
                    "Subnet {} routing".format(subnet_id),
                    "default route is not an internet gateway ({}): {}. The solution's own VPC uses "
                    "an internet gateway and DLT assigns every task a public IP with no way to "
                    "disable it, so this is not the tested shape. Verify the tasks can actually "
                    "reach ECR, S3, and CloudWatch Logs on this path before relying on it: see "
                    "Check 4 and references/egress-path-matrix.md.".format(how, default_route),
                )

        # 3. Zone type. Fargate is not offered in Local Zones or Wavelength Zones.
        az = subnet["AvailabilityZone"]
        azs.setdefault(az, []).append(subnet_id)
        zone_type = zone_types.get(az)
        if zone_type in FARGATE_UNSUPPORTED_ZONE_TYPES:
            results.add(
                FAIL,
                "Subnet {} zone".format(subnet_id),
                "{} is a {}, where AWS Fargate is not offered, so no task can be placed.".format(az, zone_type),
            )
        elif subnet.get("OutpostArn"):
            results.add(
                FAIL,
                "Subnet {} zone".format(subnet_id),
                "is an Outpost subnet; AWS Fargate is not available on Outposts.",
            )
        elif zone_type:
            results.add(PASS, "Subnet {} zone".format(subnet_id), "{} ({})".format(az, zone_type))
        else:
            results.add(WARN, "Subnet {} zone".format(subnet_id), "{}, zone type unknown".format(az))

        free = subnet.get("AvailableIpAddressCount", 0)
        free_total += free
        if share is None:
            results.add(PASS, "Subnet {} free IPs".format(subnet_id), "{} available".format(free))
        elif free >= share:
            results.add(
                PASS,
                "Subnet {} free IPs".format(subnet_id),
                "{} available, enough for its share of {} task(s)".format(free, share),
            )
        else:
            results.add(
                FAIL,
                "Subnet {} free IPs".format(subnet_id),
                "only {} available for its share of {} task(s). ECS spreads the tasks across the "
                "subnets' zones, so do not count on the other subnet to absorb the rest; a task "
                "placed here without an address fails with InsufficientFreeAddressesInSubnet.".format(free, share),
            )

    # 4. AZ spread. Permitted, but worth saying out loud: DLT creates the service
    #    with availability-zone rebalancing disabled, so it will not spread for you.
    #    Only meaningful once every subnet was actually evaluated: a subnet that
    #    failed the membership check never recorded a zone, so reporting spread
    #    across the survivors would misstate what the customer configured.
    evaluated = sum(len(ids) for ids in azs.values())
    if evaluated < len(subnet_ids):
        results.add(
            WARN,
            "Availability Zone spread",
            "not assessed: only {} of {} subnets could be evaluated.".format(evaluated, len(subnet_ids)),
        )
    elif len(azs) == 1 and len(subnet_ids) > 1:
        results.add(
            WARN,
            "Availability Zone spread",
            "both subnets are in {}. DLT's own VPC uses two zones, and the service is created with "
            "availability-zone rebalancing disabled, so a single-zone pair concentrates every task "
            "and every ENI in one zone.".format(next(iter(azs))),
        )
    elif len(azs) > 1:
        results.add(PASS, "Availability Zone spread", "{} zones: {}".format(len(azs), ", ".join(sorted(azs))))

    # 5. Address capacity for the requested task count. One task is one ENI is
    #    one private IP.
    if tasks_per_region is not None:
        # Same partial-evaluation guard as the AZ spread above. A subnet that
        # failed membership, its describe, or an access check never added its
        # free count, so asserting a shortfall here would stack a second,
        # spurious failure on top of the real one.
        if evaluated < len(subnet_ids):
            results.add(
                WARN,
                "IP capacity for {} task(s)".format(tasks_per_region),
                "not assessed: only {} of {} subnets could be evaluated, so the {} free addresses "
                "counted are not the whole picture.".format(evaluated, len(subnet_ids), free_total),
            )
        elif free_total >= tasks_per_region:
            results.add(
                PASS,
                "IP capacity for {} task(s)".format(tasks_per_region),
                "{} free across the subnets".format(free_total),
            )
        else:
            results.add(
                FAIL,
                "IP capacity for {} task(s)".format(tasks_per_region),
                "only {} free across the subnets. Each task consumes one private IP; ECS retries "
                "until the circuit breaker trips.".format(free_total),
            )


def check_security_group(ec2, results, vpc_id, security_group_id):
    """Confirm the task security group is in the VPC and report its egress."""
    try:
        groups = ec2.describe_security_groups(GroupIds=[security_group_id])["SecurityGroups"]
    except ClientError as err:
        if is_missing_resource(err):
            results.add(FAIL, "Security group", "{}: {}".format(security_group_id, error_message(err)))
        else:
            record_error(results, "Security group", err)
        return
    group = groups[0]
    if group["VpcId"] != vpc_id:
        results.add(
            FAIL,
            "Security group VPC",
            "{} is in {}, not {}. ECS rejects a service whose security group and subnets "
            "disagree.".format(security_group_id, group["VpcId"], vpc_id),
        )
        return
    results.add(PASS, "Security group VPC", "{} is in {}".format(security_group_id, vpc_id))

    # Egress can be granted four ways, and only the first is a plain CIDR. A group
    # that permits traffic through a managed prefix list (the S3 or DynamoDB
    # gateway lists are common) or over IPv6 is legitimately open, so treating
    # "no IPv4 CidrIp" as a failure would wrongly tell a customer their VPC
    # cannot run.
    cidrs, ipv6, prefix_lists, group_pairs = [], [], [], []
    for permission in group.get("IpPermissionsEgress", []):
        cidrs.extend(rng["CidrIp"] for rng in permission.get("IpRanges", []) if "CidrIp" in rng)
        ipv6.extend(rng["CidrIpv6"] for rng in permission.get("Ipv6Ranges", []) if "CidrIpv6" in rng)
        prefix_lists.extend(pl["PrefixListId"] for pl in permission.get("PrefixListIds", []) if "PrefixListId" in pl)
        group_pairs.extend(pair["GroupId"] for pair in permission.get("UserIdGroupPairs", []) if "GroupId" in pair)

    # A permission's protocol and ports matter as much as its target. A rule like
    # tcp:443 to 0.0.0.0/0 looks wide open by target while still blocking DNS on
    # UDP 53 and any target on another port, so only an all-traffic ("-1")
    # permission to 0.0.0.0/0 is a genuine pass.
    open_all_traffic = any(
        permission.get("IpProtocol") == "-1"
        and any(rng.get("CidrIp") == "0.0.0.0/0" for rng in permission.get("IpRanges", []))
        for permission in group.get("IpPermissionsEgress", [])
    )
    if open_all_traffic:
        results.add(PASS, "Security group egress", "allows all traffic to 0.0.0.0/0")
        return

    grants = []
    if cidrs:
        grants.append("IPv4 {}".format(", ".join(cidrs)))
    if ipv6:
        grants.append("IPv6 {}".format(", ".join(ipv6)))
    if prefix_lists:
        grants.append("prefix list(s) {}".format(", ".join(prefix_lists)))
    if group_pairs:
        grants.append("security group(s) {}".format(", ".join(group_pairs)))

    if grants:
        results.add(
            WARN,
            "Security group egress",
            "restricted by protocol, port, or target: {}. Note that an open 0.0.0.0/0 on a "
            "port-restricted rule still blocks other ports, and this script cannot resolve what a "
            "prefix list or a peer security group covers, so confirm by hand that every destination "
            "a task needs is reachable: ECR and S3 and CloudWatch Logs on 443, DNS on 53, the "
            "framework download if any, and your target on its own port.".format("; ".join(grants)),
        )
    else:
        results.add(
            FAIL,
            "Security group egress",
            "no egress rule of any kind found: no CIDR, no IPv6 range, no prefix list, and no peer "
            "security group. Tasks cannot reach ECR, so they cannot start.",
        )


def load_boto3():
    """Import boto3 and the botocore exceptions into the module namespace.

    Returns False when boto3 is missing, which is an environment problem rather
    than a check failure.
    """
    global boto3, BotoCoreError, ClientError
    try:
        import boto3
        from botocore.exceptions import BotoCoreError, ClientError
    except ImportError:
        print("This script needs boto3. Install it, or run the checks by hand with the AWS CLI.", file=sys.stderr)
        return False
    return True


def positive_int(value):
    """argparse type for --tasks: a whole number of at least 1."""
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("must be a whole number, got {!r}".format(value))
    if number < 1:
        raise argparse.ArgumentTypeError("must be at least 1, got {}".format(number))
    return number


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Validate a bring-your-own VPC against DLT load-generator requirements (read-only)."
    )
    parser.add_argument("--region", required=True, help="AWS Region the VPC lives in")
    parser.add_argument("--vpc-id", required=True, help="VPC id passed as ExistingVPCId")
    parser.add_argument("--subnet-a", required=True, help="Subnet id passed as ExistingSubnetA")
    parser.add_argument("--subnet-b", required=True, help="Subnet id passed as ExistingSubnetB")
    parser.add_argument(
        "--tasks",
        type=positive_int,
        default=None,
        help="Tasks this Region will run, to check free IP addresses against",
    )
    parser.add_argument(
        "--security-group",
        default=None,
        help="Task security group id (the region config's taskSecurityGroup), to check its VPC and egress",
    )
    parser.add_argument("--profile", default=None, help="AWS profile to use")
    args = parser.parse_args(argv)
    if not load_boto3():
        return 2

    # Exit 1, not 2: naming one subnet twice is a misconfiguration of the kind this
    # script exists to catch, not an inability to run the checks.
    if args.subnet_a == args.subnet_b:
        print(
            "FAIL  ExistingSubnetA and ExistingSubnetB are the same subnet ({}). DLT expects two "
            "subnets and its own VPC places them in different Availability Zones.".format(args.subnet_a),
            file=sys.stderr,
        )
        return 1

    try:
        session = boto3.Session(profile_name=args.profile) if args.profile else boto3.Session()
        ec2 = session.client("ec2", region_name=args.region)
    except (BotoCoreError, ClientError) as err:
        print("Could not create an EC2 client: {}".format(err), file=sys.stderr)
        return 2

    results = Results()
    try:
        if check_vpc(ec2, results, args.vpc_id) is None:
            results.render()
            return 2
        check_subnets(ec2, results, args.vpc_id, [args.subnet_a, args.subnet_b], args.tasks)
        if args.security_group:
            check_security_group(ec2, results, args.vpc_id, args.security_group)
    except (BotoCoreError, ClientError) as err:
        # A call outside the per-check handling, such as one with no credentials
        # or no network, stops the run. Report it as the checks it left unrun.
        results.add_skipped("Remaining checks", str(err))

    results.render()
    if results.incomplete:
        return 2
    return 1 if results.failed else 0


if __name__ == "__main__":
    sys.exit(main())
