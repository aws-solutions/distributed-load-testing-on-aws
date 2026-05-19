// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Discovers all deployed DLT regional infrastructure configurations.
 *
 * Reuses the same DynamoDB pattern as {@link source/api-services/lib/scenarios/index.js}
 * `getAllRegionConfigs()`. Each deployed stack (main + regional) stores one entry
 * with `testId: "region-{AWS_REGION}"` containing the cluster name, subnets, etc.
 *
 * The scan is filtered to `testId BEGINS_WITH "region"` entries only — a very small
 * result set (typically 1–5 items, one per deployed region).
 */

import type { Logger } from "@amzn/dlt-common";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

export interface RegionInfraConfig {
  readonly testId: string;
  readonly region: string;
  readonly taskCluster: string;
  readonly ecsCloudWatchLogGroup: string;
}

/**
 * Validates and extracts a {@link RegionInfraConfig} from a raw DDB item.
 *
 * This table is shared across multiple writers (CDK custom resources, API layer,
 * step functions), so we validate shape rather than trusting a boundary cast.
 * Returns `undefined` if the item is malformed.
 */
function parseRegionInfraConfig(item: Record<string, unknown>): RegionInfraConfig | undefined {
  const testId = item["testId"];
  const region = item["region"];
  const taskCluster = item["taskCluster"];
  const ecsCloudWatchLogGroup = item["ecsCloudWatchLogGroup"];

  if (
    typeof testId === "string" &&
    typeof region === "string" &&
    typeof taskCluster === "string" &&
    typeof ecsCloudWatchLogGroup === "string"
  ) {
    return { testId, region, taskCluster, ecsCloudWatchLogGroup };
  }
  return undefined;
}

export async function getAllRegionConfigs(
  ddb: DynamoDBDocumentClient,
  scenariosTable: string,
  logger: Logger
): Promise<readonly RegionInfraConfig[]> {
  const configs: RegionInfraConfig[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: scenariosTable,
        FilterExpression: "begins_with(#tid, :prefix) AND #cluster <> :empty",
        ExpressionAttributeNames: {
          "#tid": "testId",
          "#cluster": "taskCluster",
        },
        ExpressionAttributeValues: {
          ":prefix": "region",
          ":empty": "",
        },
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    if (result.Items) {
      for (const item of result.Items) {
        const config = parseRegionInfraConfig(item);
        if (config) {
          configs.push(config);
        } else {
          logger.error("Skipping malformed region config entry", { item });
        }
      }
    }

    // SDK types ExclusiveStartKey as Record<string, AttributeValue> but we need Record<string, unknown>
    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  logger.info("Discovered region configs", { regionCount: configs.length });
  return configs;
}
