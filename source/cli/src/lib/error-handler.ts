// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Wraps a Commander action handler with consistent error formatting.
 *
 * Usage in command registration:
 *   .action(withErrorHandler(handleMyCommand))
 */
export function withErrorHandler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>
): (...args: Args) => Promise<void> {
  return async (...args: Args): Promise<void> => {
    try {
      await fn(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  };
}
