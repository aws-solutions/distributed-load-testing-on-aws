// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Base class for application errors.
 */
export abstract class AppError {
  abstract readonly kind: string;
  constructor(readonly message: string) {}
}

export class NotFoundError extends AppError {
  readonly kind = "NotFound";
}

export class InvalidDataError extends AppError {
  readonly kind = "InvalidData";
}

/**
 * A conditional write lost a race or violated an invariant — e.g. a run-slot
 * claim failed because the scenario already has an active run.
 */
export class ConflictError extends AppError {
  readonly kind = "Conflict";
}
