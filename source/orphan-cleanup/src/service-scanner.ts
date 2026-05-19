// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Scans ECS clusters for DLT services and identifies orphans.
 *
 * A DLT service follows the naming pattern `dlt-{testId}-{region}`.
 * A service is orphaned if its testId has no active Step Functions execution.
 */

import { DLT_SERVICE_PREFIX, type Logger } from "@amzn/dlt-common";
import { ECSClient, paginateListServices } from "@aws-sdk/client-ecs";

/**
 * Regex matching DLT service names: `{DLT_SERVICE_PREFIX}{testId}-{region}`
 * testId is a UUID (hex + hyphens), region is like us-east-1.
 * Uses the shared DLT_SERVICE_PREFIX constant from @amzn/dlt-common.
 */
const DLT_SERVICE_NAME_PATTERN = new RegExp(`^${DLT_SERVICE_PREFIX}(.+)-([a-z]{2}-[a-z]+-\\d+)$`);

/** A DLT service discovered in an ECS cluster */
export interface DiscoveredService {
  readonly serviceArn: string;
  readonly serviceName: string;
  readonly testId: string;
  readonly region: string;
  readonly cluster: string;
}

/**
 * Extracts testId and region from a DLT service name.
 * Returns `undefined` if the name doesn't match the DLT pattern.
 */
export function parseDltServiceName(serviceName: string): { testId: string; region: string } | undefined {
  const match = DLT_SERVICE_NAME_PATTERN.exec(serviceName);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return { testId: match[1], region: match[2] };
}

/**
 * Lists all DLT services in a cluster, extracting testId from the service name.
 * Non-DLT services (names not matching `dlt-*`) are silently skipped.
 */
export async function listDltServices(
  ecs: ECSClient,
  cluster: string,
  logger: Logger
): Promise<readonly DiscoveredService[]> {
  const services: DiscoveredService[] = [];

  const paginator = paginateListServices({ client: ecs }, { cluster });

  for await (const page of paginator) {
    for (const serviceArn of page.serviceArns ?? []) {
      // Service ARN format: arn:aws:ecs:{region}:{account}:service/{cluster}/{name}
      const serviceName = serviceArn.split("/").pop();
      if (!serviceName) {
        continue;
      }

      const parsed = parseDltServiceName(serviceName);
      if (parsed) {
        services.push({
          serviceArn,
          serviceName,
          testId: parsed.testId,
          region: parsed.region,
          cluster,
        });
      }
    }
  }

  logger.info("Listed DLT services in cluster", { cluster, serviceCount: services.length });
  return services;
}

/**
 * Identifies orphaned services by cross-referencing discovered services
 * against the set of active testIds (from Step Functions).
 *
 * A service is orphaned if its testId is NOT in the activeTestIds set.
 */
export function findOrphans(
  services: readonly DiscoveredService[],
  activeTestIds: ReadonlySet<string>
): readonly DiscoveredService[] {
  return services.filter((s) => !activeTestIds.has(s.testId));
}
