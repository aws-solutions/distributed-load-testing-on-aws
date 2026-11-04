# Known Deploy and Upgrade Failure Signatures

Each row maps an observed signature to where you see it, the likely cause, and the fix. Signatures are verified against the DLT source: the custom-resource handlers in `source/custom-resource`, the load-tester entrypoint `deployment/ecr/distributed-load-testing-on-aws-load-tester/load-test.sh`, `regional-compatibility.json`, `launch-wizard-config.json`, and `CHANGELOG.md`. Match on the meaning, not the exact wording, because AWS surfaces some messages with its own phrasing.

## Deploy and Region-Expansion Failures

### Unsupported Region: `Unrecognized resource types: [AWS::CDK::Metadata]`

- **Where seen:** the CreateStack call fails, or the first CloudFormation stack event fails, before any solution resource is created. The message names `AWS::CDK::Metadata` or is a generic template validation error.
- **Likely cause:** the target Region is not one DLT publishes and validates for, or it is a very new Region the template's CDK framework does not yet recognize. For example, deploying to `ap-southeast-5` fails this way.
- **Fix:** deploy to a supported Region (see `supported-regions-and-versions.md`). There is no parameter that makes an unsupported Region work; the template must be published for that Region. To generate load from a Region you cannot deploy the hub to, deploy the hub in a supported Region and add supported Regions as spokes.

### Regional Custom Resource: `UUID not supported` (or Any `<resource> not supported`)

- **Where seen:** a regional (spoke) stack event on a custom resource (`AWS::CloudFormation::CustomResource`) with the reason `See the details in CloudWatch Log Stream: <log stream name>`, and the `UUID not supported` message in the regional custom-resource Lambda's CloudWatch log (`Error in custom resource <resource>: ...`).
- **Likely cause:** the deployed regional custom-resource Lambda is on a version that does not handle the resource type its own template requested. Both custom-resource handlers throw `<resource> not supported` from the default branch of their switch. This is version skew between hub and spoke. v3.4.3 fixed a real defect of this kind ("Resolve issue with regional templates failing to deploy").
- **Fix:** align versions hub-first. Upgrade the main (hub) stack, then redeploy the regional stack so it uses the template the upgraded hub generates. Confirm the regional version is at or above the `minimumCompatibleVersion` (`4.3.0` from v4.3.0 onward, `4.1.0` before that) and at or below the hub version.

### Regional Stack Version Rejected at Test Time

- **Where seen:** this is not a deploy failure. The API rejects the test request with HTTP 400 and `Incompatible regional stacks: <region>: Regional stack version <x> is below minimum required version <y>` (or `... is newer than hub version <z>. Upgrade the hub stack first.`). For an existing scenario, a failed test run also appears in the web console history.
- **Likely cause:** the regional stack version is below the floor (`minimumCompatibleVersion` in `regional-compatibility.json`) or above the hub version. A common trigger is upgrading the hub to v4.3.0, which raised the floor to `4.3.0`, without redeploying the v4.2.x spokes.
- **Fix:** redeploy the affected regional stacks to a compatible version, hub-first. See the version-compatibility rules in `supported-regions-and-versions.md`.

### SCP or Org Policy Blocks a Required Service; App Errors on Every Route

- **Where seen:** a service resource (`AWS::ApiGateway::*`, `AWS::Cognito::*`, `AWS::ECS::*`, `AWS::IoT::*`, `AWS::IAM::*`, `AWS::Lambda::*`) fails to create with an access or authorization message. Alternatively, the deploy succeeds but the console and API fail on every route. CloudTrail shows `AccessDenied`, often with `explicit deny` and a reference to an organization policy.
- **Likely cause:** a Service Control Policy or permissions boundary in the AWS Organization denies a service the solution depends on.
- **Fix:** use CloudTrail `lookup-events` to identify the denied API call and the policy named in the error message, then request an exception or scope change from the organization administrator. Redeploy after the policy allows the required services.

### Deploy Fails on a Parameter Constraint

- **Where seen:** CreateStack or UpdateStack rejects a parameter before resources are created, citing an allowed pattern or allowed values.
- **Likely cause:** a malformed image URI, VPC or subnet id, CIDR block, FQDN, or ACM ARN. The ECR image URI parameters accept only an empty string or a fully formed ECR URI.
- **Fix:** correct the parameter against the constraints in `supported-regions-and-versions.md`. Use an empty image URI to fall back to the default public image.

## Stack-State Recovery

### `ROLLBACK_COMPLETE` After a Failed Fresh Create

- **Where seen:** CloudFormation StackStatus is `ROLLBACK_COMPLETE`.
- **Likely cause:** any failure during the initial create; the stack cannot be updated from this state.
- **Fix:** this stack never finished creating and holds no data. After fixing the root cause, delete it and deploy again. Deletion is appropriate only for a brand-new stack, never for an existing environment.

### `UPDATE_ROLLBACK_FAILED` During an Upgrade

- **Where seen:** StackStatus is `UPDATE_ROLLBACK_FAILED`.
- **Likely cause:** a resource could not roll back cleanly during a failed update.
- **Fix:** do not delete the stack; it is your existing environment with scenario and history data. Run `continue-update-rollback`, optionally with `--resources-to-skip` for the specific resource that cannot roll back, to return to a stable state, then retry the upgrade after fixing the cause.

## v3 to v4 Upgrade Deltas

### Scheduled Tests Created in v3 Silently Stop Running After v4

- **Where seen:** in the web console the scheduled tests appear never to run; in the backend the EventBridge rule fires but the `POST /scenario` request fails API validation.
- **Likely cause:** v3 stored request payloads in shapes that v4 rejects. Some records store the request body as an object rather than a JSON string. Simple-endpoint tests may carry an empty `fileType` where v4 expects `none`, `script`, or `zip`. The dropped `Recurring` recurrence fails because v4 requires a cron value and a `YYYY-mm-dd` expiry. An empty `recurrence` fails because v4 expects one of `daily`, `weekly`, `biweekly`, or `monthly`.
- **Fix:** v4 ships a `V3toV4BackCompat` custom resource that rewrites these payloads on the first v4 create. If a scheduled test still never runs after the upgrade, that record was not covered; recreate the schedule in the v4 console.

### Zipped Test Cannot Find a Nested File After v4

- **Where seen:** at test time, the ECS task log reports a file-not-found for a path like `DLT_EHC/ehc.csv`. This is not a deploy failure.
- **Likely cause:** the v4 load-tester flattens the bundle. When a zip contains exactly one top-level folder and no sibling files, the container copies that folder's contents into the working directory and drops the wrapping folder. Paths that were relative to the wrapping folder no longer resolve.
- **Fix:** reference files from the working root, for example `ehc.csv` instead of `DLT_EHC/ehc.csv`. For packaging and linting a v4 bundle, see [[dlt-test-packaging-and-lint]]. v4.0.1 and v4.0.2 fixed related zip-handling regressions.

### ECS Task Fails to Pull the Container Image

- **Where seen:** at test time, the ECS task stops with an image-pull error in its stopped reason or task events. This is not a deploy failure.
- **Likely cause:** a stale, wrong, or unreachable image reference. Either a private image URI parameter points somewhere the task execution role cannot reach, or `UseStableTagging` produced a different image tag than expected. If only Native mode runs fail to pull, the per-framework image parameters are the suspects, because Standard mode uses `LoadTesterImageUri` and Native mode uses the Locust, k6, or JMeter image.
- **Fix:** verify `UseStableTagging` (default `No`) and the per-engine image URI parameters (`LoadTesterImageUri`, `LocustLoadTesterImageUri`, `K6LoadTesterImageUri`, `JMeterLoadTesterImageUri`, and `WebConsoleImageUri`). Set the URI empty to use the default public image, or supply a valid, reachable private ECR URI.

### Unsupported Update Path Across a Major Boundary

- **Where seen:** an in-place update fails or is not offered.
- **Likely cause:** the source version is below the supported update floor for that template. For v4.3.0 the default CloudFront template supports updates from v4.0.2 through v4.2.6, and the ALB with ECS and headless templates support updates from v4.1.0 through v4.2.6. Each later v4.3.x release extends the upper end to the release before it, so v4.3.4 accepts updates through v4.3.3. v2.0.0 and v3.0.0 do not support upgrading from earlier versions.
- **Fix:** if the source is below the floor, perform a clean v4 deploy and recreate scenarios rather than forcing an in-place update. Never delete an existing production stack to force a clean upgrade; that destroys the DynamoDB and S3 data.

## Quick Command Reference

```bash
# 1. First failed stack event (oldest first)
aws cloudformation describe-stack-events \
  --stack-name <stack-name> --region <region> \
  --query "reverse(StackEvents[?contains(ResourceStatus, 'FAILED')].[Timestamp,LogicalResourceId,ResourceType,ResourceStatusReason])" \
  --output table

# 2. Stack status
aws cloudformation describe-stacks \
  --stack-name <stack-name> --region <region> \
  --query "Stacks[0].StackStatus" --output text

# 3. Custom-resource handler function name. Its log group is /aws/lambda/<function name>.
#    Main stack logical ID: DLTCustomResourceInfraCustomResourceLambdaA4053269.
#    Regional stack logical ID: RegionalCustomResourceInfraCustomResourceLambda86A7E873.
aws cloudformation describe-stack-resource \
  --stack-name <stack-name> --region <region> \
  --logical-resource-id <logical id> \
  --query "StackResourceDetail.PhysicalResourceId" --output text

# 4. Read the custom-resource error
aws logs filter-log-events --region <region> \
  --log-group-name "/aws/lambda/<function name>" \
  --filter-pattern "\"not supported\" ?\"Error in custom resource\" ?\"failed\""

# 5. CloudTrail: find an access denial (SCP)
aws cloudtrail lookup-events --region <region> \
  --lookup-attributes AttributeKey=EventName,AttributeValue=<DeniedApiCall> \
  --query "Events[].CloudTrailEvent" --output text

# 6. Recover a stuck update (does not delete the stack)
aws cloudformation continue-update-rollback \
  --stack-name <stack-name> --region <region>
```
