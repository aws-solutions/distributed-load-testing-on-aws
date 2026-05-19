// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Boundary-cast JSON parser for payloads where DLT owns both sides
 * of the contract. Use this instead of raw `JSON.parse` when
 * deserializing trusted internal payloads (step function input,
 * Lambda event payloads between DLT Lambdas, DDB attribute values).
 *
 * For untrusted external input, use schema validation (e.g. zod).
 */
export function parseSafeJson<T>(json: string): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error("Invalid JSON payload");
  }
}
