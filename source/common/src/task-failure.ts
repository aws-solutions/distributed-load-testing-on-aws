// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * DynamoDB schema additions for the task failure detection system.
 *
 * When an ECS task stops unexpectedly during a load test, the Task Failure
 * Handler Lambda atomically increments a failure counter in the DynamoDB
 * scenario record and checks whether the healthy task percentage has dropped
 * below the configured threshold. If so, it invokes the Task Canceler to
 * abort the test.
 *
 * The EventBridge event shape (ECS Task State Change) is validated at runtime
 * in the task-failure-handler package — not defined here — because there is
 * no authoritative npm type package for ECS-specific EventBridge detail payloads.
 */

import { stripVTControlCharacters } from "node:util";

/**
 * Fields added to the DynamoDB scenario record for failure tracking.
 *
 * These are updated atomically by the Task Failure Handler Lambda using
 * a conditional DynamoDB UpdateExpression.
 */
export interface TaskFailureTrackingFields {
  /** Running count of tasks that exited unexpectedly during this test run */
  readonly taskFailureCount: number;
  /**
   * Minimum percentage (0–100) of tasks that must remain healthy for the
   * test to continue. Configurable per test scenario; default is 90.
   */
  readonly healthyThreshold: number;
}

/**
 * High-level classification of why an ECS task stopped.
 *
 * Used by the Task Failure Handler to categorize each task death for
 * both operational metrics (`TaskFailure.StopCategory`) and structured
 * logs.
 *
 * Current classification is intentionally conservative — the container's
 * exit codes do not yet distinguish between setup failures (download,
 * extract, checksum) and test script errors. Both currently use exit
 * code 1. A future task should introduce meaningful exit codes in
 * `load-test.sh` to enable finer-grained classification.
 *
 * @see docs/metrics-reference.md Section 2, TaskFailure event.
 * @see deployment/ecr/distributed-load-testing-on-aws-load-tester/load-test.sh
 */
export enum StopCategory {
  /** Container killed with exit code 137 — out of memory (SIGKILL / OOM) */
  OutOfMemory = "oom",
  /** ECS/Fargate infrastructure issue (placement failure, spot interruption, etc.) */
  Infrastructure = "infrastructure",
  /** bzt exited with a non-zero code (exit code 2) */
  BztError = "bzt_error",
  /** Container exited with non-zero code — cause not yet classifiable */
  ContainerError = "container_error",
  /** None of the above conditions matched */
  Unknown = "unknown",
}

/** ECS stop codes that indicate infrastructure-level failures. */
const INFRASTRUCTURE_STOP_CODES: ReadonlySet<string> = new Set([
  "TaskFailedToStart",
  "ServiceSchedulerInitiated",
  "SpotInterruption",
]);

/**
 * Classifies an ECS task stop into a high-level category.
 *
 * Classification logic:
 * - exitCode 2 → BztError (test framework failed)
 * - exitCode 137 → OOM (SIGKILL, typically from cgroup memory limit)
 * - stopCode in {TaskFailedToStart, ServiceSchedulerInitiated, SpotInterruption} → Infrastructure
 * - exitCode is a non-zero number (excluding 143) → ContainerError (could be setup failure
 *   or test script error — load-test.sh uses exit 1 for both)
 * - exitCode 0 or 143 (SIGTERM), undefined, or unrecognized → Unknown
 *
 * @param stopCode - The ECS `stopCode` field from the task state change event
 * @param exitCode - The container's exit code (`undefined` if the container never ran)
 * @returns The classified {@link StopCategory}
 */
export function classifyStopCode(stopCode: string, exitCode: number | undefined): StopCategory {
  if (exitCode === 2) {
    return StopCategory.BztError;
  }

  if (exitCode === 137) {
    return StopCategory.OutOfMemory;
  }

  if (INFRASTRUCTURE_STOP_CODES.has(stopCode)) {
    return StopCategory.Infrastructure;
  }

  // 143 = 128 + 15 (SIGTERM) — standard exit code when ECS sends SIGTERM
  // during normal shutdown (desiredCount=0, scale-down, spot draining).
  if (typeof exitCode === "number" && exitCode !== 0 && exitCode !== 143) {
    return StopCategory.ContainerError;
  }

  return StopCategory.Unknown;
}

/**
 * Sensitive token patterns redacted from the free-text ECS stop reason before it
 * is emitted as an operational metric attribute, applied in priority order:
 *
 *  1. PII — data that identifies a person. Per the AWS-wide PII definition,
 *     email and IP addresses are PII, so they are stripped first.
 *  2. Credentials / secrets. These five patterns intentionally mirror the
 *     DevOps-agent denylist in
 *     `source/api-services/lib/investigations/artifacts.js`; the two lists are
 *     kept in sync by hand rather than shared, to avoid coupling this metric
 *     path to that agent feature.
 *  3. Customer / account-identifying data (Personal Data, not strictly PII):
 *     ECR image URIs, ARNs, S3 URIs, and bare AWS account IDs.
 *
 * Ordering matters: composite tokens (ECR URIs, ARNs, S3 URIs) are redacted
 * before the bare 12-digit account-id catch-all so the account id embedded in
 * them isn't replaced piecemeal first.
 */
const SENSITIVE_STOP_REASON_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // ── PII (stripped first) ─────────────────────────────────────────────────
  // Email addresses. Quantifiers are explicitly bounded (local part, domain,
  // and TLD lengths) so the pattern runs in linear time and cannot be driven
  // into super-linear backtracking (ReDoS) by a crafted stop reason.
  [/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g, "<email>"],
  // IPv4 addresses
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>"],
  // IPv6 addresses (including compressed "::" forms)
  [/\b(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{0,4}\b/g, "<ip>"],
  // ── Credentials / secrets (mirror of the DevOps-agent artifact denylist) ──
  // The denylist detects and rejects whole artifacts, so it matches the
  // aws_secret_access_key label alone; here we redact and emit the surrounding
  // text, so we must match the value too. The delimiter is a single run of
  // whitespace/=/: ([\s=:]+, not \s*[=:\s]\s*) so a space- or tab-separated
  // secret is redacted without introducing overlapping quantifiers that could
  // backtrack super-linearly (ReDoS) on a long whitespace run.
  [/AKIA[0-9A-Z]{16}/gi, "<redacted>"],
  [/ASIA[0-9A-Z]{16}/gi, "<redacted>"],
  [/aws_(?:secret_access_key|session_token)[\s=:]+\S+/gi, "<redacted>"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "<redacted>"],
  [/\bauthorization[ \t]*[=:][ \t]*(?:\S+[ \t]+)?\S+/gi, "<redacted>"],
  [/\b(?:x-api-key|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*\S+/gi, "<redacted>"],
  [/password\s*[=:]\s*\S+/gi, "<redacted>"],
  // ── Customer / account-identifying data (Personal Data, not strict PII) ───
  // ECR image URIs — contain account id + customer-named repo/image
  [/\b\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/\S+/gi, "<image>"],
  // ARNs — contain account id + customer resource names
  [/arn:aws[a-z-]*:[^\s"']+/gi, "<arn>"],
  // S3 URIs
  [/s3:\/\/\S+/gi, "<s3-uri>"],
  // Bare AWS account IDs (12 digits) — catch-all, runs last
  [/\b\d{12}\b/g, "<account-id>"],
];

/** Maximum length of the sanitized stop reason emitted as a metric attribute. */
const MAX_STOP_REASON_LENGTH = 1024;

/**
 * Sanitizes and shapes an ECS `stoppedReason` free-text string so it is safe to
 * emit as an operational metric attribute.
 *
 * Redacts PII (email and IP addresses), credentials/secrets, and customer /
 * account-identifying data (ECR image URIs, ARNs, S3 URIs, AWS account IDs),
 * then collapses all whitespace runs to single spaces, trims, and caps the
 * length. This keeps the diagnostic value of the reason while preventing PII and
 * customer data from leaving the customer account.
 *
 * @param stoppedReason - The raw ECS stop reason (free text); defaults to an empty string
 * @returns A sanitized, single-line, length-bounded string
 */
export function sanitizeStopReason(stoppedReason: string = ""): string {
  let sanitized = stripVTControlCharacters(stoppedReason);
  for (const [pattern, replacement] of SENSITIVE_STOP_REASON_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  // Shape into a single clean line and bound the length.
  sanitized = sanitized.replace(/\s+/g, " ").trim();
  if (sanitized.length > MAX_STOP_REASON_LENGTH) {
    sanitized = sanitized.slice(0, MAX_STOP_REASON_LENGTH);
  }
  return sanitized;
}
