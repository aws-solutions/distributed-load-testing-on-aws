// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws } from "aws-cdk-lib";
import type { ILogGroup } from "aws-cdk-lib/aws-logs";
import { QueryDefinition, QueryString } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export interface SavedQueriesConstructProps {
  /** All orchestration Lambda log groups (for cross-Lambda queries) */
  readonly allOrchestrationLogGroups: ILogGroup[];
  /** Task Failure Handler log group */
  readonly taskFailureHandlerLogGroup: ILogGroup;
  /** Orphan Cleanup log group */
  readonly orphanCleanupLogGroup: ILogGroup;
  /** ECS task (load-test.sh) log group */
  readonly ecsTaskLogGroup: ILogGroup;
}

/**
 * Creates CloudWatch Logs Insights saved queries for DLT observability.
 *
 * These appear as saved queries in the customer's CloudWatch Logs Insights
 * console under "Saved queries". Customers can run them directly without
 * copy-pasting.
 *
 * All queries filter on the `logEvent` field (a stable, enum-backed
 * identifier from `LogEvent` in `@amzn/dlt-common`), making them
 * resilient to log message rewording.
 * @see docs/metrics-reference.md Section 5 for the query catalog.
 */
export class SavedQueriesConstruct extends Construct {
  constructor(scope: Construct, id: string, props: SavedQueriesConstructProps) {
    super(scope, id);

    const suffix = `[${Aws.STACK_NAME} ${Aws.REGION}]`;

    // ── DLT - Test Timeline ──
    // Shows the full lifecycle for one test run across all orchestration Lambdas.
    new QueryDefinition(this, "TestTimeline", {
      queryDefinitionName: `DLT - Test Timeline ${suffix}`,
      queryString: new QueryString({
        fields: ["@timestamp", "logEvent", "message", "region", "error"],
        filterStatements: ['testRunId = "REPLACE_WITH_TEST_RUN_ID"'],
        sort: "@timestamp asc",
        limit: 500,
      }),
      logGroups: props.allOrchestrationLogGroups,
    });

    // ── DLT - Test Errors ──
    // Shows all ERROR-level entries for one test run across Lambdas and ECS tasks.
    new QueryDefinition(this, "TestErrors", {
      queryDefinitionName: `DLT - Test Errors ${suffix}`,
      queryString: new QueryString({
        fields: ["@timestamp", "logEvent", "message", "region", "taskId", "error"],
        filterStatements: ['testRunId = "REPLACE_WITH_TEST_RUN_ID" and level = "ERROR"'],
        sort: "@timestamp asc",
      }),
      logGroups: [...props.allOrchestrationLogGroups, props.ecsTaskLogGroup],
    });

    // ── DLT - Task Failures ──
    // Shows individual task deaths with stop codes and failure classification.
    new QueryDefinition(this, "TaskFailures", {
      queryDefinitionName: `DLT - Task Failures ${suffix}`,
      queryString: new QueryString({
        fields: [
          "@timestamp",
          "testId",
          "testRunId",
          "region",
          "taskArn",
          "stopCode",
          "exitCode",
          "stopCategory",
          "stoppedReason",
        ],
        filterStatements: ['logEvent = "TASK_FAILURE_DETECTED"'],
        sort: "@timestamp desc",
        limit: 50,
      }),
      logGroups: [props.taskFailureHandlerLogGroup],
    });

    // ── DLT - Orphan Cleanup ──
    // Shows orphaned service detection history.
    new QueryDefinition(this, "OrphanCleanup", {
      queryDefinitionName: `DLT - Orphan Cleanup ${suffix}`,
      queryString: new QueryString({
        fields: ["@timestamp", "logEvent", "message", "region", "cluster", "orphanCount", "orphanTestIds"],
        filterStatements: ['logEvent = "ORPHAN_DETECTED"'],
        sort: "@timestamp desc",
        limit: 50,
      }),
      logGroups: [props.orphanCleanupLogGroup],
    });
  }
}
