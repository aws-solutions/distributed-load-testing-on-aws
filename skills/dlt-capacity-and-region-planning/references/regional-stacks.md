# Deploying and versioning DLT regional stacks

This file is the reference for the `dlt-capacity-and-region-planning` skill. It covers how a Distributed Load Testing on AWS (DLT) scenario reaches multiple Regions and how to deploy the regional (spoke) stacks that make a Region usable. A later section covers the version rules the hub enforces before a test runs.

## Hub and Regional Stacks

DLT deploys as a hub stack in one Region. The hub hosts the web console, the API, the orchestration, and the results storage, and it also builds the regional CloudFormation template. To generate load from any additional Region, deploy a regional (spoke) stack there. A regional stack contains only the testing infrastructure: the ECS cluster, IAM roles, the CloudWatch log group, networking, and the real-time data publisher that forwards live metrics. It does not create a task definition, because the hub's task definition is the single source of truth for container shape and the task runner reads it at test time.

A Region is usable in a scenario only after its regional stack is deployed and has registered itself with the hub. Registered Regions appear in the web console and in the `GET /regions` response. Any scenario that references a Region with no registered stack fails at create or start time; [Removing a Region](#removing-a-region) lists the error each client gets.

## Getting the Regional Template

The hub publishes the regional template URL two ways:

- **`RegionalCFTemplate` stack output.** The hub stack exports an output named `<hub-stack-name>-RegionalCFTemplate`. It is an S3 URL to `regional-template/distributed-load-testing-on-aws-regional.template` in the solution's scenarios bucket.
- **`GET /regions` response.** The API returns the registered regional configurations and the same template URL, so tooling can surface it without reading CloudFormation outputs directly.

## Deploying a Regional Stack

There are two paths depending on whether the customer is deploying the published solution or working from a source checkout. Either path creates billable resources, so get the user's explicit approval of the Region, the account, and the hub stack before you deploy.

**Published solution (console or CloudFormation).** Deploy the regional template URL as a new CloudFormation stack in each additional Region. Point CloudFormation at the `RegionalCFTemplate` URL, choose the target Region, and create the stack. The stack registers itself with the hub on completion.

**Source checkout.** From a solution source checkout at the same version as the hub, one command builds the regional stack from the checkout and deploys it:

```bash
make regional-deploy REGION=us-west-2
```

Repeat per Region:

```bash
make regional-deploy REGION=eu-west-1
make regional-deploy REGION=ap-southeast-1
```

The `regional-deploy` target bootstraps CDK in the target Region if needed, builds the regional stack from the checkout, and reads the outputs of the hub stack named by `MAIN_STACK_NAME` in the hub Region named by `TARGET_REGION` in `.env`. Use a checkout at the same version as the hub, because a regional stack newer than the hub is rejected. You can instead list the Regions in `REGIONAL_STACKS` in `.env` and run `make regional-deploy` with no argument. Deploy the hub (main) stack before any regional stack.

Deploy regional stacks only to Regions other than the hub's. The hub stack already provides the testing resources for its own Region. A regional stack in the hub Region overwrites the hub's Region record in the scenarios table without the hub's task definitions, which breaks test runs until the hub stack is updated again, and deleting that regional stack removes the hub Region from the Region list.

## Version Compatibility

Before a test runs, the hub validates the version of each regional stack the scenario targets, and it enforces two rules:

1. The regional stack version must be greater than or equal to the `minimumCompatibleVersion` declared in `regional-compatibility.json` at the solution root. That minimum is `4.3.0` from v4.3.0 on (it was `4.1.0` from v4.1.0 through v4.2.6). A hub upgraded to v4.3.0 therefore rejects every test that targets a regional stack still on v4.2.x or earlier, until that regional stack is also upgraded to v4.3.0.
2. The regional stack version must be less than or equal to the hub stack version. This enforces a hub-first upgrade order, because the hub builds the regional template that the spokes deploy.

The hub compares version strings at the major.minor.patch level and ignores any suffix after the patch number, so `v4.1.0-rc1` and `v4.1.0` compare as equal.

If a test targets an incompatible Region, the API rejects the request with a descriptive reason and writes a failed test run into the history table. The failure therefore shows in the web console instead of passing silently. Typical reasons:

- "Regional stack version X is below minimum required version Y." Redeploy that regional stack from the current template.
- "Regional stack version X is newer than hub version Y. Upgrade the hub stack first." After the hub upgrade, redeploy the regional stacks.

## Upgrade Order and When Compatibility Breaks

Always deploy or upgrade the hub stack first, or at the same time as the regional stacks. The hub generates the regional template, so regional stacks deployed after a hub upgrade pick up the latest template. Existing regional stacks deployed before the upgrade must be redeployed to pick up the changes.

The solution bumps `minimumCompatibleVersion` when a release changes something that requires redeploying regional stacks. Examples are the ECS task definition, the container image or the `load-test.sh` entrypoint, ECS cluster configuration, networking resources, and the DynamoDB schema written by the regional custom resource. v4.3.0 is such a release, so it raised the minimum to `4.3.0`. When a customer upgrades the hub across such a release, plan to redeploy every regional stack in the same maintenance window. Tests that target a Region whose stack is not yet upgraded fail until it is.

## Removing a Region

If a regional stack is deleted or a Region is decommissioned, remove that Region from any scenario that references it. A scenario that names a Region with no registered regional stack fails at create or start time, whether the stack was deleted or never deployed, and the error depends on the client. The InvalidRegionalStack message says "no longer exists" in both cases:

- The console and the MCP tools get InvalidRegionalStack ("The regional stack for "<Region>" no longer exists. Please remove this region from the scenario or redeploy the regional stack.").
- `dlt scenarios start` stops before it calls the API with "No Fargate vCPU details available for region <Region>."
- `dlt scenarios create`, `update`, and `copy` get InvalidRegionRequest ("The region requested does not have a stored infrastructure configuration.") on v4.3.0 and v4.3.1. On v4.3.2 and later, a create that starts a run gets InvalidRegionalStack, and a save-only create, an update, or a copy still gets InvalidRegionRequest.

It keeps failing until you remove the Region from the scenario or redeploy its stack. From v4.3.0 such a scenario can still be viewed and deleted; earlier versions could leave it stuck, neither viewable nor deletable.
