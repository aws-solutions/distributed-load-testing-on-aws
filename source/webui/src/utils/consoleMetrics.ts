// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const METRICS_ENDPOINT = "https://metrics.awssolutionsbuilder.com/page";
const SOLUTION_ID = "SO0062";
const SESSION_ID_KEY = "dlt-console-session-id";
const SESSION_START_KEY = "dlt-console-session-start";

let _deploymentId: string | undefined;
let _version: string | undefined;
let _accountId: string | undefined;

/**
 * Cache stack info for all future metric calls.
 * Call once from App.tsx after the first stackInfo load.
 */
export function initConsoleMetrics(stackInfo: { deployment_id?: string; version?: string; account_id?: string }): void {
  _deploymentId = stackInfo.deployment_id;
  _version = stackInfo.version;
  _accountId = stackInfo.account_id;
}

export function getSessionId(): string {
  let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    sessionStorage.setItem(SESSION_START_KEY, String(Date.now()));
  }
  return sessionId;
}

/** Reset session ID so metrics map to individual authenticated sessions. */
export function resetSessionId(): void {
  sessionStorage.removeItem(SESSION_ID_KEY);
  sessionStorage.removeItem(SESSION_START_KEY);
}

/**
 * Sends a console metric directly to the metrics endpoint.
 * Fire-and-forget — errors are logged but never thrown.
 * Uses cached stack info from initConsoleMetrics().
 *
 * @param type - The metric event type (e.g. "LoginSuccess")
 * @param data - Additional metric fields
 */
export async function sendConsoleMetric(
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!_deploymentId) {
    console.warn("sendConsoleMetric: deploymentId not available, skipping metric:", type);
    return;
  }
  try {
    const payload = {
      Solution: SOLUTION_ID,
      UUID: _deploymentId,
      TimeStamp: new Date().toISOString().replace("T", " ").replace("Z", ""),
      Version: _version ?? "unknown",
      MetricSchemaVersion: 1,
      ...(_accountId && { AccountId: _accountId }),
      Data: { Type: type, SessionId: getSessionId(), ...data },
    };
    await fetch(METRICS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("Failed to send console metric:", err);
  }
}

/**
 * Sends a SessionEnd metric using fetch with keepalive for reliability during page unload.
 * Includes SessionId and SessionDuration (milliseconds).
 * Uses cached stack info from initConsoleMetrics().
 */
export function sendSessionEndMetric(): void {
  if (!_deploymentId) return;
  // Skip if session was already reset (e.g. after explicit sign-out)
  if (!sessionStorage.getItem(SESSION_ID_KEY)) return;
  const sessionStart = sessionStorage.getItem(SESSION_START_KEY);
  const sessionDuration = sessionStart ? Date.now() - Number(sessionStart) : 0;
  const payload = {
    Solution: SOLUTION_ID,
    UUID: _deploymentId,
    TimeStamp: new Date().toISOString().replace("T", " ").replace("Z", ""),
    Version: _version ?? "unknown",
    MetricSchemaVersion: 1,
    ...(_accountId && { AccountId: _accountId }),
    Data: { Type: "SessionEnd", SessionId: getSessionId(), SessionDurationMs: sessionDuration },
  };
  fetch(METRICS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}
