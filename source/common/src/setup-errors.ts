// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * User-facing classification of load-test *setup* failures — the errors a
 * setup-phase Lambda (chiefly the Task Runner: ECS service creation,
 * task-definition registration, dashboard creation, and the surrounding AWS
 * calls) can hit before the test starts running.
 *
 * This is a deliberately **best-effort allowlist** of the common, actionable
 * causes, not an exhaustive taxonomy of every AWS error. The AWS error surface
 * is open-ended and changes over time, so anything unrecognized maps to
 * {@link SetupErrorCode.Generic}. The raw underlying error is always logged and
 * recorded in the `ServiceCreateFailed` operational metric; only the curated,
 * non-leaky message from {@link SETUP_ERROR_MESSAGES} is surfaced to the UI via
 * the scenario's `errorReason`.
 */
export enum SetupErrorCode {
  /** A previous run's same-named ECS service is still draining. Retryable. */
  Draining = "DRAINING",
  /** AWS throttled the request / rate exceeded. Retryable shortly. */
  Throttling = "THROTTLING",
  /** A service quota or account limit was reached. Needs a limit increase. */
  Quota = "QUOTA",
  /** Insufficient compute capacity to place the test tasks. Retry / reduce load. */
  Capacity = "CAPACITY",
  /** Networking misconfiguration (subnets, security groups, IP exhaustion). */
  Networking = "NETWORKING",
  /** Cause not recognized — safe, non-leaky generic fallback. */
  Generic = "GENERIC",
}

/**
 * Curated, user-facing message for each {@link SetupErrorCode}. These are the
 * only strings that reach the UI; they must stay free of raw AWS internals.
 */
export const SETUP_ERROR_MESSAGES: Record<SetupErrorCode, string> = {
  [SetupErrorCode.Draining]: "A previous run's resources are still stopping. Please wait a few seconds and retry.",
  [SetupErrorCode.Throttling]: "AWS is throttling requests for this account. Please wait a moment and retry.",
  [SetupErrorCode.Quota]:
    "An AWS service quota was reached while starting the test. Reduce the task count or request a limit increase, then retry.",
  [SetupErrorCode.Capacity]:
    "AWS could not provide enough capacity to start the test tasks. Reduce the task count or retry shortly.",
  [SetupErrorCode.Networking]:
    "The test could not start due to a networking configuration issue (subnets, security groups, or available IP addresses). Check the VPC configuration for the affected region.",
  [SetupErrorCode.Generic]: "The load test failed to start. Check the run logs for details.",
};

/**
 * Extracts the SDK exception name and message from any thrown value.
 *
 * May throw on hostile inputs (a throwing getter or `toString`); that is
 * intentional — the single fail-safe boundary lives in {@link classifySetupError},
 * which catches any such failure and falls back to {@link SetupErrorCode.Generic}.
 */
function errorSignals(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  const maybe = error as { name?: unknown; message?: unknown } | null;
  return {
    name: typeof maybe?.name === "string" ? maybe.name : "",
    message: typeof maybe?.message === "string" ? maybe.message : String(error),
  };
}

/**
 * Classifies a setup-phase failure into a {@link SetupErrorCode}.
 *
 * Matching is ordered and prefers structured AWS SDK v3 exception names
 * (`error.name`, e.g. `ThrottlingException`, `ServiceQuotaExceededException`)
 * over message-substring matching, which is brittle across SDK/locale changes
 * and is used only where AWS provides no distinct code (notably the ECS "still
 * Draining" case, which surfaces as a plain message). Unrecognized errors
 * return {@link SetupErrorCode.Generic} — an expected, first-class outcome.
 *
 * Total and side-effect-free: this **never throws** for any input. Error
 * surfacing is observational, so a failure while inspecting the error (a hostile
 * getter, a throwing `toString`) must degrade to {@link SetupErrorCode.Generic}
 * rather than crash the caller's failure path.
 */
export function classifySetupError(error: unknown): SetupErrorCode {
  try {
    const { name, message } = errorSignals(error);
    // Combined haystack lets a single pattern match either the exception name or
    // the message. Draining is checked on the message alone (no distinct code).
    const haystack = `${name} ${message}`;

    if (/is still Draining/i.test(message)) {
      return SetupErrorCode.Draining;
    }
    if (/Throttl|TooManyRequests|RequestLimitExceeded|Rate exceeded/i.test(haystack)) {
      return SetupErrorCode.Throttling;
    }
    if (/ServiceQuotaExceeded|LimitExceeded|quota|limit exceeded|maximum number/i.test(haystack)) {
      return SetupErrorCode.Quota;
    }
    if (/InsufficientCapacity|insufficient capacity|Capacity is unavailable|no container instances/i.test(haystack)) {
      return SetupErrorCode.Capacity;
    }
    if (
      /subnet|security group|network interface|\bENI\b|IP address|InvalidSubnet|InvalidSecurityGroup/i.test(haystack)
    ) {
      return SetupErrorCode.Networking;
    }
    return SetupErrorCode.Generic;
  } catch {
    return SetupErrorCode.Generic;
  }
}

/**
 * Convenience wrapper returning the curated user-facing message for a
 * setup-phase failure — what a caller writes into the scenario `errorReason`.
 *
 * Total: because {@link classifySetupError} never throws and always returns a
 * valid code, this always returns a catalog message and never throws.
 */
export function getSetupErrorReason(error: unknown): string {
  return SETUP_ERROR_MESSAGES[classifySetupError(error)];
}
