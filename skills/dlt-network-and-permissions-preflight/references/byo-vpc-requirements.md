# Bring-your-own VPC requirements for DLT load generators

What a customer-supplied VPC must satisfy before DLT can run load generators in
it, why each requirement exists, and how each one fails when it is not met. This
is the reference behind Check 3b in the skill and behind `scripts/validate_vpc.py`.

Every statement here is grounded in the solution source, cited inline so you can
re-verify it when a deployment behaves unexpectedly.

## Where the VPC comes from

A scenario does not carry a VPC. The customer supplies one **at deploy time**
through the `ExistingVPCId`, `ExistingSubnetA`, and `ExistingSubnetB` template
parameters, per stack. The hub stack covers its own Region; each spoke stack
covers one more.

The deployed values are recorded in the solution's scenarios DynamoDB table, in
the item whose `testId` is `region-<region>`, alongside the task cluster and the
task security group. At run time the API merges that record into each entry of
the scenario's `testTaskConfigs`, so the subnets a run actually uses come from the
regional stack, not from the create-test payload
(`source/api-services/lib/scenarios/index.js`, `getRegionInfraConfigs` and
`getTestAndRegionConfigs`; `source/common/src/scenarios/schema.ts`, whose
`testTaskConfigSchema` carries `subnetA`, `subnetB`, and `taskSecurityGroup`).

Two consequences worth stating to a customer:

- **The check is per Region.** A multi-Region test can have a healthy hub VPC and
  a broken spoke VPC, and only the spoke's tasks fail.
- **Fixing it means redeploying that stack.** There is no per-scenario override.

## What the solution does with the VPC, and what that forces

| DLT behaviour | Source | What it forces on your VPC |
|---|---|---|
| Creates one ECS service per Region with `awsvpc` networking, placing tasks in the two subnets | `source/task-runner/src/service.ts` | Each task attaches one ENI and consumes **one private IP** from a subnet |
| Sets `assignPublicIp: ENABLED`, unconditionally, with no parameter to disable it | `source/task-runner/src/service.ts` | The subnets need a route to an **internet gateway**. A public IP is useless without one |
| Creates the task security group **in the VPC you named** | `source/infrastructure/lib/testing-resources/ecs.ts`, `DLTEcsSecurityGroup` with `vpcId: props.fargateVpcId` | Both subnets must belong to that same VPC, or ECS rejects the service |
| Creates the service with a deployment circuit breaker, rollback disabled | `source/task-runner/src/service.ts` | A network fault surfaces as a stuck `provisioning` state, not a clear error |
| Sets `availabilityZoneRebalancing: DISABLED` | `source/task-runner/src/service.ts` | ECS will not spread tasks across zones for you |
| Its own VPC uses two subnets in **different** AZs, `Fn.select(0, Fn.getAzs())` and `Fn.select(1, ...)` | `source/infrastructure/lib/testing-resources/vpc.ts` | Two zones is the shape the solution is designed and tested against |
| Its own VPC sets `enableDnsSupport` and `enableDnsHostnames` | `source/infrastructure/lib/testing-resources/vpc.ts` | DNS resolution must work for ECR, S3, CloudWatch Logs, and a hostname target |
| Its own VPC has an internet gateway and a `0.0.0.0/0` route, and **no NAT gateway** | `source/infrastructure/lib/testing-resources/vpc.ts` | Direct internet egress is the assumed model |

## The requirements, in the order they bite

### 1. Both subnets, or neither

If `ExistingVPCId` is non-empty, both `ExistingSubnetA` and `ExistingSubnetB`
must also be non-empty. This is enforced at deploy time by the `ExistingVPCRule`
CloudFormation rule in both the base and regional stacks
(`distributed-load-testing-on-aws-base-stack.ts`,
`distributed-load-testing-on-aws-regional-stack.ts`), whose assertion messages
name the missing subnet.

**Fails as:** the stack refuses to deploy, with a message about neglecting to
enter the first or second subnet id. This one is at least legible.

The parameters are validated only against `^vpc-[a-zA-Z0-9-]+$` and
`^subnet-[a-zA-Z0-9-]+$` (`common-resources/parameter-spec.ts`). Nothing at
deploy time checks that the ids exist, that they are in the same VPC, or that they
route anywhere. Everything below is therefore your responsibility, and nothing
tells you it is wrong until tasks fail to start.

### 2. Both subnets must be in the named VPC

The task security group is created in `ExistingVPCId`. ECS `CreateService`
requires the security group and the subnets to be in one VPC.

**Fails as:** `CreateService` throws an `InvalidParameterException` about the
security group and subnets belonging to different VPCs. The run fails early,
before any task starts. The task-runner Lambda log has the raw error, and the
console shows an `errorReason` that names the Region and the cause, for example
"Load test setup failed in 1 region: us-west-2 (The test could not start due to
a networking configuration issue (subnets, security groups, or available IP
addresses). Check the VPC configuration for the affected region.)."

### 3. Each subnet needs a default route to an internet gateway

DLT always assigns a public IP, and there is no parameter to turn that off. The
shape the solution ships and tests is an internet gateway with a `0.0.0.0/0`
route, which is what its own VPC builds.

A subnet with **no** default route cannot reach Amazon ECR, so its tasks never
start. That is a hard failure.

A subnet whose default route is a **NAT gateway or a transit gateway** is a
different case, and worth being precise about rather than dismissing. It is not
the configuration DLT is built around, and because `assignPublicIp` is forced on,
the interaction between the assigned public IP and a non-gateway route is not
something this skill can promise for you. Treat it as unverified: prove the tasks
reach ECR, S3, and CloudWatch Logs on that path before relying on it. The
validator reports it as a warning for that reason, not as a failure.

For the private-VPC remedies themselves, including NAT gateways and VPC
endpoints, follow Check 4 in the skill and
[references/egress-path-matrix.md](egress-path-matrix.md), which own that
guidance. Nothing here overrides them.

**Fails as:** tasks never reach `RUNNING`. ECS retries, the circuit breaker trips,
and the run sits in `provisioning` until the stabilization timeout at 30 minutes.
The ECS service events carry a `CannotPullContainerError`; the DLT console shows
none of it. See Check 4 in the skill and [[dlt-diagnose-run]].

### 4. Enough free IP addresses for the task count

One task is one ENI is one private IP, drawn from a subnet. The public IP comes
from an Amazon-managed pool and does not draw from the subnet.

DLT's own `/20` subnets leave 4091 usable addresses each, about 8000 across the
pair. A bring-your-own `/24` leaves 251, and a `/26` leaves 59, less whatever else
already lives there.

Count each subnet on its own. ECS spreads a service's tasks across the subnets'
Availability Zones, so each subnet needs its even share of the task count, rounded
up. A pair with enough addresses in total still fails when one subnet is small.

**Fails as:** a stuck `provisioning` state with
`InsufficientFreeAddressesInSubnet` in the ECS service events. Identical
symptom to requirement 3, different event. See Check 3 in the skill for the
capacity arithmetic and [[dlt-capacity-and-region-planning]] for sizing.

### 5. VPC DNS resolution must be on

`enableDnsSupport` off means the tasks cannot resolve ECR, S3, CloudWatch Logs,
or a target given by hostname. `enableDnsHostnames` off is less severe but is
still a departure from the VPC the solution builds for itself.

**Fails as:** image pull or log delivery failures that read like connectivity
problems, or a run that starts and then reports every request failed with a DNS
error.

### 6. Fargate must exist in the subnets' zones

AWS Fargate is not offered in Local Zones, Wavelength Zones, or on Outposts. A
subnet in one of those cannot place a task no matter how correct the rest of the
VPC is.

**Fails as:** tasks that never place, with a capacity or unsupported-configuration
error in the service events.

### 7. Two Availability Zones is the intended shape

Not a hard requirement, and DLT will run with both subnets in one zone. Worth
flagging anyway: the solution's own VPC uses two zones, the service is created
with zone rebalancing disabled, and a single-zone pair concentrates every task and
every ENI in one zone, which lowers the ceiling and removes the zone-failure
margin the design assumes.

**Shows up as:** capacity that runs out sooner than the subnet CIDRs suggest, or a
whole run lost to one zone's problems.

### 8. The security group's egress must reach everything a task needs

DLT creates a single egress rule from the `EgressCidr` parameter, default
`0.0.0.0/0` (`common-resources/parameter-spec.ts`). Narrowing it is legitimate,
but every destination has to fall inside it: ECR, S3, CloudWatch Logs, the
framework download where one applies, and your target. See
[references/egress-path-matrix.md](egress-path-matrix.md) for the full matrix.

## Checking it

`scripts/validate_vpc.py` checks requirements 2 through 8 against the live VPC
using read-only EC2 describe calls. Requirement 1 is enforced by CloudFormation
before anything else runs. In the command, `<skill-dir>` is the skill directory,
which contains `SKILL.md`.

```bash
python3 -I <skill-dir>/scripts/validate_vpc.py --region us-west-2 \
  --vpc-id vpc-0123456789abcdef0 \
  --subnet-a subnet-0aaa... --subnet-b subnet-0bbb... \
  --tasks 200 --security-group sg-0ccc...
```

Take the values from the Region's own config record so you check what a run will
really use, rather than what someone believes was deployed:

```bash
aws dynamodb get-item --region <hub-region> \
  --table-name <scenarios-table> \
  --key '{"testId":{"S":"region-us-west-2"}}' \
  --query 'Item.[subnetA,subnetB,taskSecurityGroup]'
```

Exit code 0 means every requirement is met and 1 means at least one is not,
including naming the same subnet twice, which is a misconfiguration rather than a
failure to run. Exit code 2 means the checks could not be completed: a missing
VPC, a describe call that was denied, throttled, or failed for any other reason
than a missing resource, or a usage error such as a missing argument or a
`--tasks` value below 1. The report names each check that could not run and why.

Two limits worth knowing before you trust a clean result:

- The script cannot resolve what a **managed prefix list** or a **peer security
  group** actually permits, so an egress rule granted that way is reported as a
  warning for you to confirm by hand rather than as a pass.
- `AvailableIpAddressCount` is a point-in-time reading. Another workload can
  consume addresses between the check and the run, so hold back headroom per
  Check 3 rather than sizing to the exact free count.
