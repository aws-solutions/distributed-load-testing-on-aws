# DLT capacity model: vCPU quota, available tasks, and task sizing

This file is the reference for the `dlt-capacity-and-region-planning` skill. It captures how a Distributed Load Testing on AWS (DLT) scenario consumes Fargate capacity and how the solution derives the available-task count per Region. Later sections explain the fixed task shape and where the out-of-memory limit comes from. All values are grounded in the solution source.

## How a Scenario Consumes Capacity

A scenario carries a `testTaskConfigs` array, one entry per Region:

```json
[
  { "region": "us-east-1", "taskCount": 40, "concurrency": 50 },
  { "region": "eu-west-1", "taskCount": 20, "concurrency": 50 }
]
```

Each entry launches `taskCount` Fargate tasks in that Region, and in Standard mode each task drives `concurrency` virtual users. The load a Region produces is `taskCount * concurrency`, and the total virtual users for the scenario is approximately the sum of that product across Regions. In the example above the total is `40 * 50 + 20 * 50 = 3000` virtual users.

Native mode (DLT v4.3.0 and later) treats the `concurrency` field as a placeholder that the console sends as 1. Each task instead runs a full, uncoordinated copy of the uploaded script. A Region's load is then `taskCount` times the virtual users the script declares, so the same arithmetic applies with the script's own user count in place of `concurrency`.

## Fixed Task Shape

DLT registers every load-generator task with the same size, regardless of test type. The ECS construct that defines the hub task definitions sets:

- `cpu`: 2048, which is 2 vCPU.
- `memoryLimitMiB`: 4096, which is 4 GiB, applied both at the task level and as the container hard limit.
- Ephemeral storage at the Fargate default of 20 GiB.
- No `memoryReservation` (no soft memory target).
- No `ulimits` overrides.

Four task definitions share this 2 vCPU, 4 GiB shape: the Standard one (the Taurus image, used by every Standard test) and the three Native ones (Locust, k6, and JMeter). The task runner reads the hub task definition at test time as the single source of truth for container shape, so vCPUs per task is 2 everywhere.

## Deriving Available Tasks per Region

The available-task count is the ceiling each Region's `taskCount` must stay within. It comes from three numbers, all per Region:

- **vCPU quota.** The Fargate on-demand vCPU service quota, service code `fargate`, quota code `L-3032A538`, read from Service Quotas.
- **vCPUs in use.** The sum of `cpu / 1024` over every Fargate task in the Region that is in `RUNNING`, `PENDING`, or `PROVISIONING` state, across all ECS clusters in the account in that Region. This includes Fargate usage that is not part of DLT.
- **vCPUs per task.** 2, from the fixed task shape above.

The solution exposes the raw numbers through `GET /vCPUDetails`, which returns per Region `{ vCPULimit, vCPUsPerTask, vCPUsInUse }`.

The solution computes "available tasks" two ways, and they can differ:

- **Quota minus all usage:** `floor((vCPULimit - vCPUsInUse) / vCPUsPerTask)`. This subtracts all Fargate vCPUs in use in the Region, DLT or not. The console's availability column, `dlt scenarios start`, and the API's own run-start check on v4.3.2 and later use it.
- **Quota minus DLT tasks:** `floor(vCPULimit / vCPUsPerTask) - runningTasks`, where `runningTasks` is the number of tasks in the DLT cluster in that Region (from `GET /tasks`). This ignores Fargate usage outside DLT. It is the `dltAvailableTasks` value the console and the MCP tools send in `regionalTaskDetails`. For a scheduled run the console subtracts no running tasks, so a future run can be scheduled while capacity is busy now.

`dlt scenarios create`, `update`, and `copy` send the requested task count as `dltAvailableTasks` instead of either value. On v4.3.0 and v4.3.1 the API guard compares against whichever value the client sent. On v4.3.2 and later, a run start uses the first formula, computed on the server.

## The Guard the API Enforces

When you create or start a scenario, the API validates each regional config with `validateTaskCountConcurrency`. On v4.3.0 and v4.3.1 the available-task count N in the guard comes from the request's `regionalTaskDetails`. On v4.3.2 and later a run start computes N on the server as `floor((vCPULimit - vCPUsInUse) / vCPUsPerTask)`, and only a save or a schedule creation uses the request's value. The checks are:

- If the Region has no regional task details because its stack is not deployed or was removed, the API throws `InvalidRegionalStack`. The error states that the Region's regional stack no longer exists; remove the Region from the scenario or redeploy the stack.
- `taskCount` must be an integer from 1 to the Region's available tasks. Otherwise the API throws "Task count should be positive number between 1 to N," where N is the available-task count for that Region.
- `concurrency` must be an integer from 1 to 25,000. The request schema rejects a value outside that range with "concurrency must be between 1 and 25000," and the handler's own check reports "Concurrency should be positive number."

There is no application-level maximum on `taskCount` beyond the available-task count. The Step Functions map fans out one branch per Region with `maxConcurrency: 0`, and each branch creates one ECS service whose desired count is that Region's `taskCount`, so ECS launches all of a Region's tasks together. That leaves the account Fargate vCPU quota in each Region as the effective ceiling.

On v4.3.0 and v4.3.1, a Region that passes the guard with more tasks than its quota allows does not fail at once. Its ECS service starts tasks until the quota is used up, the rest never start, and the Region fails stabilization within 30 minutes. The run then fails with "Load test setup failed in 1 region: <Region> (<cause>)." and sends no load, while the tasks that did start sit idle and are billed until cleanup. On v4.3.2 and later the server-side check rejects such a run before anything launches.

## The 4 GiB Memory Limit and JMeter Heap

The 4 GiB task memory is a hard limit with no reservation. For JMeter tests, in both traffic shapes, the container runs a JVM configured through `JVM_ARGS="-Xms1g -Xmx3g -XX:+ExitOnOutOfMemoryError -XX:-HeapDumpOnOutOfMemoryError"`, so the heap starts at 1 GB and can grow to 3 GB. Inside a 4 GiB task that leaves roughly 1 GB for the container's supervisor (the Node runner in Native mode, Taurus in Standard mode) and the operating system. A heavy JMeter plan or a high per-task concurrency can drive the heap to its 3 GB ceiling:

- In **Native mode** the JVM exits on its own at the first `OutOfMemoryError`. DLT records a framework-exit record, and the run details page shows a framework warning alert with the exit code. Exit code 137 in Native mode means the JMeter process was killed with SIGKILL, which usually means the container reached its 4 GiB limit and the kernel ended the JVM. The DLT runner survives to report it, so the exit still appears as a framework warning rather than a stopped task.
- In **Standard mode** the container detects the `OutOfMemoryError` in JMeter's error output, stops JMeter, and exits with code 137 itself.

Locust and k6 tasks do not run a JVM and are not bound by the heap setting, though they share the same 4 GiB task limit.

The remedy for memory pressure is to spread load rather than concentrate it. Lower the concurrency per task, add more tasks or more Regions to reach the same total virtual users, and lighten the plan itself. CPU exhaustion is different: a CPU-bound task is not killed; it produces lower throughput and higher response times, which signals that load should spread across more tasks.

## Worked Sizing Example

The target is 3000 virtual users at a per-task concurrency of 50.

- Tasks needed: `ceil(3000 / 50) = 60` tasks.
- If us-east-1 has 100 available tasks, all 60 fit in one Region: `{ region: us-east-1, taskCount: 60, concurrency: 50 }`, consuming `60 * 2 = 120` vCPU.
- If us-east-1 has only 40 available tasks, split across Regions, for example 40 in us-east-1 and 20 in eu-west-1. That split needs at least 20 available tasks and a deployed regional stack in eu-west-1.
- If the total available tasks across all usable Regions is below 60, the target is infeasible at concurrency 50. Either raise concurrency (watch the JMeter heap), add Regions, or request a larger `L-3032A538` quota. Fitting 60 tasks of demand into 40 available tasks by concurrency alone needs at least `ceil(3000 / 40) = 75` virtual users per task.
