# Supported Regions and Version Compatibility

This reference is verified against the DLT solution source: `solution-manifest.yaml`, `launch-wizard-config.json`, `regional-compatibility.json`, `README.md`, `CHANGELOG.md`, and `source/infrastructure`. Version numbers reflect the source at the time of writing; always confirm against the solution implementation guide and the repository for the exact release you are deploying.

## Solution Identity

- **Solution ID:** SO0062
- **Releases covered:** v4.3.0 through v4.3.4. v4.3.0 was released 2026-09-24 and v4.3.4 on 2026-10-28. v4.3.0 added the Native traffic-shape mode, Locust dependency installs, MCP write operations, and CLI test management, and it raised the regional compatibility floor to `4.3.0` (see below). The v4.3.1 through v4.3.4 patches fix defects and update dependencies, and they keep the floor at `4.3.0`.
- **Delivery:** AWS CloudFormation templates generated from AWS CDK v2.

## The Templates

DLT ships three main templates plus one regional (spoke) template. All three main templates are "main" deployments; the regional template is a dependent, per-Region capacity stack.

| Template file | Role | Web console hosting | Introduced |
| --- | --- | --- | --- |
| `distributed-load-testing-on-aws.template` | Main (default) | CloudFront and S3 | Long-standing |
| `distributed-load-testing-on-aws-alb-ecs.template` | Main (alternative) | Application Load Balancer with ECS Fargate (nginx) | v4.1.0 |
| `distributed-load-testing-on-aws-headless.template` | Main (API only) | None hosted; the stack writes the console assets to a bucket (`ConsoleAssetsBucket` output) for you to host yourself | v4.1.0 |
| `distributed-load-testing-on-aws-regional.template` | Regional (spoke) | Not applicable; testing infrastructure only | Multi-Region since v3.0.0 |

Choosing among the three main variants is mostly a hosting decision, and the solution implementation guide covers it in depth. Most Regions suit the default CloudFront template. The ALB with ECS template is for Regions or network postures where the CloudFront-hosted console is not appropriate. It requires a fully qualified console domain name and an ACM certificate in the same Region as the stack. Headless deployments host no console and are driven by the CLI and MCP workflows.

## Supported Regions

DLT publishes and tests against a fixed Region set. Deploying to a Region outside this set commonly fails with a template error such as `Unrecognized resource types: [AWS::CDK::Metadata]`, because the solution template is only published and validated for supported Regions. The following commercial Regions are listed in the solution's `launch-wizard-config.json` for every v4.3.x release:

| Region code | Location |
| --- | --- |
| us-east-1 | N. Virginia |
| us-east-2 | Ohio |
| us-west-1 | N. California |
| us-west-2 | Oregon |
| ca-central-1 | Canada Central |
| eu-west-1 | Ireland |
| eu-west-2 | London |
| eu-west-3 | Paris |
| eu-central-1 | Frankfurt |
| eu-north-1 | Stockholm |
| ap-south-1 | Mumbai |
| ap-northeast-1 | Tokyo |
| ap-northeast-2 | Seoul |
| ap-southeast-1 | Singapore |
| ap-southeast-2 | Sydney |
| sa-east-1 | Sao Paulo |

Notes:

- A Region not on this list, for example `ap-southeast-5` (Malaysia), is expected to fail at template validation. Deploy to a supported Region instead.
- The authoritative list for a given release is the implementation guide and the per-version `regions` arrays in `launch-wizard-config.json`. Treat the table above as a snapshot, not a contract.
- Opt-in Regions must be enabled in the account before you deploy. v3.2.6 fixed a historical defect with running tests in opt-in Regions.
- The container image URI parameters (see below) support private-registry and GovCloud deployments. `WebConsoleImageUri` dates from v4.1.0, `LoadTesterImageUri` from v4.2.0, and the per-framework image parameters from v4.3.0.

## Version-Compatibility Rules for Hub and Spoke Stacks

Multi-Region load testing uses one hub (main) stack and one regional (spoke) stack per additional Region. Before a test runs, the hub enforces two rules against each regional stack:

1. **Floor:** the regional stack version must be greater than or equal to the `minimumCompatibleVersion` in `regional-compatibility.json`. The value is `4.3.0` from v4.3.0 onward; v4.1.0 through v4.2.6 used `4.1.0`.
2. **Ceiling:** the regional stack version must be less than or equal to the hub stack version. This enforces a hub-first upgrade order, because the hub generates the regional CloudFormation template.

If a test targets an incompatible Region, the API rejects the request with HTTP 400 and `Incompatible regional stacks: <region>: <reason>`. The reason names the version that is below the floor or newer than the hub. For an existing scenario the API also writes a failed test run to the history table, so the incompatibility is visible in the web console rather than silent. v4.1.0 added the version-compatibility check and the in-console incompatibility banner.

**The v4.3.0 floor makes the hub upgrade an all-Regions upgrade.** Once the hub is on v4.3.0, every regional stack still on v4.2.x is below the floor. Until you redeploy each spoke from the template the upgraded hub generates, the hub rejects tests that target those Regions. Schedule the hub and every spoke in the same change window.

**Upgrade order:** always deploy or upgrade the hub first, then redeploy the regional stacks so they pick up the template the upgraded hub generates. Existing regional stacks do not upgrade themselves; redeploy them to pick up changes.

**When the floor moves:** a release raises the `minimumCompatibleVersion` when it changes something that requires redeploying the regional stacks. Examples are the ECS task definition, the container image or the load-test entrypoint, ECS cluster configuration, networking resources, and the DynamoDB schema that the regional custom resource writes.

## Supported CloudFormation Update Paths

The solution's Launch Wizard metadata (`updatableFrom` in `launch-wizard-config.json`) declares the supported in-place update paths per template. These are the paths validated for v4.3.0:

| Template | In-place update to v4.3.0 supported from |
| --- | --- |
| Default (CloudFront) | v4.0.2 through v4.2.6 |
| ALB with ECS | v4.1.0 through v4.2.6 (template introduced in v4.1.0) |
| Headless | v4.1.0 through v4.2.6 (template introduced in v4.1.0) |

Each v4.3.x patch extends the range. v4.3.4 accepts in-place updates from v4.0.2 (default) or v4.1.0 (ALB with ECS and headless) through v4.3.3, so a v4.3.0 stack updates in place to any later v4.3.x release. Because the floor stays at `4.3.0`, v4.3.0 regional stacks stay compatible with a v4.3.4 hub.

After the hub update completes, redeploy every regional stack, because the v4.3.0 compatibility floor rejects v4.2.x spokes.

Hard breaking boundaries from the changelog:

- **v2.0.0** does not support upgrading from earlier versions.
- **v3.0.0** does not support upgrading from earlier versions.
- **v3 to v4** is a major change (UI rewrite, task-orchestration rewrite, ARM64 Lambda migration). The default template supports the in-place path from v4.0.2 forward, and v4 ships a `V3toV4BackCompat` custom resource to migrate scheduled-test payloads on first create. See the v3 to v4 delta rows in `failure-signatures.md`.

## Deployment-Time Parameters That Affect Triage

These parameters come from `source/infrastructure/lib/common-resources/parameter-spec.ts`, the single source of truth for both the CloudFormation constraints and the Launch Wizard validation.

| Parameter | Allowed values / default | Relevance to deploy triage |
| --- | --- | --- |
| `UseStableTagging` | `Yes` or `No`; default `No` | `Yes` pulls the most recent patched image up to the next minor release; `No` pulls the image exactly as originally released. A mismatch with expectations can look like a stale image. |
| `LoadTesterImageUri` | Empty, or a valid ECR URI; default empty | Empty uses the default public image. A wrong or unreachable private URI causes an ECR image-pull failure on the ECS task. It was added in v4.2.0 for private-registry and GovCloud use. |
| `LocustLoadTesterImageUri`, `K6LoadTesterImageUri`, `JMeterLoadTesterImageUri` | Empty, or a valid ECR URI; default empty | These per-framework images run Native mode tests, while `LoadTesterImageUri` (Taurus) runs every Standard mode test. They were added in v4.3.0. A private-registry deployment must mirror these too, or every Native run fails at image pull. |
| `WebConsoleImageUri` | Empty, or a valid ECR URI; default empty | This is the ALB with ECS console image. Empty uses the default public image. |
| `ExistingVPCId`, `ExistingSubnetA`, `ExistingSubnetB` | Empty, or a matching id | If you bring your own VPC, all must be valid; malformed ids fail template validation. |
| `VpcCidrBlock`, `SubnetACidrBlock`, `SubnetBCidrBlock`, `EgressCidr` | Valid IPv4 CIDR | Malformed CIDR fails validation. |
| `ConsoleDomainName`, `ACMCertificateArn` | FQDN and ACM ARN (ALB with ECS) | The certificate must be in the same Region as the stack and match the domain name. |
| `DeployWAF` | `Yes` or `No`; default `Yes` (ALB with ECS) | It deploys an AWS WAF WebACL on the load balancer. |
| `DeployMCPServer`, `MCPServerAccessMode` | `Yes`/`No` default `No`; `ReadOnly`/`ReadWrite` default `ReadOnly` | Optional MCP server. `MCPServerAccessMode` and the write tools it enables were added in v4.3.0; earlier MCP servers are read-only. It rarely causes a deploy failure. |

The ECR image URI parameters accept either an empty string (default public image) or a fully formed ECR image URI of the form `123456789012.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>` or `.../<repo>@sha256:<64-hex-chars>`. Each parameter's allowed pattern rejects any other value.
