# DLT Retained and Orphaned Resources Reference

This is the source-verified list of what a DLT stack leaves behind when it is deleted, why, and how to remove each item. Line references point at the DLT solution source under `source/infrastructure/lib/` unless noted. It is verified against the v4.3.0 release, using the synthesized templates in the solution's stack snapshot tests, and the v4.3.1 through v4.3.4 patches change none of these resources. A live v4.2.x deployment also confirmed it first-hand.

## How to Read the Removal Policies

CloudFormation removes a resource on stack delete only when its removal policy is `DESTROY`. A `RETAIN` policy tells CloudFormation to detach the resource and leave it in the account. Two CDK defaults matter here:

- A DynamoDB `Table` defaults to `RemovalPolicy.RETAIN`. DLT does not override this on any of its tables, so all four of its tables are retained.
- A CloudWatch `LogGroup` defaults to `RemovalPolicy.RETAIN`. DLT relies on this default for almost every log group it declares, and sets `RETAIN` explicitly on the API access log group. Only the ALB with ECS mode's web console and WAF log groups are set to `DESTROY`.
- A Lambda function with no declared log group writes to `/aws/lambda/<function-name>`, which the Lambda service creates on first invocation. That group was never a stack resource, so it survives any stack delete with no retention limit.

An S3 bucket defaults to `RETAIN` as well, and DLT sets `RETAIN` explicitly on its buckets. The AWS Solutions CloudFront-to-S3 construct that builds the default console bucket also defaults its bucket to `RETAIN` with versioning enabled.

## Retained S3 Buckets

All DLT buckets are versioned, which is why they cannot be emptied with the ordinary recursive delete. To delete one you must first remove every object version and every delete marker.

| Bucket (construct id) | Present in | Removal policy | Versioned | Encryption | Source |
| --- | --- | --- | --- | --- | --- |
| Scenarios and results bucket (`DLTScenariosBucket`) | All modes | `RETAIN` (explicit) | Yes | SSE-KMS, AWS-managed `aws/s3` key (`KMS_MANAGED`) | `back-end/scenarios-storage.ts:38` |
| Server access logs bucket (`LogsBucket`) | All modes, and every regional (spoke) stack | `RETAIN` (explicit) | Yes | SSE-S3 (`S3_MANAGED`) | `common-resources/common-resources.ts:53` |
| Console bucket, CloudFront mode (`DLTDashboardS3`, via `CloudFrontToS3`) | Default CloudFront mode | `RETAIN` (construct default) | Yes | Construct default | `front-end/console-cloudfront.ts:97` |
| Console bucket, ALB with ECS mode (`ConsoleBucket`) | ALB with ECS mode | `RETAIN` (explicit) | Yes | SSE-KMS, AWS-managed `aws/s3` key (`KMS_MANAGED`) | `front-end/console-alb-ecs.ts:73` |
| Console bucket, headless mode (`ConsoleBucket`) | Headless mode | `RETAIN` (explicit) | Yes | SSE-KMS, AWS-managed `aws/s3` key (`KMS_MANAGED`) | `front-end/console-headless.ts:36` |

Only one console bucket exists per deployment, chosen by the deploy mode. Every mode also has the scenarios bucket and the logs bucket, so a typical teardown removes three buckets per generation in the hub Region. Each regional (spoke) stack adds its own retained logs bucket in its Region, named from the regional stack's name.

**Why retained.** The scenarios bucket holds uploaded test bundles and results, so retaining it protects that data from a careless stack update. S3 server access logs and CloudFront access logs go to the logs bucket, and the web console assets live in the console bucket. Versioning protects all three, and it is also what blocks a naive delete.

**How to remove.** Delete all versions and all delete markers, then delete the bucket. In boto3: `boto3.resource("s3").Bucket(name).object_versions.delete()` followed by `.delete()`. The logs bucket keeps receiving access-log writes until the console distribution and the other buckets are gone, so empty and delete it last among the buckets. `cleanup_retained.py` holds the logs bucket while any other retained bucket of the same generation still exists and logs to it, whether that bucket failed to delete, was skipped, or was left out of the plan. When a late access log refills the logs bucket before the delete, the script waits briefly, then purges and deletes it once more.

## Retained DynamoDB Tables

Every table defaults to `RETAIN`, uses the AWS-managed `aws/dynamodb` key (`TableEncryption.AWS_MANAGED`), bills on-demand (`PAY_PER_REQUEST`), and has point-in-time recovery enabled. All of them live in the hub Region; regional stacks create no tables.

| Table (construct id) | Purpose | Present in | Removal policy | Source |
| --- | --- | --- | --- | --- |
| Scenarios (`DLTScenariosTable`) | Test definitions and configuration, keyed by `testId` | All modes | `RETAIN` (CDK default) | `back-end/scenarios-storage.ts:69` |
| History (`DLTHistoryTable`) | Per-run history, keyed by `testId` and `testRunId`, with GSI `testId-startTime-index` | All modes | `RETAIN` (CDK default) | `back-end/scenarios-storage.ts:80` |
| AgentSpaces (`DLTAgentSpacesTable`) | DevOps agent Agent Space registrations, keyed by `id` | All modes | `RETAIN` (CDK default) | `back-end/devops-agent.ts:73` |
| Investigations (`DLTInvestigationsTable`) | DevOps agent investigations, keyed by `testId` and `testRunId#investigationId` | All modes | `RETAIN` (CDK default) | `back-end/devops-agent.ts:103` |

**Why retained.** The Scenarios and History tables hold the customer's saved tests and their run history, which is exactly the state a teardown might want to preserve or export before deletion. DevOps agent state lives in the AgentSpaces and Investigations tables. All of them are retained by the same CDK default.

**How to remove.** `aws dynamodb delete-table --table-name <name> --region <region>`, or the script's `--delete`. The GSI on the History table is deleted with the table. Point-in-time recovery does not block deletion, but the deletion is permanent, so export first if the history matters.

## Retained CloudWatch Log Groups, Dashboards, and Metric Filters

Every log group the stack declares carries a ten-year retention (3,653 days) and `RETAIN`, so it outlives the stack and keeps billing for stored bytes; the Lambda-created groups have no retention limit. Names come in three shapes, which matters when you search for them. One shape is the CloudFormation-generated `<stack-name>-<logical-id>-<suffix>`. Lambda groups use `/aws/lambda/<function-name>`, where the function name is itself generated from the stack name, and Step Functions uses one fixed name.

| Resource | Present in | Name shape | Source |
| --- | --- | --- | --- |
| ECS load-testing log group (`DLTCloudWatchLogsGroup`) | All modes, hub and every spoke Region | `<stack-name>-...DLTCloudWatchLogsGroup...` | `testing-resources/ecs.ts:127` |
| API access log group (`APILogs`, explicit `RETAIN`) | All modes | `<stack-name>-DLTApiAPILogs...` | `front-end/api.ts:365` |
| Cognito user pool activity log group (`CognitoUserPoolLogGroup`) | All modes | `<stack-name>-DLTCognitoAuthCognitoUserPoolLogGroup...` | `front-end/auth.ts:192` |
| API services Lambda log group | All modes | `/aws/lambda/<stack part>-...` | `front-end/api.ts:338` |
| Thirteen orchestration Lambda log groups: task runner, task status checker, task canceller, task failure handler, stabilization checker, start command, regional sync, results parser, test cleanup, test status updater, orphan cleanup, Step Functions failure handler, and metrics emitter | All modes | `/aws/lambda/<stack part>-...` | `back-end/test-task-lambdas.ts` |
| Real-time data publisher Lambda log group (`RealTimeDataPublisherLogGroup`) | Hub and every spoke Region | `/aws/lambda/<stack part>-...` | `testing-resources/real-time-data.ts:72` |
| Step Functions log group (`StepFunctionsLogGroup`) | All modes | `/aws/vendedlogs/states/StepFunctionsLogGroup<stack-name><suffix>` | `back-end/step-functions.ts:739` |
| Lambda-created log groups for functions with no declared group, such as the custom-resource handlers | Hub and every spoke Region | `/aws/lambda/<stack part>-...`, no retention limit | Created by the Lambda service, not by the stack |
| Per-test dashboards `EcsLoadTesting-<testId>-<region>` | Any deployment that ran Standard mode tests | Not a stack resource | `source/task-runner/src/dashboard.ts:103` |
| Per-test metric filters on `DLTCloudWatchLogsGroup` | Any deployment that ran Standard mode tests | Removed with the log group | `source/task-runner/src/dashboard.ts:61` |

**Why retained or orphaned.** Policy retains the declared log groups, and the Lambda-created groups were never stack resources. Dashboards and metric filters differ again. The running solution creates them at test time through the CloudWatch API, and only for Standard mode runs (Native mode skips dashboard creation), so a stack delete never touches them. The Test Cleanup Lambda deletes a run's metric filters when the run ends, but a test's dashboard is deleted only when you delete the test itself; deleting its runs leaves it. A stack delete therefore leaves one dashboard per Standard mode test and Region for every test that still existed, and leftover metric filters only where a run's cleanup failed.

**What deleting a test removes.** The API's `deleteTest` handler in `source/api-services/lib/scenarios/index.js` (line 2214 in v4.3.0, line 2271 in v4.3.4; the delete code is the same in every v4.3.x release) refuses a test whose status is not `complete`, `cancelled`, `failed`, `scheduled`, or `created`. Otherwise it removes:

- For each Region in the test's configuration, the dashboard `EcsLoadTesting-<testId>-<region>` and the metric filters `<cluster>-Ecs<metric>-<testId>` for `numVu`, `numSucc`, `numFail`, and `avgRt` on that Region's `DLTCloudWatchLogsGroup` (`deleteDashboards` and `deleteMetricFilter`, lines 2127 and 2075 in v4.3.0).
- The EventBridge Scheduler schedules `<testId>Create` and `<testId>Scheduled`, and every legacy CloudWatch Events rule whose name starts with the test ID, with its target and its Lambda permission (`deleteSchedules` and `deleteLegacyRules`, lines 2192 and 2157 in v4.3.0).
- The test's Scenarios table item and its History table records (lines 2233 to 2236 in v4.3.0).

It leaves the test's files in the scenarios bucket. On a stack delete, the hub's `CleanUpTestScenarios` custom resource (`source/custom-resource/main-index.js:104`) scans the Scenarios table and deletes each test's two schedules, but it only logs an error other than `ResourceNotFoundException` (`source/custom-resource/lib/scenarios/index.js:43`), and it touches no dashboard, metric filter, or legacy rule. `cleanup_retained.py` never looks for schedules or rules.

**How to find them.** `cleanup_retained.py` takes each group by exact name from the deleted stack's resource list. To search by hand, for example after the stack has aged out of `ListStacks`, note that a search on the stack-name prefix alone finds only the first shape. Also search `/aws/vendedlogs/states/StepFunctionsLogGroup<stack-name>`, and search `/aws/lambda/` on the stack part. The stack part is the stack name, truncated when the whole function name would not fit. For the stock stack name it is `distributed-load-testing-`, and the groups read `/aws/lambda/distributed-load-testing--DLT...`, so a search on `/aws/lambda/distributed-load-testing-on-aws` finds none of them. A live test hub left 23 such groups in its Region, and a regional stack left 2. The Lambda-created groups carry no tags, and a sibling stack's groups share the stack part, so confirm each one by its logical part and creation time.

**How to remove.** Delete the log groups with `aws logs delete-log-group`; the metric filters attached to a log group go with it. Standalone dashboards need `aws cloudwatch delete-dashboards --dashboard-names EcsLoadTesting-...`. Log groups and dashboards are Region-scoped, so repeat this in the hub Region and every spoke Region, using the regional stack's own name in each spoke Region.

## Resources That Carry No Stack Tags

Three more resources outlive the stack. None of them carries a CloudFormation tag, and two have names that do not include the stack name, so a search by stack name misses them. `scripts/cleanup_retained.py` derives each one from the deleted stack's own records. The Container Insights groups come from the exact names of the ECS clusters in `ListStackResources`, and the group must have been created during the stack's lifetime. The role comes from its retained row by exact name. The repositories come from the stack ID in `ListStacks`, and each must have been created during the stack's lifetime. CloudFormation keeps a deleted stack in `ListStacks` for 90 days. After that, the script does not search for these resources, so find them by hand with the shapes below.

| Resource | Present in | Name shape | Source |
| --- | --- | --- | --- |
| Container Insights log group of the load-test cluster | All modes, hub and every spoke Region | `/aws/ecs/containerinsights/<stack-name>/performance`, because the cluster is named after the stack | `testing-resources/ecs.ts:71` |
| Container Insights log group of the web console cluster | ALB with ECS mode | `/aws/ecs/containerinsights/<stack-name>-DLTConsoleResourcesWebConsoleCluster...-<suffix>/performance` | `front-end/console-alb-ecs.ts:279` |
| API Gateway CloudWatch IAM role (`DLTApiCloudWatchRoleD45E4DD6`), `RETAIN` by the CDK `RestApi` default | All modes, hub only | `<stack part>-DLTApiCloudWatchRole...-<suffix>`, truncated to 64 characters. It trusts `apigateway.amazonaws.com` and has only the `AmazonAPIGatewayPushToCloudWatchLogs` managed policy. | `front-end/api.ts:413` |
| ECR repositories created by the web console's pull through cache | ALB with ECS mode, when `WebConsoleImageUri` is empty | `dlt-<last group of the stack ID's UUID>/aws-solutions/distributed-load-testing-on-aws-web-console` | `front-end/console-alb-ecs.ts:254` |

**Why retained or orphaned.** ECS creates the Container Insights log groups when a cluster first reports metrics, so they were never stack resources. CDK gives the REST API's CloudWatch role a `RETAIN` policy, and its retained `AWS::ApiGateway::Account` resource points the Region's API Gateway account setting at that role. DLT's own `ApiAccountConfig` (`front-end/api.ts:461`) points the same setting at the stack-owned `DLTApiAPILoggingRole`, and in practice it wins, so the setting usually names the logging role, which the stack delete removes. The pull through cache rule is a stack resource and is deleted, but the repositories it created on first pull are not.

**How to find them.** Search log groups with the prefix `/aws/ecs/containerinsights/<stack-name>`. For the role, run `aws iam list-roles` and look for `DLTApiCloudWatch` in the name, then confirm its trust policy and creation date. For the repositories, take the stack ID from `aws cloudformation list-stacks --stack-status-filter DELETE_COMPLETE`, take the last group of its UUID, and list repositories that start with `dlt-<that group>/`.

**How to remove.** Delete the log groups with `aws logs delete-log-group` and the repositories with `aws ecr delete-repository --force`. For the role, first run `aws apigateway get-account` in the stack's Region. If `cloudwatchRoleArn` still names the DLT role, API Gateway in that Region writes every REST API's logs through it. Point the setting at a role that will stay before you delete the DLT role, or keep the role. Then detach its managed policy and delete it with `aws iam delete-role`. If the setting names a role that no longer exists, usually the deleted stack's `DLTApiAPILoggingRole`, any other REST API in the Region, another DLT hub included, writes no execution or access logs until you point the setting at a role that exists.

## Resources Removed on Stack Delete (Not Orphaned)

These carry a destroy policy or are ordinary stack resources, so a stack delete removes them. They are listed here so you do not go looking for orphans that do not exist.

| Resource | Present in | Removal policy | Source |
| --- | --- | --- | --- |
| Cognito user pool | All modes | `DESTROY` | `front-end/auth.ts:156` |
| Web console ECS log group (`WebConsoleLogGroup`), ten-year retention | ALB with ECS mode | `DESTROY` | `front-end/console-alb-ecs.ts:285` |
| WAF log group `aws-waf-logs-<stack-name>` (`WafLogGroup`), ten-year retention | ALB with ECS mode with `DeployWAF=Yes` | `DESTROY` | `front-end/console-alb-ecs.ts:568` |
| Solution operational-metrics SQS queue (`LambdaToSqsToLambda`) | Hub and every spoke Region | `DESTROY` (construct default) | `source/metrics-utils/lib/solutions-metrics.ts:92` |
| CloudFront distribution | Default CloudFront mode | Stack resource | `front-end/console-cloudfront.ts` |
| AgentCore MCP gateway `dlt-mcp-server` and gateway target | When MCP is deployed | Stack resource | `mcp/gateway-construct.ts`, `mcp/mcp-infra.ts` |

Verify the CloudFront distribution and the AgentCore gateway are actually gone after the delete, because the gateway name is account and Region unique and a leftover would block a redeploy.

## KMS Keys

DLT creates no customer-managed KMS keys. Every encrypted resource uses an AWS-managed key: the buckets use `aws/s3` (or SSE-S3 for the logs bucket and the CloudFront-mode console bucket) and the DynamoDB tables use `aws/dynamodb`. AWS owns and rotates AWS-managed keys, they incur no separate key charge, and a customer cannot schedule them for deletion. A DLT teardown therefore has no KMS key to schedule for deletion. Any customer-managed key aliased or tagged to a DLT stack was added outside the stock solution. `scripts/cleanup_retained.py` lists such a key for review and never schedules its deletion. Confirm its origin before you schedule its deletion by hand with a 7 to 30 day window.

## The Accumulation Problem and How to Find Old Generations

Retained buckets and tables have auto-generated physical names that include a random suffix, so each deploy produces a new set and each plain delete orphans the previous set. Over several deploy and delete cycles an account accumulates multiple generations, all matching the stack-name prefix, none attached to a live stack. A live test account showed three generations of the buckets and tables from prior teardowns that never cleaned up.

For 90 days after each delete, `scripts/cleanup_retained.py` matches each generation's resources by exact physical ID from its `ListStackResources` and `DescribeStackEvents` records, labels them with that generation's stack ID, and acts on one generation at a time with `--stack-id`. After that, or under `--prefix`, it only lists possible leftovers by name. Find and attribute those by hand:

- **CloudFormation tags survive on log groups only.** On a test stack deleted in October 2026, the retained log groups kept `aws:cloudformation:stack-name`, `aws:cloudformation:logical-id`, and `aws:cloudformation:stack-id`. The `stack-id` tells generations apart: the same `stack-name` with a different `stack-id` means a different deploy and delete cycle. When the stack was deleted, the retained buckets lost those three tags, and DynamoDB tables never carry them. Buckets and tables keep only the stack-level tags passed with `--tags` at deploy time, so deploying with a distinguishing tag, such as a deploy date, makes later cleanup easier.
- **Generated names suggest buckets, tables, and Lambda log groups, but do not prove ownership.** Tables are named `<stack-name>-<construct path>-<suffix>`, with the construct path starting `DLT` or `DevOpsAgent`. Buckets (lowercased) and Lambda function names use `<stack part>-<logical part>-<suffix>`, where the stack part is the whole stack name when it fits and a truncation otherwise. The stock stack name `distributed-load-testing-on-aws` becomes `distributed-load-testing--...` in bucket names and in `/aws/lambda/` group names. A regional stack's name truncates to the same stack part, so a hub and a regional stack in one Region produce buckets with the same leading characters. Their logical parts tell them apart: hub buckets read `dlttestrunnerstorage...`, `dltconsoleresources...`, and `dltcommonresources...`, while the regional stack's logs bucket reads `commonresourceslogsbucke...`.
- **List, then confirm, then delete one generation at a time.** Do not bulk-delete on a name prefix alone. Confirm log groups by `stack-id`, confirm untagged buckets by their logical part and creation date, show each resource to the user, and remove one generation at a time after the user approves it.
