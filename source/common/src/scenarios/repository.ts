// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { Result } from "../data/result.ts";
import { ConflictError, NotFoundError, InvalidDataError } from "../data/errors.ts";
import { scenarioRecordSchema } from "./schema.ts";
import type { ScenarioRecord } from "./schema.ts";
import { ACTIVE_RUN_STATUSES, CANCELABLE_RUN_STATUSES, TestStatus } from "../test-execution.ts";

export interface ScenariosRepositoryConfig {
  readonly ddbClient: DynamoDBDocumentClient;
  readonly tableName: string;
}

/**
 * Data access for the scenarios table. Owns the read/write boundary: callers
 * receive validated domain types and typed errors, never raw DynamoDB items.
 */
export class ScenariosRepository {
  private readonly ddbClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(config: ScenariosRepositoryConfig) {
    this.ddbClient = config.ddbClient;
    this.tableName = config.tableName;
  }

  /**
   * Reads a scenario by id and validates it against the shared schema.
   * Returns NotFoundError if the item is absent, InvalidDataError if the
   * stored record fails validation (e.g. corruption or pre-migration shape).
   */
  async get(testId: string): Promise<Result<ScenarioRecord, NotFoundError | InvalidDataError>> {
    const response = await this.ddbClient.send(new GetCommand({ TableName: this.tableName, Key: { testId } }));
    if (!response.Item) {
      return { ok: false, error: new NotFoundError(`testId '${testId}' not found`) };
    }
    const parsed = scenarioRecordSchema.safeParse(response.Item);
    if (!parsed.success) {
      return { ok: false, error: new InvalidDataError(parsed.error.message) };
    }
    return { ok: true, data: parsed.data };
  }

  /**
   * Atomically claims the single run slot for a scenario by transitioning its
   * status to "queued", but only when the scenario is not already in an active
   * run state (see ACTIVE_RUN_STATUSES). Because the conditional write is atomic
   * per item, concurrent start requests for the same scenario cannot both
   * succeed: exactly one wins the claim and the others receive ConflictError.
   *
   * Only "status" is written, so the prior run's other fields (startTime,
   * results, taskFailureCount) are left intact until the caller persists the
   * full record — which lets a failed start be cleanly reverted.
   *
   * Returns ConflictError when an active run already holds the slot.
   */
  async tryClaimRunSlot(testId: string): Promise<Result<void, ConflictError>> {
    // Build the IN (...) placeholders and values from the single source of
    // truth so the condition can never drift from ACTIVE_RUN_STATUSES.
    const values: Record<string, string> = { ":queued": TestStatus.QUEUED };
    const placeholders = [...ACTIVE_RUN_STATUSES].map((status, index) => {
      const key = `:active${index}`;
      values[key] = status;
      return key;
    });
    try {
      await this.ddbClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { testId },
          UpdateExpression: "SET #status = :queued",
          ConditionExpression: `attribute_not_exists(#status) OR NOT (#status IN (${placeholders.join(", ")}))`,
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: values,
        })
      );
      return { ok: true, data: undefined };
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return { ok: false, error: new ConflictError(`testId '${testId}' already has an active run`) };
      }
      throw error;
    }
  }

  /**
   * Atomically transitions a run to "cancelling", but only when the scenario is
   * in a cancelable state (see CANCELABLE_RUN_STATUSES — the active states minus
   * the finishing ones CLEANING_UP/PARSING_RESULTS, where a cancel has little
   * value and would race the terminal metadata write).
   * Mirrors {@link tryClaimRunSlot}: because the conditional write is atomic, a
   * cancel that races a run reaching a terminal state cannot overwrite the
   * terminal status — the condition simply fails instead. This is what keeps the
   * scenario status consistent with the run/history record.
   *
   * CANCELLING is itself an active status, so re-cancelling a run whose cleanup
   * is already in progress remains idempotent.
   *
   * Returns ConflictError when the run is not in a cancelable state (nothing to
   * cancel), which the API surfaces as 409.
   */
  async tryTransitionToCancelling(testId: string): Promise<Result<void, ConflictError>> {
    // Use CANCELABLE_RUN_STATUSES as the single source of truth so this guard
    // can never drift; the finishing states are intentionally excluded.
    const values: Record<string, string> = { ":cancelling": TestStatus.CANCELLING };
    const placeholders = [...CANCELABLE_RUN_STATUSES].map((status, index) => {
      const key = `:cancelable${index}`;
      values[key] = status;
      return key;
    });
    try {
      await this.ddbClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { testId },
          UpdateExpression: "SET #status = :cancelling",
          ConditionExpression: `#status IN (${placeholders.join(", ")})`,
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: values,
        })
      );
      return { ok: true, data: undefined };
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        return { ok: false, error: new ConflictError(`testId '${testId}' is not in a cancelable state`) };
      }
      throw error;
    }
  }
}
