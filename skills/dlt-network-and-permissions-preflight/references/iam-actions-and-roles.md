# DLT IAM actions and roles reference

This reference lists the IAM roles and actions a Distributed Load Testing on AWS (DLT) run depends on, verified against the solution source. It also shows how to spot a permission failure in AWS CloudTrail. Use it with Check 1 and Check 2 of the parent skill.

Source of truth (paths under the solution repo `source/infrastructure/lib/`):

- ECS task role and task execution role: `testing-resources/ecs.ts`
- Task-runner Lambda role (the launch role) and the task-status-checker role: `back-end/test-task-lambdas.ts`
- API services Lambda role and the `AuthorizationType.IAM` API: `front-end/api.ts`
- Cross-region PassRole grant for spoke Regions: `distributed-load-testing-on-aws-regional-stack.ts`

## The Roles at a Glance

These are the principals in the launch and monitoring path, starting with the identity that signs API requests.

1. **Signing identity.** Every DLT API request must be SigV4-signed by an identity that holds `execute-api:Invoke`. For the console and for the CLI after `dlt login` or `dlt login --srp`, that identity is the Cognito identity pool's authenticated role, which the stack creates with the grant. For the MCP server it is the MCP tool Lambda role. Only `dlt login --iam` and direct API callers sign with your own IAM identity.
2. **API services Lambda role** (`DLTAPIServicesLambdaRole`). It backs the REST API: it creates and reads scenarios, starts the orchestration, and reports status and capacity.
3. **Task-runner Lambda role** (`DLTTestLambdaTaskRole`). Spoke stacks reference its ARN as the main-region task role. It registers task definitions, creates the ephemeral ECS service that launches the fleet, and passes the task roles to ECS.
4. **ECS task execution role** (`DLTTaskExecutionRole`). The ECS agent assumes it to pull the container image from ECR and to write container logs to CloudWatch Logs.
5. **ECS task role** (`DLTTaskRole`). The running container assumes it to read the test bundle and the JMeter bundle from the scenarios S3 bucket and to write results there.
6. **Task-status-checker Lambda role** (`TaskStatusRole`). It polls a running test for completion, and it is the role behind the `errorReason` "Failed to check task status."

## Operator: API Access

- **Action required:** `execute-api:Invoke` on the DLT API.
- **Why:** in `front-end/api.ts` every method uses `authorizationType: AuthorizationType.IAM`. Callers must SigV4-sign requests. See the `dlt-sigv4-request-signing` skill.
- **Failure signal:** HTTP 403 Forbidden on every route, including from the CLI and MCP server. If the client has no AWS credentials at all, requests are unsigned and rejected the same way.

## ECS Task Execution Role (`DLTTaskExecutionRole`)

The `ecs-tasks.amazonaws.com` service assumes this role. Its inline policy grants these actions on resource `*`:

| Action | Purpose |
| --- | --- |
| `ecr:GetAuthorizationToken` | Authenticate to ECR for the image pull |
| `ecr:BatchCheckLayerAvailability` | Image pull |
| `ecr:GetDownloadUrlForLayer` | Image pull |
| `ecr:BatchGetImage` | Image pull |
| `logs:CreateLogStream` | Create the task's CloudWatch log stream |
| `logs:PutLogEvents` | Write container output to CloudWatch Logs |

A denial here shows as an image-pull failure and a task that never starts (Check 4). The ECR actions matter only when an image URI parameter names a private ECR repository; the default images come from the ECR Public Gallery.

## ECS Task Role (`DLTTaskRole`)

The `ecs-tasks.amazonaws.com` service assumes this role. Its inline policy grants these actions, scoped to the scenarios bucket ARN and `${bucket}/*`:

| Action | Purpose |
| --- | --- |
| `s3:HeadObject` | Listed by the template for checking objects. It is not a distinct IAM action: S3 authorizes `HeadObject` through `s3:GetObject` |
| `s3:GetObject` | Download the test bundle and, for JMeter, the bundle archive |
| `s3:PutObject` | Upload results and artifacts |
| `s3:ListBucket` | List objects in the scenarios bucket |
| `s3:AbortMultipartUpload` | Clean up interrupted uploads |

A denial or a blocked S3 path here shows as a setup failure (the test bundle or the JMeter bundle cannot be downloaded) or as missing results. The same role also reads the start signal and writes the completion marker in the scenarios bucket. Without S3 access, a task therefore never starts its load and never reports completion.

## Task-Runner Lambda Role (`DLTTestLambdaTaskRole`)

This role launches the fleet. Its grants apply to resource `*`, and the tag-scoped set is conditioned on `aws:ResourceTag/SolutionId` equal to the solution id:

| Action | Scope | Purpose |
| --- | --- | --- |
| `ecs:RegisterTaskDefinition` | tag-scoped | Register the test-specific task definition |
| `ecs:DeleteTaskDefinitions` | tag-scoped | Clean up task definitions |
| `ecs:CreateService` | tag-scoped | Launch the fleet as an ephemeral ECS service |
| `ecs:UpdateService` | tag-scoped | Adjust or drain the service |
| `ecs:DeleteService` | tag-scoped | Tear down after the run |
| `ecs:DescribeServices` | tag-scoped | Read service state |
| `ecs:RunTask` | tag-scoped | Present for the task-launch path |
| `ecs:DescribeTasks` | tag-scoped | Read task state |
| `ecs:TagResource` | tag-scoped | Tag the service and tasks with the solution id |
| `ecs:DescribeTaskDefinition` | `*` | Read the hub task definition to copy container shape |
| `ecs:DeregisterTaskDefinition` | `*` | Clean up |
| `ecs:ListTaskDefinitions`, `ecs:ListTasks` | `*` | Enumerate (no resource-level support) |
| `logs:PutMetricFilter`, `logs:DescribeMetricFilters` | tag-scoped | Metric filters behind the per-run CloudWatch dashboard (Standard mode only; Native runs skip the dashboard) |
| `cloudwatch:PutMetricData` | namespace `distributed-load-testing` | Publish metrics |
| `cloudwatch:PutDashboard` | `EcsLoadTesting*` | Per-run dashboard (Standard mode only) |
| `s3:PutObject` | scenarios bucket `/*` | Write run metadata |
| `iam:PassRole` | task role and execution role ARNs, `PassedToService: ecs-tasks.amazonaws.com` | Hand the task roles to ECS at launch |

Note: `ecs:CreateService` is the action the current task runner actually uses to launch the fleet. `ecs:RunTask` remains granted, so a policy that allows only one of the two can still surprise you; both are present in an unmodified deployment.

## API Services Lambda Role (`DLTAPIServicesLambdaRole`)

This role backs the REST API. These are its relevant grants:

| Action | Scope | Purpose |
| --- | --- | --- |
| `ecs:RunTask`, `ecs:DescribeTasks`, `ecs:ListTasks`, `ecs:TagResource` | tag-scoped on solution id | Task operations from the API |
| `ecs:DescribeTasks`, `ecs:DescribeServices`, `ecs:DescribeTaskDefinition`, `ecs:DescribeClusters`, `ecs:ListClusters`, `ecs:ListAccountSettings` | `*` | Status and capacity reporting |
| `servicequotas:GetServiceQuota` | `*` | Read the Fargate vCPU quota for capacity checks |
| `states:StartExecution` | the task-runner state machine | Start the orchestration |
| `iam:PassRole` | task role and execution role ARNs, `PassedToService: ecs-tasks.amazonaws.com` | Pass task roles |
| `cloudformation:ListExports`, `cloudformation:DescribeStacks` | `*` | Resolve stack outputs |

A denial on `ecs:DescribeTasks` in this role breaks status and capacity reporting in the console, CLI, and MCP write tools, but it does not produce the `errorReason` "Failed to check task status." That reason comes only from the task-status-checker (below).

### Scheduled Tests

The same role creates the schedules behind one-time and recurring tests:

| Action | Scope | Purpose |
| --- | --- | --- |
| `scheduler:CreateSchedule`, `scheduler:DeleteSchedule`, `scheduler:GetSchedule` | schedules named `default/*Create` and `default/*Scheduled` | Create and remove EventBridge Scheduler schedules |
| `iam:PassRole` | the solution's scheduler execution role, `PassedToService: scheduler.amazonaws.com` | Let EventBridge Scheduler invoke the API Lambda |
| `events:PutRule`, `events:PutTargets`, `events:DeleteRule`, `events:RemoveTargets`, `events:ListRules` | rules named `*Scheduled` and `*Create` | Kept for schedules created before the move to EventBridge Scheduler |

An SCP that blocks EventBridge Scheduler leaves on-demand runs working while every scheduled test fails to save or never fires, which is easy to misread as a scheduling bug.

## Task-Status-Checker Lambda Role (`TaskStatusRole`)

| Action | Scope | Purpose |
| --- | --- | --- |
| `ecs:ListTasks` | `*` | Granted, but not called in v4.3.x |
| `ecs:DescribeTasks` | `*` | Granted, but not called in v4.3.x |
| `dynamodb:GetItem` | the scenarios table | Read the scenario status and healthy threshold |
| `s3:ListBucket` | the scenarios bucket | Count the per-task completion markers |

When this Lambda throws, for example because an SCP denies `dynamodb:GetItem` on the scenarios table or `s3:ListBucket` on the scenarios bucket, it marks the scenario failed with the `errorReason` "Failed to check task status." Look up the error in its Lambda log.

## Cross-Region PassRole for Spoke Regions

When a regional (spoke) stack is deployed, `distributed-load-testing-on-aws-regional-stack.ts` attaches an inline policy onto the **hub's** task-runner role (referenced as `mainRegionLambdaTaskRoleArn`). The policy grants `iam:PassRole` on that Region's task execution role and task role, with the `PassedToService: ecs-tasks.amazonaws.com` condition. This has three consequences for preflight:

- The hub role must carry a PassRole grant for every spoke Region the scenario uses.
- If the hub role was replaced or its inline policies were reset after the spoke stack was deployed, the grant is gone and launches in that Region fail on `PassRole`.
- The fix is to redeploy or update the regional stack so it re-attaches its PassRole grant, or to add the grant back to the hub role.

## Detecting a Permission Failure in CloudTrail

CloudTrail Event history records denied management calls, such as the ECS, EC2, and IAM calls below. It records DynamoDB and S3 data calls only when a trail logs data events, and it never records API Gateway invocations, so read a 403 from the DLT API in the stack's API Gateway access log instead. To find the cause of an `AccessDenied`:

1. Open CloudTrail Event history in the Region where the run launches (spoke Region for a regional failure, hub Region for API failures).
2. Filter by event name, for example `DescribeTasks`, `CreateService`, `RunTask`, or `RegisterTaskDefinition`. `iam:PassRole` is a permission rather than an API call, so a PassRole denial appears on the call that passed the role, with an `errorMessage` that names `iam:PassRole`. Narrow by the time of the failed run.
3. Open the matching event and read:
   - `errorCode`: `AccessDenied` (IAM services) or `Client.UnauthorizedOperation` (EC2-style services).
   - `errorMessage`: the human-readable reason. A message containing "with an explicit deny in a service control policy" means an SCP is the cause and the fix is organizational (Check 2). One about a missing permission on a specific role points at a stripped or boundary-limited role (Check 1).
   - `userIdentity`: the principal that was denied. Confirm it is one of the DLT roles above. A DLT role being denied an action the account-level policy allows is the fingerprint of an SCP or permission boundary.
4. If you prefer the CLI, `aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=DescribeTasks` returns the same events for scripted triage. Use read-only credentials for the lookup.

If the denied principal, action, and Region match a DLT role and the account's own IAM plainly allows the action, escalate to the AWS Organizations administrator. Bring the CloudTrail event as evidence. Do not widen the in-account role: an explicit deny above the account always wins.
