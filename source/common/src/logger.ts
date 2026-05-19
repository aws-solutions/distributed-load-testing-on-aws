// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Factory for creating structured loggers using AWS Lambda Powertools.
 *
 * Each Lambda handler creates its own logger instance via `createLogger()`,
 * passing in the service name and solution metadata explicitly. This keeps
 * environment variable dependencies visible at each call site rather than
 * hiding them inside the factory.
 *
 * Usage in a Lambda handler:
 * ```ts
 * import { createLogger } from "@amzn/dlt-common";
 *
 * const logger = createLogger({
 *   serviceName: "TaskRunner",
 *   solutionId: process.env.SOLUTION_ID,
 *   version: process.env.VERSION,
 * });
 *
 * // Add per-invocation correlation keys
 * logger.appendKeys({ testId, testRunId, region });
 * ```
 */

import { Logger } from "@aws-lambda-powertools/logger";

/** Re-export Logger type so consumers can type function parameters without a direct Powertools dependency */
export type { Logger } from "@aws-lambda-powertools/logger";

export interface CreateLoggerParams {
  /** Identifies which Lambda function emitted the log (e.g. "TaskRunner") */
  readonly serviceName: string;
  /** DLT Solution ID — propagated as a persistent log attribute */
  readonly solutionId: string;
  /** DLT solution version — propagated as a persistent log attribute */
  readonly version: string;
}

/**
 * Creates a Powertools Logger with DLT-standard persistent attributes.
 *
 * The returned logger includes `solutionId` and `version` on every log entry.
 * Handlers should call `logger.appendKeys()` to add per-invocation context
 * like `testId`, `testRunId`, and `region`.
 */
export function createLogger(params: CreateLoggerParams): Logger {
  return new Logger({
    serviceName: params.serviceName,
    persistentLogAttributes: {
      solutionId: params.solutionId,
      version: params.version,
    },
  });
}
