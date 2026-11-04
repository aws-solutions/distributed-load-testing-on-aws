#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Enumerate and, on request, delete the resources a Distributed Load Testing on
AWS (DLT) stack retains when it is deleted.

DLT declares RemovalPolicy.RETAIN on its S3 buckets and relies on the CDK default
of RETAIN for its DynamoDB tables and CloudWatch log groups. Lambda functions with no
declared log group also leave behind the group the Lambda service created for them.
A plain stack delete therefore leaves those resources orphaned in the account, where
they keep billing and keep holding data. This tool finds them by exact physical ID
in the deleted stack's own resource list, labels each one with the stack ID of the
deployment that created it, and, when you pass --delete, empties and removes them.

Safety model:
  - The default is a dry run. Without --delete, the tool only lists what it would
    remove.
  - --delete needs --stack-name, and it deletes only resources matched by exact
    ID. Matches by name, under --prefix or for a stack whose record has aged out
    of ListStacks, are listed as possible leftovers and never deleted.
  - When more than one deleted generation exists, the plan covers each one and
    labels every item with its generation's stack ID. Pass --stack-id to act on
    one generation at a time.
  - A resource it cannot read is skipped and listed in the plan with the error code.
    Under --delete, an item that matched by exact ID but could not be read may
    remain, so the run exits 5.
  - Before it plans an exact-ID item, it asks CloudFormation which stack claims the
    physical ID (DescribeStackResources) and reads the item's
    aws:cloudformation:stack-id tag where the service has one. An item that a live
    stack other than its own generation now claims, for example after an import
    into another stack, is skipped as "now owned by stack <name>".
  - --delete always needs --plan, on a terminal or not, and the run refuses with
    exit code 2 otherwise. Write the plan on the dry run with --plan-out and pass
    that reviewed file to --delete with --plan. The delete then acts only on the
    plan's items that still exist and still match by exact ID, reports the rest,
    and refuses when the plan's account ID, Region, stack name, or dashboards mode
    differs from the run's. --plan-out creates a new file with mode 0600, and it
    refuses a path that already exists, a symlink included.
  - On a terminal, --delete asks for typed confirmation unless you pass --yes,
    and off a terminal it refuses without --yes. The terminal check is
    best-effort, because an agent client that runs commands in a pseudo-terminal
    passes it, so the reviewed plan file is the real gate. By default the user
    runs the --delete --plan command in their own terminal and types the
    confirmation. An agent runs it, with --yes, only when the user explicitly asks
    it to and has approved that plan.
  - While the stack of --stack-name is live, the plan previews what its delete will
    leave, and nothing in the preview is ever deleted.
  - The tool empties a versioned bucket of every version and every delete marker
    before it deletes the bucket, which is the only way a versioned bucket will
    delete.

What it handles:
  - S3 buckets: it counts versions and delete markers, then purges and deletes
    each bucket. It deletes the logs bucket last, because the other buckets write
    their server access logs to it. It holds the logs bucket, and reports it as
    held, while any other retained bucket of its generation still exists
    (HeadBucket) and logs to it or has a logging setting it cannot read
    (GetBucketLogging), whether that bucket failed to delete, was skipped, or was
    left out of the plan. Late access logs can still arrive, so on BucketNotEmpty
    it waits briefly and purges and deletes the logs bucket once more.
  - DynamoDB tables: Scenarios, History, AgentSpaces, and Investigations.
  - CloudWatch log groups: the stack's retained groups (for example
    DLTCloudWatchLogsGroup, the API access logs, the Cognito activity logs, and the
    state machine's group) and /aws/lambda/<function name> for each of the stack's
    functions. Deleting a log group removes its per-test metric filters with it.
  - CloudWatch dashboards: it matches the leftover per-test
    EcsLoadTesting-<testId>-<region> dashboards, which only Standard mode runs
    create. Their names carry no stack name, so by default (--dashboards stack) it
    takes only the dashboards whose test ID appears in the stack's retained
    Scenarios table in this Region, and it leaves every other dashboard alone,
    including those of another live DLT stack in the Region. A spoke Region has no
    Scenarios table, so there nothing is attributed. --dashboards all takes every
    EcsLoadTesting- dashboard in the Region, for confirmed orphans only, and it is
    refused while a live stack of this name exists whose dashboards cannot be
    attributed. --dashboards skip (or --skip-dashboards) takes none. Dashboards
    are deleted before the tables, and when a dashboard delete fails, the tool
    holds its generation's Scenarios table, which attributes it, so a rerun of the
    same plan still finds the dashboard. A plan only narrows what the run finds,
    and never adds an item back.
  - Container Insights log groups: /aws/ecs/containerinsights/<cluster>/performance
    for each of the stack's ECS clusters (the load-test cluster and the ALB with
    ECS web console cluster). It skips a group whose cluster ECS still reports as
    active, and a group created outside the lifetime of every deleted generation.
  - The API Gateway CloudWatch IAM role: CDK creates it for the DLT REST API and
    the stack retains it. The tool takes the retained role only when its trust
    policy names apigateway.amazonaws.com alone and its only policy is
    AmazonAPIGatewayPushToCloudWatchLogs, and it lists a role of any other shape
    for review. The tool skips, and reports, a role that
    this Region's API Gateway account setting (cloudwatchRoleArn) still names,
    because deleting that role stops API Gateway logging in the Region. IAM is
    global, so it also skips a role that IAM reports as last used after the
    generation's DeletionTime, and a role whose aws:cloudformation:stack-id tag
    names a stack in another Region, because it checks owners only in --region.
  - ECR repositories: the ALB with ECS web console's pull through cache creates
    repositories under dlt-<last group of the stack ID's UUID>/ on first pull,
    and the stack delete leaves them. A repository must also have been created
    during the generation's lifetime.
  - KMS: it runs a defensive, report-only check. DLT creates no customer-managed
    keys, so this check normally finds none. It lists any customer-managed key
    whose alias or tag value contains the stack name under a "not deleted; review
    by hand" heading, and it never deletes a key or schedules a key's deletion,
    with or without --delete.

Log groups, dashboards, and KMS keys are Region-scoped, so run this once per
Region: the hub Region and each spoke (regional stack) Region. In a spoke Region,
pass the regional stack's own name, because its resources are named from it.

How the tool proves ownership:
  - Each DELETE_COMPLETE record of the stack name in this Region's ListStacks is
    one deleted generation. For each, the tool reads ListStackResources by stack
    ID, which CloudFormation answers for 90 days after the delete. A retained row
    has the status DELETE_SKIPPED and its physical ID. Buckets, tables, log groups,
    and the IAM role come from those rows, and any other retained row is listed
    for review. Lambda and Container Insights groups come from the exact names of
    the stack's functions and clusters, and ECR repositories from its stack ID.
  - A retained resource that a stack update replaced or removed drops out of
    ListStackResources, so the tool also reads each generation's DescribeStackEvents
    history and adds every DELETE_SKIPPED physical ID that the resource list lacks.
    The plan labels these "replaced or removed during an update".
  - Before the stack delete, a live stack has no deleted generation to match. The
    tool then reads the live stack's template (GetTemplate; DLT templates are
    JSON) and resource list, and it previews the resources whose DeletionPolicy is
    Retain or RetainExceptOnCreate, with the Lambda and Container Insights log
    groups, ECR repositories, and per-test dashboards derived from the stack. Run
    the tool again after the stack delete to plan their removal.
  - No name prefix or name shape selects anything for deletion, so a stack whose
    name shares a prefix or a truncated stack part keeps its resources. A live
    stack of the same name does not block the run: the tool leaves out every
    resource that the live stack lists or derives from its own rows.
  - After 90 days nothing matches by exact ID, so the tool lists possible
    leftovers by name shape, for review only, as it does under --prefix.

Permissions: besides each resource type's list, read, and delete permissions, the
tool calls sts:GetCallerIdentity, cloudformation:DescribeStacks,
cloudformation:ListStacks, cloudformation:ListStackResources,
cloudformation:DescribeStackEvents, cloudformation:DescribeStackResources,
cloudformation:GetTemplate, s3:ListBucket (for HeadBucket), s3:GetBucketTagging,
s3:GetBucketLogging (under --delete), dynamodb:ListTagsOfResource,
logs:ListTagsForResource, iam:GetRole, iam:ListAttachedRolePolicies,
iam:ListRolePolicies, apigateway:GET on /account, ecs:DescribeClusters, and
ecr:DescribeRepositories.

Examples:
  # Dry run: list what would be removed for the default CloudFront-mode stack.
  python3 cleanup_retained.py --stack-name distributed-load-testing-on-aws --region us-east-1

  # After the stack delete, write the plan for review, then, in your own terminal,
  # delete only what the reviewed plan lists and type the confirmation.
  python3 cleanup_retained.py --stack-name distributed-load-testing-on-aws --region us-east-1 --plan-out plan.json
  python3 cleanup_retained.py --stack-name distributed-load-testing-on-aws --region us-east-1 --delete --plan plan.json

  # Plan one of several deleted generations, by its stack ID or the ID's UUID.
  python3 cleanup_retained.py --stack-name distributed-load-testing-on-aws --region us-east-1 --stack-id <uuid>

  # Report only: list possible leftovers under a custom name prefix and emit JSON.
  python3 cleanup_retained.py --prefix distributed-load-testing- --region eu-west-1 --json

Exit codes:
  0    the dry run finished, or --delete removed every match (or found none) and
       could read every item that matched by exact ID
  1    an unexpected error, such as a failed AWS read, stopped the run
  2    the arguments are unusable (including --delete without --stack-name,
       --delete without --plan, a --stack-id that names no deleted generation,
       --plan without --delete, --plan-out with --delete or with a path that
       already exists, or --dashboards all
       while a live stack of this name exists whose dashboards cannot be
       attributed), the --plan file cannot be read or its account ID, Region,
       stack name, or dashboards mode differs from the run's, or boto3 is missing
  4    --delete was refused because confirmation was not given
  5    under --delete, one or more deletes failed, an item was held (the logs
       bucket while another bucket of its generation remains, or a Scenarios
       table whose dashboards failed to delete), or an item that matched by exact
       ID could not be read; the run lists them at the end
  130  the run was interrupted
"""

import argparse
import contextlib
import datetime
import json
import os
import sys
import time
import urllib.parse

# DynamoDB table logical-name fragments the solution uses. Physical names combine
# the stack name, the construct path that contains one of these fragments, and a
# random suffix.
KNOWN_TABLE_HINTS = (
    "scenariostable",
    "historytable",
    "agentspacestable",
    "investigationstable",
)

# Log group name prefixes to search, each followed by the stack-name prefix. The
# empty entry covers CloudFormation-generated names such as the ECS, API access, and
# Cognito log groups. Lambda function names, and so their log groups, are generated
# from the stack name too. The Step Functions log group has a fixed name pattern:
# this prefix, the stack name, and the stack's generated suffix, which is the last
# 10 characters of a random UUID.
STEP_FUNCTIONS_LOG_GROUP_PREFIX = "/aws/vendedlogs/states/StepFunctionsLogGroup"
STACK_SUFFIX_CHARS = 10
LOG_GROUP_NAME_PREFIXES = ("", "/aws/lambda/", STEP_FUNCTIONS_LOG_GROUP_PREFIX)

# Per-test CloudWatch dashboards are created at test time, not by CloudFormation.
DASHBOARD_PREFIX = "EcsLoadTesting-"

# Fragment of the server access logs bucket's generated (lowercased) name, in both
# the hub and the regional stack. The bucket deletion step uses it to delete that
# bucket last.
LOGS_BUCKET_HINT = "commonresources"
# S3 delivers server access logs late, so a purged logs bucket can fill again
# before its delete. The tool waits this long, then purges and deletes it once more.
LOGS_BUCKET_RETRY_SECONDS = 10

# DLT table names follow <stackName>-<construct path>; every DLT table's construct
# path starts with one of these.
TABLE_CONSTRUCT_PREFIXES = ("DLT", "DevOpsAgent")

# CloudFormation truncates the stack-name part of a generated bucket or Lambda
# function name when the whole name does not fit; the stock stack name keeps 25
# characters. Generated-name matching tries every stack-part length down to this.
MIN_STACK_PART_CHARS = 20

STACK_NAME_TAG = "aws:cloudformation:stack-name"
STACK_ID_TAG = "aws:cloudformation:stack-id"
OWNED_REASON = "now owned by stack {}"

# Container Insights log groups. ECS creates them, not CloudFormation, so they are
# never stack resources; the tool derives each one from a cluster's exact name.
CONTAINER_INSIGHTS_PREFIX = "/aws/ecs/containerinsights/"
CONTAINER_INSIGHTS_SUFFIX = "/performance"

# The API Gateway CloudWatch role that CDK creates for the DLT REST API and the
# stack retains.
API_CLOUDWATCH_POLICY_SUFFIX = ":iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
APIGATEWAY_PRINCIPAL = "apigateway.amazonaws.com"

# The ALB with ECS console's ECR pull through cache prefix is dlt- plus the last
# group of the stack ID's UUID. The cache rule is deleted with the stack, but the
# repositories it created on first pull are not.
ECR_PREFIX_TEMPLATE = "dlt-{}/"

# The retained resource types the tool deletes. Any other retained type is listed
# for review, except the API Gateway account setting, which has nothing to delete.
RETAINED_TYPES = ("AWS::S3::Bucket", "AWS::DynamoDB::Table", "AWS::Logs::LogGroup", "AWS::IAM::Role")
NOTHING_TO_DELETE_TYPES = ("AWS::ApiGateway::Account",)
LIVE_STACK_REASON = "the live stack of this name owns it"

# The deletion policies that leave a resource behind when its stack is deleted.
RETAIN_POLICIES = ("Retain", "RetainExceptOnCreate")

# The plan's deletable lists, keyed as in the JSON plan, with each one's item label.
DELETABLE = {
    "buckets": "bucket",
    "tables": "table",
    "log_groups": "log group",
    "container_insights_log_groups": "log group",
    "dashboards": "dashboard",
    "iam_roles": "IAM role",
    "ecr_repositories": "ECR repository",
}


def _require_boto3():
    """Return the boto3 module, or exit with a clear message if it is missing."""
    try:
        import boto3  # noqa: F401

        return boto3
    except ImportError:
        sys.stderr.write(
            "This tool needs the boto3 library, which this Python cannot import.\n"
            "python3 -I ignores PYTHONPATH and user site-packages, so install boto3 into a virtual environment\n"
            "and run the script with that environment's python -I:\n"
            "  python3 -m venv <venv-dir>\n"
            "  <venv-dir>/bin/python -m pip install boto3\n"
            "  <venv-dir>/bin/python -I <path to cleanup_retained.py> ...\n"
            "boto3 uses your normal AWS credential chain (environment variables,\n"
            "shared config, or an assumed role). Configure read-only credentials\n"
            "for enumeration and delete-capable credentials only for --delete.\n"
        )
        sys.exit(2)


def error_code(exc):
    """Return the AWS error code of a botocore ClientError, or the exception's class name."""
    return (getattr(exc, "response", None) or {}).get("Error", {}).get("Code") or type(exc).__name__


def skip_unreadable_tags(skipped, kind, name, exc, what="tags"):
    """Record a report-only resource that is skipped because its tags, or what names, could not be read."""
    skipped.append({"kind": kind, "name": name, "reason": f"could not read {what} ({error_code(exc)})"})


def skip_unreadable(skipped, kind, name, exc):
    """Record an exact-ID item that could not be read. It may remain, so --delete exits 5."""
    code = error_code(exc)
    skipped.append({"kind": kind, "name": name, "reason": f"could not read it ({code})", "read_error": code})


def normalize_bucket_region(location):
    """Map an S3 get_bucket_location result to a Region name."""
    if not location:
        return "us-east-1"
    if location == "EU":
        return "eu-west-1"
    return location


def stack_still_exists(cfn, stack_name):
    """Return the DescribeStacks entry of the live stack of this name, else None.

    A deleted stack referenced by name raises a ValidationError, which we read as
    'no live stack'.
    """
    try:
        resp = cfn.describe_stacks(StackName=stack_name)
    except Exception as exc:  # ValidationError for a non-existent stack lands here.
        if "does not exist" in str(exc):
            return None
        raise
    stacks = resp.get("Stacks", [])
    if not stacks or stacks[0].get("StackStatus") == "DELETE_COMPLETE":
        return None
    return stacks[0]


def cfn_tags(tag_list):
    """Extract the CloudFormation attribution tags from a boto3 tag list."""
    wanted = {"aws:cloudformation:stack-name", "aws:cloudformation:stack-id", "aws:cloudformation:logical-id"}
    out = {}
    for tag in tag_list or []:
        key = tag.get("Key")
        if key in wanted:
            out[key] = tag.get("Value")
    return out


def find_buckets(boto3, prefix, region, skipped, stack_name=None):
    """List retained buckets in the target Region that belong to the stack.

    With a stack name, a bucket belongs to the stack when its stack-name tag equals
    that name. A bucket that carries no CloudFormation tags belongs to it when its
    name starts with the full lowercased prefix or has the generated-name shape
    that generated_name_matches recognizes, and such a match is flagged with
    name_shape_only. Without a stack name, the name prefix decides. A bucket whose
    tags cannot be read for any reason other than NoSuchTagSet goes to skipped.
    """
    s3 = boto3.client("s3", region_name=region)
    stack_lower = stack_name.lower() if stack_name else None
    found = []
    for entry in s3.list_buckets().get("Buckets", []):
        name = entry["Name"]
        shape_match = bool(stack_lower) and generated_name_matches(name, stack_lower)
        if not (name.startswith(prefix) or shape_match):
            continue
        try:
            loc = s3.get_bucket_location(Bucket=name).get("LocationConstraint")
        except Exception as exc:
            skip_unreadable_tags(skipped, "S3 bucket", name, exc, "its Region")
            continue
        if normalize_bucket_region(loc) != region:
            continue
        try:
            tags = cfn_tags(s3.get_bucket_tagging(Bucket=name).get("TagSet", []))
        except Exception as exc:
            if error_code(exc) != "NoSuchTagSet":
                skip_unreadable_tags(skipped, "S3 bucket", name, exc)
                continue
            tags = {}
        untagged_shape_match = False
        if stack_name:
            owner = tags.get(STACK_NAME_TAG)
            if owner is not None and owner != stack_name:
                continue
            # A name prefix alone also matches a stack whose name extends this one,
            # such as a same-Region regional stack named <stack>-regional.
            if owner is None and not shape_match:
                continue
            untagged_shape_match = owner is None
        elif not name.startswith(prefix):
            continue
        versions, markers = count_versions(s3, name)
        found.append(
            {
                "name": name,
                "versions": versions,
                "delete_markers": markers,
                "tags": tags,
                "name_shape_only": untagged_shape_match,
            }
        )
    return found


def generated_name_matches(name, stack_part_source, min_chars=MIN_STACK_PART_CHARS):
    """Return True if name has the shape <stack part>-<logical part>-<suffix>.

    The stack part is stack_part_source itself or a truncation of it no shorter than
    min_chars. Requiring exactly one hyphen after the stack part keeps a short stack
    name such as "dlt" from matching "dlt-customer-test-...". Pass
    min_chars=len(stack_part_source) to accept only the whole stack name.
    """
    shortest = min(len(stack_part_source), min_chars)
    for length in range(len(stack_part_source), shortest - 1, -1):
        part = stack_part_source[:length]
        if name.startswith(part + "-") and name[len(part) + 1 :].count("-") == 1:
            return True
    return False


def count_versions(s3, bucket):
    """Count object versions and delete markers in a versioned bucket."""
    versions = markers = 0
    paginator = s3.get_paginator("list_object_versions")
    for page in paginator.paginate(Bucket=bucket):
        versions += len(page.get("Versions", []) or [])
        markers += len(page.get("DeleteMarkers", []) or [])
    return versions, markers


def find_tables(boto3, prefix, region):
    """List retained DLT tables in this Region that match the prefix and a known name."""
    ddb = boto3.client("dynamodb", region_name=region)
    found = []
    paginator = ddb.get_paginator("list_tables")
    for page in paginator.paginate():
        for name in page.get("TableNames", []):
            if not name.startswith(prefix + "-"):
                continue
            if not name[len(prefix) + 1 :].startswith(TABLE_CONSTRUCT_PREFIXES):
                continue
            if not any(hint in name.lower() for hint in KNOWN_TABLE_HINTS):
                continue
            tags = {}
            try:
                desc = ddb.describe_table(TableName=name)["Table"]
                arn = desc["TableArn"]
                items = desc.get("ItemCount", 0)
                tags = cfn_tags(ddb.list_tags_of_resource(ResourceArn=arn).get("Tags", []))
            except Exception:
                items = None
            found.append({"name": name, "items": items, "tags": tags})
    return found


def log_group_tags(logs, group):
    """Return the tags of a log group.

    An error reading the tags propagates, so the caller skips the group instead of
    treating it as untagged.
    """
    arn = group.get("arn", "")
    if arn.endswith(":*"):
        arn = arn[:-2]
    return logs.list_tags_for_resource(resourceArn=arn).get("tags", {})


def step_functions_group_matches(name, stack_name):
    """Return True if name is StepFunctionsLogGroup<stack_name><suffix> exactly."""
    rest = name[len(STEP_FUNCTIONS_LOG_GROUP_PREFIX + stack_name) :]
    return (
        name.startswith(STEP_FUNCTIONS_LOG_GROUP_PREFIX + stack_name)
        and len(rest) == STACK_SUFFIX_CHARS
        and rest.isalnum()
    )


def find_log_groups(boto3, prefix, region, skipped, stack_name=None):
    """List retained log groups under each DLT name shape for the stack-name prefix.

    With a stack name, a group whose stack-name tag names a different stack is
    skipped, so a hub cleanup does not take a same-Region regional stack's groups.
    An untagged group must also have the generated-name shape, because a stack
    whose name extends this one shares the name prefix. A group whose tags cannot
    be read goes to skipped.
    """
    logs = boto3.client("logs", region_name=region)
    found = []
    seen = set()
    paginator = logs.get_paginator("describe_log_groups")
    for shape in LOG_GROUP_NAME_PREFIXES:
        lambda_shape = shape == "/aws/lambda/"
        # Lambda function names use the truncated stack part, so search on its
        # shortest form and let generated_name_matches decide.
        search = prefix[:MIN_STACK_PART_CHARS] if lambda_shape and stack_name else prefix
        for page in paginator.paginate(logGroupNamePrefix=shape + search):
            for group in page.get("logGroups", []):
                name = group["logGroupName"]
                if name in seen:
                    continue
                name_shape_only = False
                if lambda_shape and stack_name:
                    function_name = name[len(shape) :]
                    if not generated_name_matches(function_name, prefix):
                        continue
                    # A truncated stack part is shared by every stack whose name
                    # starts with the same characters, so flag that match.
                    name_shape_only = not generated_name_matches(function_name, prefix, len(prefix))
                seen.add(name)
                if stack_name:
                    try:
                        owner = log_group_tags(logs, group).get(STACK_NAME_TAG)
                    except Exception as exc:
                        skip_unreadable_tags(skipped, "log group", name, exc)
                        continue
                    if owner is not None and owner != stack_name:
                        continue
                    if owner is None and shape == "" and not generated_name_matches(name, prefix, len(prefix)):
                        continue
                    if (
                        owner is None
                        and shape == STEP_FUNCTIONS_LOG_GROUP_PREFIX
                        and not step_functions_group_matches(name, prefix)
                    ):
                        continue
                found.append(
                    {
                        "name": name,
                        "stored_bytes": group.get("storedBytes", 0),
                        "retention_days": group.get("retentionInDays"),
                        "name_shape_only": name_shape_only,
                    }
                )
    return found


def stack_test_ids(boto3, region, tables):
    """Map each test ID in the retained Scenarios tables to its table's stack ID, or return None.

    None means no Scenarios table matched in this Region, so no dashboard can be
    attributed to the stack here.
    """
    scenario_tables = [t for t in tables if "scenariostable" in t["name"].lower()]
    if not scenario_tables:
        return None
    ddb = boto3.client("dynamodb", region_name=region)
    ids = {}
    paginator = ddb.get_paginator("scan")
    for table in scenario_tables:
        for page in paginator.paginate(TableName=table["name"], ProjectionExpression="testId"):
            for item in page.get("Items", []):
                value = item.get("testId", {}).get("S")
                if value:
                    ids.setdefault(value, table["stack_id"])
    return ids


def dashboard_test_id(name, region):
    """Extract the test ID from EcsLoadTesting-<testId>-<region>, or None."""
    suffix = "-" + region
    if not (name.startswith(DASHBOARD_PREFIX) and name.endswith(suffix)):
        return None
    return name[len(DASHBOARD_PREFIX) : -len(suffix)] or None


def select_dashboards(all_dashboards, mode, test_ids, region):
    """Split dashboards into those to remove and those left alone, per --dashboards."""
    if mode == "skip":
        return [], all_dashboards
    if mode == "all":
        return all_dashboards, []
    chosen, left = [], []
    for dashboard in all_dashboards:
        test_id = dashboard_test_id(dashboard["name"], region)
        if test_ids and test_id in test_ids:
            chosen.append(dict(dashboard, stack_id=test_ids[test_id], test_id=test_id))
        else:
            left.append(dashboard)
    return chosen, left


def find_dashboards(boto3, region):
    """List leftover per-test dashboards (EcsLoadTesting-<testId>-<region>)."""
    cw = boto3.client("cloudwatch", region_name=region)
    found = []
    paginator = cw.get_paginator("list_dashboards")
    for page in paginator.paginate(DashboardNamePrefix=DASHBOARD_PREFIX):
        for entry in page.get("DashboardEntries", []):
            found.append({"name": entry["DashboardName"]})
    return found


def find_customer_kms_keys(boto3, prefix, region, skipped):
    """Run a defensive check for any customer-managed KMS key tied to the stack.

    DLT uses only AWS-managed keys, so this normally returns an empty list. It
    reports a customer-managed key only when an alias or a tag references the
    stack name, which would indicate a key added outside the stock solution.
    """
    kms = boto3.client("kms", region_name=region)
    aliases_by_key = {}
    try:
        alias_paginator = kms.get_paginator("list_aliases")
        for page in alias_paginator.paginate():
            for alias in page.get("Aliases", []):
                if "TargetKeyId" in alias:
                    aliases_by_key.setdefault(alias["TargetKeyId"], []).append(alias["AliasName"])
    except Exception as exc:
        skip_unreadable_tags(skipped, "KMS", "ListAliases", exc, "the key aliases")

    found = []
    try:
        key_paginator = kms.get_paginator("list_keys")
        for page in key_paginator.paginate():
            for key in page.get("Keys", []):
                key_id = key["KeyId"]
                try:
                    meta = kms.describe_key(KeyId=key_id)["KeyMetadata"]
                except Exception as exc:
                    skip_unreadable_tags(skipped, "KMS key", key_id, exc, "it")
                    continue
                if meta.get("KeyManager") != "CUSTOMER":
                    continue
                if meta.get("KeyState") == "PendingDeletion":
                    continue
                names = aliases_by_key.get(key_id, [])
                referenced = any(prefix in a for a in names)
                if not referenced:
                    try:
                        tags = kms.list_resource_tags(KeyId=key_id).get("Tags", [])
                        referenced = any(prefix in t.get("TagValue", "") for t in tags)
                    except Exception as exc:
                        skip_unreadable_tags(skipped, "KMS key", key_id, exc)
                        referenced = False
                if referenced:
                    found.append({"key_id": key_id, "aliases": names})
    except Exception as exc:
        skip_unreadable_tags(skipped, "KMS", "ListKeys", exc, "the key list")
    return found


def deleted_stack_records(cfn, stack_name):
    """Return the deleted stacks of this exact name in this Region, newest first.

    Each record gives the stack ID and the stack's lifetime. CloudFormation keeps a
    deleted stack in ListStacks for 90 days, so an older deletion returns nothing.
    """
    records = []
    paginator = cfn.get_paginator("list_stacks")
    for page in paginator.paginate(StackStatusFilter=["DELETE_COMPLETE"]):
        for summary in page.get("StackSummaries", []):
            if summary.get("StackName") != stack_name:
                continue
            if not summary.get("CreationTime") or not summary.get("DeletionTime"):
                continue
            records.append(
                {
                    "stack_id": summary["StackId"],
                    "created": summary["CreationTime"],
                    "deleted": summary["DeletionTime"],
                }
            )
    records.sort(key=lambda record: record["deleted"], reverse=True)
    return records


def owning_record(created, records):
    """Return the deleted stack whose lifetime contains created, or None."""
    for record in records:
        if record["created"] <= created <= record["deleted"]:
            return record
    return None


def epoch_ms_to_datetime(value):
    """Convert a CloudWatch Logs creationTime (epoch milliseconds) to a UTC datetime."""
    return datetime.datetime.fromtimestamp(value / 1000, tz=datetime.timezone.utc)


def stack_resources(cfn, stack):
    """Return every resource row of a stack: by name for a live stack, by stack ID for a deleted one."""
    rows = []
    for page in cfn.get_paginator("list_stack_resources").paginate(StackName=stack):
        rows.extend(page.get("StackResourceSummaries", []))
    return rows


def replaced_rows(cfn, stack_id, rows):
    """Return a row for each DELETE_SKIPPED event whose physical ID the resource list lacks.

    A retained resource that an update replaced or removed drops out of
    ListStackResources, but its DELETE_SKIPPED event stays in the stack's events.
    """
    known = {row.get("PhysicalResourceId") for row in rows}
    found = {}
    for page in cfn.get_paginator("describe_stack_events").paginate(StackName=stack_id):
        for event in page.get("StackEvents", []):
            name = event.get("PhysicalResourceId")
            if event.get("ResourceStatus") == "DELETE_SKIPPED" and name and name not in known:
                found.setdefault(name, {"ResourceType": event.get("ResourceType"), "PhysicalResourceId": name})
    return [dict(row, ResourceStatus="DELETE_SKIPPED") for row in found.values()]


def owner_fields(record, name):
    """Return a plan entry's generation fields: its stack ID, and whether an update replaced or removed it."""
    fields = {"stack_id": record["stack_id"]}
    if name in record.get("replaced", ()):
        fields["replaced"] = True
    return fields


def physical_ids(rows, resource_type, retained=True):
    """Return the physical IDs of the rows of this type; by default only retained (DELETE_SKIPPED) rows."""
    return [
        row["PhysicalResourceId"]
        for row in rows
        if row.get("ResourceType") == resource_type
        and row.get("PhysicalResourceId")
        and (not retained or row.get("ResourceStatus") == "DELETE_SKIPPED")
    ]


def lambda_log_groups(rows):
    """Return the log group the Lambda service creates for each function in rows."""
    return ["/aws/lambda/" + name for name in physical_ids(rows, "AWS::Lambda::Function", retained=False)]


def insights_log_groups(rows):
    """Return the Container Insights log group of each ECS cluster in rows."""
    return [
        CONTAINER_INSIGHTS_PREFIX + name.rsplit("/", 1)[-1] + CONTAINER_INSIGHTS_SUFFIX
        for name in physical_ids(rows, "AWS::ECS::Cluster", retained=False)
    ]


def live_stack_names(rows):
    """Return every physical ID the live stack lists, with the log group names derived from them."""
    names = {row["PhysicalResourceId"] for row in rows if row.get("PhysicalResourceId")}
    return names | set(lambda_log_groups(rows)) | set(insights_log_groups(rows))


def exact_names(records, names_of, live_names, skipped, kind):
    """Return (record, name) once for each name that names_of finds in a generation's rows.

    Generations are newest first, so a name two generations share goes to the
    newer one. A name that the live stack owns goes to skipped instead.
    """
    pairs, seen = [], set()
    for record in records:
        for name in names_of(record["resources"]):
            if name in seen:
                continue
            seen.add(name)
            if name in live_names:
                skipped.append({"kind": kind, "name": name, "reason": LIVE_STACK_REASON})
            else:
                pairs.append((record, name))
    return pairs


def existing_log_group(logs, name):
    """Return the log group with exactly this name, or None."""
    for page in logs.get_paginator("describe_log_groups").paginate(logGroupNamePrefix=name):
        for group in page.get("logGroups", []):
            if group["logGroupName"] == name:
                return group
    return None


def owner_check(cfn, deleted_ids):
    """Return a function that names the live stack, other than the item's own generation, that now claims an item.

    Given a physical ID, DescribeStackResources returns the resources of the stack
    that the resource belongs to, each row with that stack's ID, and it fails with
    a ValidationError ("Stack for <id> does not exist") when no stack claims it.
    The item's aws:cloudformation:stack-id tag can name a claimant too. A claimant
    that is the item's own generation, another deleted generation of the stack
    name, or a stack that DescribeStacks reports as deleted is not a current owner.
    """
    live = {}

    def owner(name, own_id, tag_id=None):
        try:
            rows = cfn.describe_stack_resources(PhysicalResourceId=name).get("StackResources", [])
        except Exception as exc:
            if "does not exist" not in str(exc):
                raise
            rows = []
        for sid in sorted(({row.get("StackId") for row in rows} | {tag_id}) - {None, own_id} - set(deleted_ids)):
            if sid not in live:
                live[sid] = stack_still_exists(cfn, sid)
            if live[sid]:
                return live[sid].get("StackName") or sid
        return None

    return owner


def probe_bucket(s3, name):
    """Return the bucket's plan entry with its stack-id tag, or None when it no longer exists."""
    try:
        s3.head_bucket(Bucket=name)
    except Exception as exc:
        if error_code(exc) in ("404", "NoSuchBucket", "NotFound"):
            return None
        raise
    try:
        tag = cfn_tags(s3.get_bucket_tagging(Bucket=name).get("TagSet")).get(STACK_ID_TAG)
    except Exception as exc:
        if error_code(exc) != "NoSuchTagSet":
            raise
        tag = None
    versions, markers = count_versions(s3, name)
    return {"name": name, "versions": versions, "delete_markers": markers, "tag_stack_id": tag}


def probe_table(ddb, name):
    """Return the table's plan entry with its stack-id tag, or None when it no longer exists."""
    try:
        table = ddb.describe_table(TableName=name)["Table"]
    except Exception as exc:
        if error_code(exc) == "ResourceNotFoundException":
            return None
        raise
    tags = cfn_tags(ddb.list_tags_of_resource(ResourceArn=table["TableArn"]).get("Tags"))
    return {"name": name, "items": table.get("ItemCount"), "tag_stack_id": tags.get(STACK_ID_TAG)}


def probe_log_group(logs, name):
    """Return the log group's plan entry with its stack-id tag, or None when it does not exist."""
    group = existing_log_group(logs, name)
    if group is None:
        return None
    return {
        "name": name,
        "stored_bytes": group.get("storedBytes", 0),
        "retention_days": group.get("retentionInDays"),
        "tag_stack_id": log_group_tags(logs, group).get(STACK_ID_TAG),
    }


def find_retained(boto3, region, records, live_names, skipped, owns):
    """Return the deleted generations' buckets, tables, and log groups that still exist, and other retained rows.

    Buckets, tables, and explicit log groups come from DELETE_SKIPPED rows by exact
    physical ID, and Lambda log groups from the exact names of the functions. Each
    entry carries its generation's stack ID. An item that another live stack now
    owns goes to skipped.
    """
    searches = (
        ("S3 bucket", lambda rows: physical_ids(rows, "AWS::S3::Bucket"), probe_bucket, "s3"),
        ("table", lambda rows: physical_ids(rows, "AWS::DynamoDB::Table"), probe_table, "dynamodb"),
        ("log group", lambda rows: physical_ids(rows, "AWS::Logs::LogGroup") + lambda_log_groups(rows), probe_log_group, "logs"),
    )
    results = []
    for kind, names_of, probe, service in searches:
        client = boto3.client(service, region_name=region)
        found = []
        for record, name in exact_names(records, names_of, live_names, skipped, kind):
            try:
                item = probe(client, name)
                owner = item and owns(name, record["stack_id"], item.pop("tag_stack_id"))
            except Exception as exc:
                skip_unreadable(skipped, kind, name, exc)
                continue
            if owner:
                skipped.append({"kind": kind, "name": name, "reason": OWNED_REASON.format(owner)})
            elif item:
                found.append(dict(item, **owner_fields(record, name)))
        results.append(found)
    other = [
        dict(type=row.get("ResourceType"), name=row.get("PhysicalResourceId"), **owner_fields(record, row.get("PhysicalResourceId")))
        for record in records
        for row in record["resources"]
        if row.get("ResourceStatus") == "DELETE_SKIPPED"
        and row.get("ResourceType") not in RETAINED_TYPES + NOTHING_TO_DELETE_TYPES
    ]
    return results + [other]


def find_container_insights_groups(boto3, region, records, live_names, skipped, owns):
    """List the Container Insights log groups of the deleted generations' ECS clusters.

    Each group's name comes from the exact name of a cluster in a generation's
    rows. A group matches when it was created during the lifetime of a deleted
    generation, ECS reports no active cluster of that name, and no other live
    stack owns it.
    """
    logs = boto3.client("logs", region_name=region)
    ecs = boto3.client("ecs", region_name=region)
    found = []
    for _, name in exact_names(records, insights_log_groups, live_names, skipped, "log group"):
        cluster = name[len(CONTAINER_INSIGHTS_PREFIX) : -len(CONTAINER_INSIGHTS_SUFFIX)]
        try:
            group = existing_log_group(logs, name)
            record = group and owning_record(epoch_ms_to_datetime(group.get("creationTime", 0)), records)
            if not record:
                continue
            clusters = ecs.describe_clusters(clusters=[cluster]).get("clusters", [])
            active = any(c.get("status") == "ACTIVE" for c in clusters)
            owner = not active and owns(name, record["stack_id"], log_group_tags(logs, group).get(STACK_ID_TAG))
        except Exception as exc:
            skip_unreadable(skipped, "log group", name, exc)
            continue
        if active or owner:
            reason = "ECS still reports its cluster as active" if active else OWNED_REASON.format(owner)
            skipped.append({"kind": "log group", "name": name, "reason": reason})
            continue
        found.append(
            {
                "name": name,
                "stored_bytes": group.get("storedBytes", 0),
                "retention_days": group.get("retentionInDays"),
                "stack_id": record["stack_id"],
            }
        )
    return found


def trusts_only_apigateway(document):
    """Return True if a trust policy lets only API Gateway assume the role."""
    if isinstance(document, str):
        document = json.loads(urllib.parse.unquote(document))
    statements = document.get("Statement", [])
    if isinstance(statements, dict):
        statements = [statements]
    if len(statements) != 1:
        return False
    statement = statements[0]
    principal = statement.get("Principal", {})
    services = principal.get("Service") if isinstance(principal, dict) else None
    if isinstance(services, str):
        services = [services]
    actions = statement.get("Action")
    if isinstance(actions, str):
        actions = [actions]
    return (
        statement.get("Effect") == "Allow"
        and set(principal) == {"Service"}
        and services == [APIGATEWAY_PRINCIPAL]
        and actions == ["sts:AssumeRole"]
        and "Condition" not in statement
    )


def find_api_cloudwatch_roles(boto3, region, records, live_names, skipped, other, owns):
    """Split the deleted generations' retained API Gateway CloudWatch roles into two lists.

    Each role comes from a DELETE_SKIPPED row by exact name. It counts only when API
    Gateway is the sole principal it trusts and AmazonAPIGatewayPushToCloudWatchLogs
    is its only policy; a retained role of another shape goes to other, for review. Returns (removable,
    held). A role that this Region's API Gateway account setting names is held,
    because deleting it stops API Gateway logging in the Region. So is a role that
    IAM reports as used after the generation's DeletionTime, because IAM is global
    and another Region may still use it, and a role whose stack-id tag names a
    stack in another Region, because owns checks owners only in this Region.
    """
    iam = boto3.client("iam", region_name=region)
    removable, held = [], []
    retained_roles = exact_names(
        records, lambda rows: physical_ids(rows, "AWS::IAM::Role"), live_names, skipped, "IAM role"
    )
    if not retained_roles:
        return removable, held
    account_role = boto3.client("apigateway", region_name=region).get_account().get("cloudwatchRoleArn") or ""
    for record, name in retained_roles:
        try:
            role = iam.get_role(RoleName=name)["Role"]
            attached = iam.list_attached_role_policies(RoleName=name).get("AttachedPolicies", [])
            inline = iam.list_role_policies(RoleName=name).get("PolicyNames", [])
            tag_id = cfn_tags(role.get("Tags")).get(STACK_ID_TAG)
            # A stack ARN reads arn:<partition>:cloudformation:<region>:<account>:stack/<name>/<uuid>.
            parts = (tag_id or "").split(":")
            tag_region = parts[3] if len(parts) > 5 and parts[0] == "arn" else region
            owner = tag_region == region and owns(name, record["stack_id"], tag_id)
        except Exception as exc:
            if error_code(exc) != "NoSuchEntity":
                skip_unreadable(skipped, "IAM role", name, exc)
            continue
        if owner:
            skipped.append({"kind": "IAM role", "name": name, "reason": OWNED_REASON.format(owner)})
            continue
        if (
            inline
            or len(attached) != 1
            or not attached[0]["PolicyArn"].endswith(API_CLOUDWATCH_POLICY_SUFFIX)
            or not trusts_only_apigateway(role.get("AssumeRolePolicyDocument", {}))
        ):
            other.append(dict(type="AWS::IAM::Role", name=name, **owner_fields(record, name)))
            continue
        entry = dict(name=name, arn=role["Arn"], policy_arn=attached[0]["PolicyArn"], **owner_fields(record, name))
        last_used = (role.get("RoleLastUsed") or {}).get("LastUsedDate")
        if tag_region != region:
            entry["reason"] = (
                f"its {STACK_ID_TAG} tag names a stack in {tag_region}, and IAM is global, so check that "
                f"stack in {tag_region} before you remove the role by hand."
            )
        elif role["Arn"] == account_role:
            entry["reason"] = (
                "this Region's API Gateway account setting (cloudwatchRoleArn) names it, "
                "so deleting it would stop API Gateway logging here. See the skill before you remove it."
            )
        elif last_used and last_used > record["deleted"]:
            entry["reason"] = (
                f"IAM reports its last use at {last_used}, after the stack was deleted, so something still uses it, "
                "such as another Region's API Gateway account setting."
            )
        (held if "reason" in entry else removable).append(entry)
    return removable, held


def find_pull_through_repositories(boto3, region, records):
    """List the ECR repositories the deleted stack's pull through cache rule created.

    The repository prefix is derived from each deleted stack's ID, and a repository
    must also have been created during that stack's lifetime.
    """
    ecr = boto3.client("ecr", region_name=region)
    prefixes = {}
    for record in records:
        stack_uuid = record["stack_id"].split("/")[2]
        prefixes[ECR_PREFIX_TEMPLATE.format(stack_uuid.split("-")[4])] = record
    found = []
    if not prefixes:
        return found
    paginator = ecr.get_paginator("describe_repositories")
    for page in paginator.paginate():
        for repo in page.get("repositories", []):
            name = repo["repositoryName"]
            for prefix, record in prefixes.items():
                if name.startswith(prefix) and record["created"] <= repo["createdAt"] <= record["deleted"]:
                    found.append({"name": name, "stack_id": record["stack_id"]})
                    break
    return found


def preview_live_stack(boto3, cfn, region, live, rows, all_dashboards):
    """List what the live stack's delete will leave behind, or return None when its template is not JSON.

    The list holds each resource whose DeletionPolicy retains it, by physical ID,
    and the items derived from the stack's rows: existing Lambda and Container
    Insights log groups, pull through cache repositories, and the per-test
    dashboards of its Scenarios table. Nothing here is ever deleted.
    """
    body = cfn.get_template(StackName=live["StackId"], TemplateStage="Processed").get("TemplateBody") or {}
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError:
            return None
    retained = {
        logical
        for logical, resource in (body.get("Resources") or {}).items()
        if resource.get("DeletionPolicy") in RETAIN_POLICIES and resource.get("Type") not in NOTHING_TO_DELETE_TYPES
    }
    items = [
        {"type": row["ResourceType"], "name": row["PhysicalResourceId"]}
        for row in rows
        if row.get("LogicalResourceId") in retained and row.get("PhysicalResourceId")
    ]
    logs = boto3.client("logs", region_name=region)
    seen = {item["name"] for item in items}
    for kind, names in (("Lambda log group", lambda_log_groups(rows)), ("Container Insights log group", insights_log_groups(rows))):
        items += [{"type": kind, "name": name} for name in names if name not in seen and existing_log_group(logs, name)]
    lifetime = {"stack_id": live["StackId"], "created": live["CreationTime"], "deleted": datetime.datetime.now(datetime.timezone.utc)}
    items += [{"type": "ECR repository", "name": r["name"]} for r in find_pull_through_repositories(boto3, region, [lifetime])]
    tables = [{"name": name, "stack_id": live["StackId"]} for name in physical_ids(rows, "AWS::DynamoDB::Table", retained=False)]
    chosen, _ = select_dashboards(all_dashboards, "stack", stack_test_ids(boto3, region, tables), region)
    return items + [{"type": "dashboard", "name": d["name"]} for d in chosen]


def load_plan(path, current):
    """Return the reviewed plan that --plan-out wrote, or None after saying why this run cannot use it.

    current maps account_id, region, stack_name, and dashboards_mode to this run's
    values, and the plan's context must carry the same ones.
    """
    try:
        with open(path) as handle:
            plan = json.load(handle)
        context = plan["context"]
        mismatched = [key for key, value in current.items() if context.get(key) != value]
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        sys.stderr.write(f"Cannot use {path} as a plan from --plan-out: {exc!r}\n")
        return None
    if mismatched:
        details = "; ".join(f"{key} is {context.get(key)} in the plan but {current[key]} in this run" for key in mismatched)
        sys.stderr.write(f"Refusing to delete: the plan does not fit this run ({details}). No changes were made.\n")
        return None
    return plan


def apply_plan(report, plan):
    """Keep only the deletable items that the reviewed plan lists by the same name and generation.

    Returns the planned items that are gone or no longer match, and the number of
    current matches that the plan does not list.
    """
    missing, unplanned = [], 0
    for key, kind in DELETABLE.items():
        listed = [item for item in plan.get(key) or [] if isinstance(item, dict)]
        planned = {(item.get("name"), item.get("stack_id")) for item in listed}
        current = {(item["name"], item.get("stack_id")) for item in report[key]}
        missing += [f"{kind} {item.get('name')}" for item in listed if (item.get("name"), item.get("stack_id")) not in current]
        unplanned += len(current - planned)
        report[key][:] = [item for item in report[key] if (item["name"], item.get("stack_id")) in planned]
    return missing, unplanned


def delete_role(iam, role):
    """Detach the role's managed policy, remove it from instance profiles, and delete it."""
    iam.detach_role_policy(RoleName=role["name"], PolicyArn=role["policy_arn"])
    for profile in iam.list_instance_profiles_for_role(RoleName=role["name"]).get("InstanceProfiles", []):
        iam.remove_role_from_instance_profile(InstanceProfileName=profile["InstanceProfileName"], RoleName=role["name"])
    iam.delete_role(RoleName=role["name"])


def purge_and_delete_bucket(boto3, name, region, retry=False):
    """Delete every version and delete marker, then delete the bucket.

    With retry, a bucket that a late server access log refilled (BucketNotEmpty)
    is purged and deleted once more after a short wait.
    """
    bucket = boto3.resource("s3", region_name=region).Bucket(name)
    for attempt in (1, 2):
        bucket.object_versions.delete()
        try:
            return bucket.delete()
        except Exception as exc:
            if not retry or attempt == 2 or error_code(exc) != "BucketNotEmpty":
                raise
        time.sleep(LOGS_BUCKET_RETRY_SECONDS)


def logging_source(s3, logs_bucket, names):
    """Return the first bucket in names that still exists and may write server access logs to logs_bucket, else None.

    A bucket counts when its logging setting targets logs_bucket, or when HeadBucket
    or GetBucketLogging fails with anything other than a missing bucket.
    """
    for name in names:
        try:
            s3.head_bucket(Bucket=name)
            target = (s3.get_bucket_logging(Bucket=name).get("LoggingEnabled") or {}).get("TargetBucket")
        except Exception as exc:
            if error_code(exc) in ("404", "NoSuchBucket", "NotFound"):
                continue
            return name
        if target == logs_bucket:
            return name
    return None


def finish(plan, unread, failures=(), held=()):
    """Report what --delete left behind on stderr, and return 5 when anything remains, else 0."""
    if failures:
        sys.stderr.write(f"\n{len(failures)} delete(s) FAILED: {', '.join(failures)}.\n")
    if held:
        sys.stderr.write(f"\n{len(held)} item(s) HELD, not deleted: {'; '.join(held)}.\n")
    if failures or held:
        sys.stderr.write(f"Fix each cause, then run the same --delete --plan {plan} command again.\n")
    if unread:
        names = ", ".join(f"{item['kind']} {item['name']} ({item['read_error']})" for item in unread)
        sys.stderr.write(f"\n{len(unread)} item(s) could not be read, so they were skipped and may remain: {names}.\n")
    return 5 if failures or held or unread else 0


def generation(item):
    """Label a plan entry with the UUID of its generation's stack ID, and say when an update replaced or removed it."""
    label = f"  stack-id={item['stack_id'].rsplit('/', 1)[-1]}" if item.get("stack_id") else ""
    return label + (" (replaced or removed during an update)" if item.get("replaced") else "")


def print_plan(context, buckets, tables, log_groups, dashboards, kms_keys, skipped, stack_status, owned):
    lines = []
    lines.append("DLT retained-resource plan")
    lines.append(f"  stack name / prefix : {context['stack_name'] or context['prefix']}")
    lines.append(f"  account             : {context['account_id']}")
    lines.append(f"  region              : {context['region']}")
    lines.append(f"  mode                : {'DELETE' if context['delete'] else 'DRY RUN (no changes)'}")
    if stack_status:
        lines.append(f"  live stack present  : YES, status {stack_status} (anything it owns is left out)")
    elif context["stack_name"]:
        lines.append("  live stack present  : no")
    else:
        lines.append("  live stack present  : not checked (use --stack-name)")
    if owned["records"]:
        ids = ", ".join(r["stack_id"].split("/")[2] for r in owned["records"])
        lines.append(f"  deleted generations : {len(owned['records'])} ({ids}), matched by exact ID")
        if len(owned["records"]) > 1:
            lines.append("    (the plan covers each generation; pass --stack-id to act on one at a time)")
    lines.append("")
    if stack_status and owned["preview"] is None:
        lines.extend(["Will remain after the stack delete: no preview, because the stack's template is not JSON.", ""])
    elif stack_status:
        preview = owned["preview"]
        lines.append(f"Will remain after the stack delete ({len(preview)}, preview; nothing is deleted while the stack exists):")
        lines.extend([f"  - {item['type']} {item['name']}" for item in preview] + [""])

    lines.append(f"S3 buckets ({len(buckets)}):")
    for b in buckets:
        lines.append(
            f"  - {b['name']}  versions={b['versions']} delete_markers={b['delete_markers']}{generation(b)}"
        )
    lines.append(f"DynamoDB tables ({len(tables)}):")
    for t in tables:
        items = "unknown" if t["items"] is None else t["items"]
        lines.append(f"  - {t['name']}  approx_items={items}{generation(t)}")
    lines.append(f"CloudWatch log groups ({len(log_groups)}):")
    for g in log_groups:
        lines.append(
            f"  - {g['name']}  stored_bytes={g['stored_bytes']} retention_days={g['retention_days']}{generation(g)}"
        )
    lines.append(f"Per-test dashboards ({len(dashboards)}, --dashboards {context['dashboards_mode']}):")
    if context["dashboards_mode"] == "stack" and context["dashboard_test_ids"] is None:
        lines.append("  (no Scenarios table matched in this Region, so no dashboard is attributed to the stack)")
    elif context["dashboards_mode"] == "all" and dashboards:
        lines.append("  (every EcsLoadTesting- dashboard in this Region, including any from another DLT deployment)")
    for d in dashboards:
        lines.append(f"  - {d['name']}{generation(d)}")
    if context["dashboards_left"]:
        lines.append(
            f"  {context['dashboards_left']} other EcsLoadTesting- dashboard(s) left alone; "
            "pass --dashboards all only after confirming no other DLT stack in this Region uses them."
        )
    if not context["stack_name"]:
        lines.append("Container Insights log groups, IAM roles, and ECR repositories: not searched.")
        lines.append("  (nothing is matched by exact ID without --stack-name)")
    elif not owned["records"]:
        lines.append("Container Insights log groups, IAM roles, and ECR repositories: not searched.")
        lines.append(
            f"  (no deleted stack named {context['stack_name']} in this Region's ListStacks history, which keeps "
            "deleted stacks for 90 days, so nothing is matched by exact ID; see the skill for the manual search)"
        )
    else:
        lines.append(f"Container Insights log groups ({len(owned['insights'])}):")
        for g in owned["insights"]:
            lines.append(f"  - {g['name']}  stored_bytes={g['stored_bytes']}{generation(g)}")
        lines.append(f"API Gateway CloudWatch IAM roles ({len(owned['roles'])}):")
        for r in owned["roles"]:
            lines.append(f"  - {r['name']}{generation(r)}")
        for r in owned["roles_skipped"]:
            lines.append(f"  - SKIPPED {r['name']}: {r['reason']}")
        lines.append(f"ECR pull through cache repositories ({len(owned['repositories'])}):")
        for r in owned["repositories"]:
            lines.append(f"  - {r['name']}{generation(r)}")
    if owned["other"]:
        lines.append(f"Other retained resources ({len(owned['other'])}, not deleted; review by hand):")
        for r in owned["other"]:
            lines.append(f"  - {r['type']} {r['name']}{generation(r)}")
    possible = owned["possible"]
    if any(possible.values()):
        count = sum(len(items) for items in possible.values())
        lines.append(f"Possible leftovers matched by name only ({count}, never deleted; review by hand):")
        for b in possible["buckets"]:
            lines.append(f"  - S3 bucket {b['name']}  versions={b['versions']} delete_markers={b['delete_markers']}")
        for kind, key in (("table", "tables"), ("log group", "log_groups")):
            lines.extend(f"  - {kind} {item['name']}" for item in possible[key])
    if skipped:
        lines.append(f"Skipped resources ({len(skipped)}, not deleted; see each reason):")
        for item in skipped:
            lines.append(f"  - {item['kind']} {item['name']}  skipped: {item['reason']}")
    lines.append(f"Customer-managed KMS keys referencing the stack ({len(kms_keys)}, not deleted; review by hand):")
    if not kms_keys and any(item["kind"].startswith("KMS") for item in skipped):
        lines.append("  - none found, but the check is incomplete; see the KMS entries under Skipped resources")
    elif not kms_keys:
        lines.append("  - none (DLT uses AWS-managed keys)")
    for k in kms_keys:
        lines.append(f"  - {k['key_id']}  aliases={k['aliases']}")
    print("\n".join(lines))


def confirm_interactively(stack_label):
    """Ask for typed confirmation on a TTY. Return True to proceed."""
    if not sys.stdin.isatty():
        sys.stderr.write(
            "Refusing to delete without confirmation on a non-interactive run.\n"
            "Show the plan to the user and ask them to run --delete --plan <file> in their own terminal. "
            "Pass --yes only when the user asks you to run it and has approved that plan.\n"
        )
        return False
    prompt = f"Type the stack name '{stack_label}' to confirm permanent deletion: "
    try:
        answer = input(prompt).strip()
    except EOFError:
        return False
    return answer == stack_label


def run(args, json_out=None):
    boto3 = _require_boto3()
    # Tables and log groups keep the stack name's case; bucket names are lowercase.
    prefix = args.prefix or args.stack_name or ""
    bucket_prefix = prefix.lower()
    if not prefix:
        sys.stderr.write("Provide --stack-name or --prefix.\n")
        return 2

    account = boto3.client("sts", region_name=args.region).get_caller_identity().get("Account")
    dashboards_mode = "skip" if args.skip_dashboards else args.dashboards
    reviewed = None
    if args.plan:
        current = {"account_id": account, "region": args.region, "stack_name": args.stack_name}
        reviewed = load_plan(args.plan, dict(current, dashboards_mode=dashboards_mode))
        if reviewed is None:
            return 2

    cfn = boto3.client("cloudformation", region_name=args.region)
    live = stack_status = None
    live_rows = []
    live_names = set()
    records = []
    deleted_ids = set()
    if args.stack_name:
        live = stack_still_exists(cfn, args.stack_name)
        # Exact IDs from a deleted generation never name a live stack's resources,
        # but leave out everything the live stack of this name owns anyway.
        if live:
            stack_status = live.get("StackStatus", "UNKNOWN")
            live_rows = stack_resources(cfn, args.stack_name)
            live_names = live_stack_names(live_rows)
        records = deleted_stack_records(cfn, args.stack_name)
        deleted_ids = {r["stack_id"] for r in records}
        if args.stack_id:
            records = [r for r in records if args.stack_id in (r["stack_id"], r["stack_id"].split("/")[2])]
            if not records:
                sys.stderr.write(
                    f"No deleted stack named {args.stack_name} has the stack ID {args.stack_id} in this Region's "
                    "ListStacks history.\n"
                )
                return 2
        for record in records:
            record["resources"] = stack_resources(cfn, record["stack_id"])
            replaced = replaced_rows(cfn, record["stack_id"], record["resources"])
            record["replaced"] = {row["PhysicalResourceId"] for row in replaced}
            record["resources"] += replaced

    skipped = []
    owns = owner_check(cfn, deleted_ids)
    buckets, tables, log_groups, other = find_retained(boto3, args.region, records, live_names, skipped, owns)
    test_ids = stack_test_ids(boto3, args.region, tables) if dashboards_mode == "stack" else None
    all_dashboards = [] if dashboards_mode == "skip" else find_dashboards(boto3, args.region)
    dashboards, dashboards_left = select_dashboards(all_dashboards, dashboards_mode, test_ids, args.region)
    preview = preview_live_stack(boto3, cfn, args.region, live, live_rows, all_dashboards) if live else None
    live_tables = physical_ids(live_rows, "AWS::DynamoDB::Table", retained=False)
    if dashboards_mode == "all" and live and (preview is None or not any("scenariostable" in t.lower() for t in live_tables)):
        sys.stderr.write(
            "Refusing --dashboards all: the live stack of this name exists, and its dashboards cannot be attributed "
            "here (its template is not JSON, or it has no Scenarios table in this Region), so all would take them. "
            "Use --dashboards stack. No changes were made.\n"
        )
        return 2
    # The live stack's dashboards are previewed, never deleted, even under --dashboards all.
    previewed = {item["name"] for item in preview or []}
    dashboards = [d for d in dashboards if d["name"] not in previewed]
    kms_keys = find_customer_kms_keys(boto3, prefix, args.region, skipped)

    # Container Insights log groups, the API Gateway CloudWatch role, and the ECR
    # pull through cache repositories also come from the deleted generations' rows.
    owned = {"records": records, "insights": [], "roles": [], "roles_skipped": [], "repositories": []}
    if owned["records"]:
        owned["insights"] = find_container_insights_groups(boto3, args.region, records, live_names, skipped, owns)
        owned["roles"], owned["roles_skipped"] = find_api_cloudwatch_roles(
            boto3, args.region, records, live_names, skipped, other, owns
        )
        owned["repositories"] = find_pull_through_repositories(boto3, args.region, owned["records"])
    owned["other"] = other
    owned["preview"] = preview

    # The search by name is report-only. It runs under --prefix, and for a stack
    # with no deleted generation left in ListStacks.
    possible = {"buckets": [], "tables": [], "log_groups": []}
    if args.prefix or not records:
        known = live_names | {item["name"] for item in buckets + tables + log_groups}
        possible["buckets"] = find_buckets(boto3, bucket_prefix, args.region, skipped, args.stack_name)
        possible["tables"] = find_tables(boto3, prefix, args.region)
        possible["log_groups"] = find_log_groups(boto3, prefix, args.region, skipped, args.stack_name)
        possible = {kind: [i for i in items if i["name"] not in known] for kind, items in possible.items()}
    owned["possible"] = possible

    context = {
        "stack_name": args.stack_name,
        "prefix": prefix,
        "bucket_prefix": bucket_prefix,
        "account_id": account,
        "region": args.region,
        "dashboards_mode": dashboards_mode,
        "dashboard_test_ids": sorted(test_ids) if test_ids is not None else None,
        "dashboards_left": len(dashboards_left),
        "delete": args.delete,
    }
    # The --json output and the --plan-out file share this structure, and --plan
    # reads its context and DELETABLE lists back.
    report = {
        "context": context,
        "live_stack_checked": bool(args.stack_name),
        "live_stack_status": stack_status,
        "live_stack_preview": preview,
        "buckets": buckets,
        "tables": tables,
        "log_groups": log_groups,
        "dashboards": dashboards,
        "customer_kms_keys": kms_keys,
        "skipped": skipped,
        "deleted_stack_records": [{k: r[k] for k in ("stack_id", "created", "deleted")} for r in records],
        "container_insights_log_groups": owned["insights"],
        "iam_roles": owned["roles"],
        "iam_roles_skipped": owned["roles_skipped"],
        "ecr_repositories": owned["repositories"],
        "other_retained": other,
        "possible_leftovers": possible,
    }
    if reviewed is not None:
        # Narrows each deletable list in place, so the printed plan and the deletes cover only the reviewed items.
        missing, unplanned = apply_plan(report, reviewed)

    if args.json:
        print(json.dumps(report, indent=2, default=str), file=json_out or sys.stdout)
    else:
        print_plan(context, buckets, tables, log_groups, dashboards, kms_keys, skipped, stack_status, owned)
    if args.plan_out:
        # A new private file only: O_EXCL refuses an existing path, and with O_NOFOLLOW, any symlink.
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(args.plan_out, flags, 0o600)
        except OSError as exc:
            sys.stderr.write(f"Cannot write the plan to {args.plan_out}: {exc.strerror}. Name a new file.\n")
            return 2
        with os.fdopen(descriptor, "w") as handle:
            json.dump(report, handle, indent=2, default=str)
        (sys.stderr if args.json else sys.stdout).write(
            f"\nWrote the plan to {args.plan_out}. After review, pass it to --delete with --plan.\n"
        )
    if reviewed is not None:
        print(f"\nReviewed plan {args.plan}: only its items that still exist and still match by exact ID are deleted.")
        for entry in missing:
            print(f"  - gone or changed since the plan, skipped: {entry}")
        if unplanned:
            print(f"  - {unplanned} item(s) matched now but are not in the plan, left alone")

    total = sum(len(report[key]) for key in DELETABLE)
    # Everything else in the plan is reported and never deleted.
    review = len(kms_keys) + len(skipped) + len(owned["roles_skipped"]) + len(other)
    review += sum(len(items) for items in possible.values())
    if not args.delete:
        if not args.json:
            how = "--delete" if args.stack_name else "--stack-name and --delete"
            print(
                f"\nDry run only. {total + review} item(s) reported: {total} matched for deletion "
                f"(re-run with {how} to remove them) and {review} listed but never deleted."
            )
            if preview:
                print(
                    f"The stack delete will leave {len(preview)} more item(s), shown as a preview. "
                    "Run the tool again after the stack delete to plan their removal."
                )
        return 0

    unread = [item for item in skipped if item.get("read_error")]
    if total == 0:
        print("\nNothing to delete.")
        return finish(args.plan, unread)

    if not args.yes and not confirm_interactively(args.stack_name):
        sys.stderr.write("Confirmation was not given. No changes were made.\n")
        return 4

    print("\nDeleting...")
    deleted = {
        "buckets": 0,
        "tables": 0,
        "log_groups": 0,
        "dashboards": 0,
        "roles": 0,
        "repositories": 0,
    }
    failures, held = [], []

    # Only the retained Scenarios table attributes a dashboard to the stack, so
    # delete the dashboards before the tables, and keep the table of a generation
    # whose dashboard delete failed.
    cw = boto3.client("cloudwatch", region_name=args.region)
    dashboards_failed = set()
    for i in range(0, len(dashboards), 100):  # DeleteDashboards accepts up to 100 names.
        chunk = [d["name"] for d in dashboards[i : i + 100]]
        try:
            cw.delete_dashboards(DashboardNames=chunk)
            deleted["dashboards"] += len(chunk)
            for n in chunk:
                print(f"  dashboard deleted: {n}")
        except Exception as exc:
            print(f"  dashboards FAILED: {chunk}: {exc}")
            failures.extend(f"dashboard {n}" for n in chunk)
            dashboards_failed.update(d.get("stack_id") for d in dashboards[i : i + 100])

    # The scenarios and console buckets send their server access logs to the logs
    # bucket, so delete the logs bucket last, and hold it while another retained
    # bucket of its generation still exists and may log to it, whatever kept that
    # bucket. Its generated name keeps "commonresources" (hub
    # DLTCommonResourcesLogsBucket, regional CommonResourcesLogsBucket) even when
    # CloudFormation truncates the logical part.
    s3 = boto3.client("s3", region_name=args.region)
    retained_buckets = {r["stack_id"]: physical_ids(r["resources"], "AWS::S3::Bucket") for r in records}
    gone = set()
    for b in sorted(buckets, key=lambda bucket: LOGS_BUCKET_HINT in bucket["name"]):
        logs_bucket = LOGS_BUCKET_HINT in b["name"]
        others = [n for n in retained_buckets.get(b.get("stack_id"), ()) if n != b["name"] and n not in gone]
        source = logs_bucket and logging_source(s3, b["name"], others)
        if source:
            print(
                f"  bucket HELD   : {b['name']}: bucket {source} still exists and may log here; delete it, "
                "or turn off its server access logging"
            )
            held.append(f"bucket {b['name']}, because bucket {source} still exists and may log to it")
            continue
        try:
            purge_and_delete_bucket(boto3, b["name"], args.region, retry=logs_bucket)
            gone.add(b["name"])
            deleted["buckets"] += 1
            print(f"  bucket deleted: {b['name']}")
        except Exception as exc:
            print(f"  bucket FAILED : {b['name']}: {exc}")
            failures.append(f"bucket {b['name']}")

    ddb = boto3.client("dynamodb", region_name=args.region)
    for t in tables:
        if t.get("stack_id") in dashboards_failed and "scenariostable" in t["name"].lower():
            print(f"  table HELD    : {t['name']}: it attributes the dashboards that failed to delete")
            held.append(f"table {t['name']}, because it attributes the dashboards that failed to delete")
            continue
        try:
            ddb.delete_table(TableName=t["name"])
            deleted["tables"] += 1
            print(f"  table deleted : {t['name']}")
        except Exception as exc:
            print(f"  table FAILED  : {t['name']}: {exc}")
            failures.append(f"table {t['name']}")

    logs = boto3.client("logs", region_name=args.region)
    for g in log_groups + owned["insights"]:
        try:
            logs.delete_log_group(logGroupName=g["name"])
            deleted["log_groups"] += 1
            print(f"  log group deleted: {g['name']}")
        except Exception as exc:
            print(f"  log group FAILED : {g['name']}: {exc}")
            failures.append(f"log group {g['name']}")

    if owned["roles"]:
        iam = boto3.client("iam", region_name=args.region)
        for r in owned["roles"]:
            try:
                delete_role(iam, r)
                deleted["roles"] += 1
                print(f"  IAM role deleted: {r['name']}")
            except Exception as exc:
                print(f"  IAM role FAILED : {r['name']}: {exc}")
                failures.append(f"IAM role {r['name']}")

    if owned["repositories"]:
        ecr = boto3.client("ecr", region_name=args.region)
        for r in owned["repositories"]:
            try:
                ecr.delete_repository(repositoryName=r["name"], force=True)
                deleted["repositories"] += 1
                print(f"  ECR repository deleted: {r['name']}")
            except Exception as exc:
                print(f"  ECR repository FAILED : {r['name']}: {exc}")
                failures.append(f"ECR repository {r['name']}")

    print(
        "\nSummary: "
        f"{deleted['buckets']} bucket(s), {deleted['tables']} table(s), "
        f"{deleted['log_groups']} log group(s), {deleted['dashboards']} dashboard(s), "
        f"{deleted['roles']} IAM role(s), {deleted['repositories']} ECR repositories."
    )
    print("Run again in dry-run mode to confirm that no DLT resources remain.")
    return finish(args.plan, unread, failures, held)


def build_parser():
    parser = argparse.ArgumentParser(
        description="Enumerate and optionally delete resources a DLT stack retains on delete.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--stack-name",
        help="The DLT stack name. Its deleted generations give the exact IDs to remove. In a spoke Region, pass the regional stack's name.",
    )
    parser.add_argument(
        "--prefix",
        help="Also list possible leftovers whose names start with this prefix, for review only. They are never deleted.",
    )
    parser.add_argument("--region", required=True, help="AWS Region to operate in. Run once per Region.")
    parser.add_argument(
        "--delete",
        action="store_true",
        help="Delete what the reviewed --plan FILE lists. Without this, the tool only lists.",
    )
    parser.add_argument(
        "--stack-id",
        help=(
            "Act on one deleted generation of --stack-name, given by its stack ID or the ID's UUID. "
            "Without it, the plan covers every deleted generation in this Region's ListStacks."
        ),
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the interactive confirmation prompt. An agent passes it only when the user asks the agent to run "
        "the delete and has approved the plan.",
    )
    parser.add_argument("--json", action="store_true", help="Emit the plan as JSON.")
    parser.add_argument(
        "--plan-out",
        metavar="FILE",
        help=(
            "Dry run only: also write the plan as JSON to FILE, with the caller's account ID, the Region, the stack "
            "name, the dashboards mode and test IDs, and each item's generation stack ID, for review and for --plan. "
            "FILE must not exist yet. The tool creates it with mode 0600 and never follows a symlink."
        ),
    )
    parser.add_argument(
        "--plan",
        metavar="FILE",
        help=(
            "With --delete: delete only the items that the reviewed plan FILE from --plan-out lists and that still "
            "exist and still match by exact ID, and report the rest. Refuses, with exit code 2, when the plan's "
            "account ID, Region, stack name, or dashboards mode differs from this run's. Required with every "
            "--delete, on a terminal or not."
        ),
    )
    parser.add_argument(
        "--dashboards",
        choices=("stack", "all", "skip"),
        default="stack",
        help=(
            "Which EcsLoadTesting-* dashboards to remove: stack (default) takes only those whose test ID is in the "
            "stack's retained Scenarios table in this Region; all takes every one in the Region; skip takes none."
        ),
    )
    parser.add_argument(
        "--skip-dashboards",
        action="store_true",
        help="Same as --dashboards skip.",
    )
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    if not args.stack_name and not args.prefix:
        sys.stderr.write("Provide --stack-name (preferred) or --prefix.\n")
        return 2
    if args.delete and not args.stack_name:
        sys.stderr.write(
            "Refusing to delete: --delete needs --stack-name. With --prefix alone the tool matches by name only "
            "and cannot check for a live stack, so use --prefix for dry runs.\n"
        )
        return 2
    # Required on a terminal too: an agent client's pseudo-terminal passes isatty(), so only the plan is a real gate.
    if args.delete and not args.plan:
        sys.stderr.write(
            "Refusing to delete: --delete acts only on a reviewed plan, on a terminal or not. Write the plan with a "
            "dry run and --plan-out <file>, show it to the user, and ask them to run --delete --plan <file> in "
            "their own terminal. No changes were made.\n"
        )
        return 2
    if args.stack_id and not args.stack_name:
        sys.stderr.write("--stack-id needs --stack-name.\n")
        return 2
    if args.plan and not args.delete:
        sys.stderr.write("--plan needs --delete. A dry run writes a plan with --plan-out.\n")
        return 2
    if args.plan_out and args.delete:
        sys.stderr.write("--plan-out is for a dry run. Pass the reviewed file to --delete with --plan.\n")
        return 2
    if args.plan_out and os.path.lexists(args.plan_out):
        sys.stderr.write(f"--plan-out {args.plan_out} already exists. Name a new file in a new mktemp -d directory.\n")
        return 2
    try:
        if not args.json:
            return run(args)
        # Under --json, stdout carries only the JSON document, and every other line goes to stderr.
        json_out = sys.stdout
        with contextlib.redirect_stdout(sys.stderr):
            return run(args, json_out)
    except KeyboardInterrupt:
        sys.stderr.write("\nInterrupted. No further changes were made.\n")
        return 130


if __name__ == "__main__":
    sys.exit(main())
