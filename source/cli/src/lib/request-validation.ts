// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Runtime validation of outbound request payloads against the shared zod
 * request schemas from `@amzn/dlt-common`.
 *
 * R2 derives the request payload *types* from these shared schemas, so a
 * renamed/removed field breaks the CLI build. This module adds the cheap
 * runtime counterpart (R3): parse the actual payload just before it leaves the
 * CLI so a malformed value fails locally with a clear, field-level message
 * instead of surfacing as an opaque server `400`.
 *
 * The schemas here are the API's own request validators, so anything the API
 * accepts also passes this check and anything this check rejects the API would
 * reject too — validating locally never rejects a payload the server accepts.
 */

/** Minimal structural view of a zod issue (avoids a direct zod dependency). */
interface ValidationIssue {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

/** Minimal structural view of the `safeParse` surface we rely on. */
interface ValidatingSchema {
  safeParse(data: unknown): { success: true } | { success: false; error: { issues: ValidationIssue[] } };
}

/**
 * Validate an outbound request `payload` against a shared request `schema`.
 *
 * On success this is a no-op: the caller sends the *original* payload, so a
 * valid payload's on-the-wire shape is unchanged (no field stripping, no
 * coercion of what actually gets sent). On failure it throws an Error naming
 * every offending field as `<field>: <message>`, joined by `; `. The thrown
 * Error flows through `withErrorHandler`, which prints `Error: ...` and exits
 * non-zero.
 *
 * @param schema      shared zod request schema (e.g. `createTestSchema`)
 * @param payload     the request body the CLI is about to send
 * @param requestName human-readable request label used in the error prefix
 */
export function validateOutboundRequest(schema: ValidatingSchema, payload: unknown, requestName: string): void {
  const result = schema.safeParse(payload);
  if (result.success) return;

  const details = result.error.issues
    .map((issue) => {
      const field = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
      return `${field}: ${issue.message}`;
    })
    .join("; ");

  throw new Error(`Invalid ${requestName} request: ${details}`);
}
