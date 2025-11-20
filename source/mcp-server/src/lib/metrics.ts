// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { getMetricUrl, getSolutionId, getUuid, getVersion } from './config';

export type ToolUsageMetric = {
  Type: string;
  MetricSchemaVersion: number;
  UserAgent: string;
  ToolName: string;
  TokenCount: number;
  DurationMs: number;
  Status: "success" | "failure";
  StatusCode: number;
};

export const toolUsageMetricType = "ToolUsage";
export const toolUsageMetricSchemaVersion = 1;
export const toolUsageUserAgent = "dlt-mcp-server";

/**
 * Approximates token count using 1 token = 4 characters rule.
 * Actual token count is dependent on the LLM which we are not aware of during tool invocations.
 * @param text - the text to calculate tokens for
 * @returns estimated token count
 */
export function approximateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Sends anonymized tool usage metrics
 * @param metric - the tool usage data
 * @returns HTTP status code or undefined if failed
 */
export async function sendToolUsageMetric(metric: ToolUsageMetric): Promise<void> {
  try {
    const metrics = {
      Solution: getSolutionId(),
      UUID: getUuid(),
      // Date and time instant in a java.sql.Timestamp compatible format
      TimeStamp: new Date().toISOString().replace("T", " ").replace("Z", ""),
      Version: getVersion(),
      Data: metric,
    };

    const response = await fetch(getMetricUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metrics),
    });

    if (response.status !== 200) {
      console.error(`Failed to send tool usage metrics: ${response.status} ${response.statusText}`)
    }

  } catch (err) {
    // silently catch errors
    console.error("Failed to send tool usage metrics:", err);
  }
}
