// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export type Result<T, E> =
  | { ok: true; data: T }
  | { ok: false; error: E };
