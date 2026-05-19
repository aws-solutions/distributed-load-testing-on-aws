// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Orphan Cleanup Lambda — scheduled hourly to detect and delete leaked
 * ECS services that have no active Step Functions execution.
 *
 * This is Layer 3 of the 3-layer ECS service safety net:
 *   Layer 1: Step function catch-all routes to Task Canceler on any error
 *   Layer 2: EventBridge rule triggers Task Failure Handler on SF failure
 *   Layer 3: This Lambda runs on a schedule to catch anything layers 1–2 missed
 *
 * Flow:
 *   1. Scan DynamoDB for all deployed region configurations (cluster ARNs)
 *   2. Query Step Functions for all RUNNING execution testIds
 *   3. List all `dlt-*` ECS services across all clusters
 *   4. Cross-reference: any service whose testId is NOT in the active set is orphaned
 *   5. Scale down and force-delete orphaned services
 *   6. Publish `OrphanCleanupFailures` metric to CloudWatch
 */

import { createLogger, getAwsClientConfig, getRequiredEnv, LogEvent } from "@amzn/dlt-common";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ECSClient } from "@aws-sdk/client-ecs";
import { SFNClient } from "@aws-sdk/client-sfn";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getActiveTestIds } from "./execution-check.js";
import { publishFailureCount } from "./metrics.js";
import { getAllRegionConfigs } from "./region-config.js";
import { cleanupOrphanedServices } from "./service-cleanup.js";
import type { DiscoveredService } from "./service-scanner.js";
import { findOrphans, listDltServices } from "./service-scanner.js";

const SOLUTION_ID = getRequiredEnv("SOLUTION_ID");
const VERSION = getRequiredEnv("VERSION");
const SCENARIOS_TABLE = getRequiredEnv("SCENARIOS_TABLE");
const STATE_MACHINE_ARN = getRequiredEnv("STATE_MACHINE_ARN");

export async function handler(): Promise<void> {
  const logger = createLogger({ serviceName: "OrphanCleanup", solutionId: SOLUTION_ID, version: VERSION });
  logger.info("Orphan cleanup invoked");

  const ddbClient = new DynamoDBClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }));
  const ddb = DynamoDBDocumentClient.from(ddbClient);
  const sfn = new SFNClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }));
  const cw = new CloudWatchClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION }));

  let totalOrphansDetected = 0;

  try {
    // Step 1: Discover all deployed region configurations
    const regionConfigs = await getAllRegionConfigs(ddb, SCENARIOS_TABLE, logger);

    if (regionConfigs.length === 0) {
      logger.info("No region configurations found — nothing to scan");
      await publishFailureCount(cw, 0, logger);
      return;
    }

    // Step 2: Get all testIds with active Step Functions executions
    const activeTestIds = await getActiveTestIds(sfn, STATE_MACHINE_ARN, logger);

    // Step 3 + 4: For each cluster, list DLT services and find orphans
    let allOrphans: DiscoveredService[] = [];

    for (const config of regionConfigs) {
      const ecs = new ECSClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION, region: config.region }));
      const services = await listDltServices(ecs, config.taskCluster, logger);
      const orphans = findOrphans(services, activeTestIds);

      if (orphans.length > 0) {
        logger.warn("Orphaned services detected", {
          logEvent: LogEvent.ORPHAN_DETECTED,
          cluster: config.taskCluster,
          region: config.region,
          orphanCount: orphans.length,
          orphanTestIds: orphans.map((o) => o.testId),
        });
        allOrphans = allOrphans.concat(orphans);
      }
    }

    totalOrphansDetected = allOrphans.length;

    if (allOrphans.length === 0) {
      logger.info("No orphaned services found");
      await publishFailureCount(cw, 0, logger);
      return;
    }

    // Step 5: Clean up orphaned services
    // Group by region so we reuse ECS clients
    const orphansByRegion = new Map<string, DiscoveredService[]>();
    for (const orphan of allOrphans) {
      const existing = orphansByRegion.get(orphan.region) ?? [];
      existing.push(orphan);
      orphansByRegion.set(orphan.region, existing);
    }

    const regionCleanupResults = await Promise.all(
      [...orphansByRegion.entries()].map(async ([region, orphans]) => {
        const ecs = new ECSClient(getAwsClientConfig({ solutionId: SOLUTION_ID, version: VERSION, region }));
        return cleanupOrphanedServices({ ecs, orphans, logger });
      })
    );

    const totalFailures = regionCleanupResults
      .flat()
      .filter((r) => !r.success).length;

    // Step 6: Publish failure metric
    await publishFailureCount(cw, totalFailures, logger);

    if (totalFailures > 0) {
      logger.error("Some orphaned services could not be deleted", {
        totalOrphans: totalOrphansDetected,
        totalFailures,
      });
    }
  } catch (error: unknown) {
    // Handler-level error — none of the orphans were cleaned up.
    // Publish the total orphan count as the failure value so the alarm fires.
    logger.error("Orphan cleanup handler failed", { error });
    await publishFailureCount(cw, Math.max(totalOrphansDetected, 1), logger);
    throw error;
  }
}
