// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Exponential backoff with full jitter.
 * Delay = random(0, min(cap, base * 2^attempt))
 *
 * @see https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
 */

const DEFAULT_BASE_MS = 1000;
const DEFAULT_CAP_MS = 4000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Set of exception names that should trigger a retry.
 */
const RETRYABLE_ERRORS = new Set(["ThrottlingException", "InternalServerException"]);

/**
 * Computes the jittered delay for the given attempt.
 * @param {number} attempt - Zero-based attempt index (0 = first retry).
 * @param {number} baseMs - Base delay in milliseconds.
 * @param {number} capMs - Maximum delay cap in milliseconds.
 * @returns {number} Delay in milliseconds.
 */
const computeDelay = (attempt, baseMs = DEFAULT_BASE_MS, capMs = DEFAULT_CAP_MS) => {
  const exponential = baseMs * Math.pow(2, attempt);
  const capped = Math.min(capMs, exponential);
  return Math.floor(Math.random() * capped);
};

/**
 * Sleeps for the specified duration.
 * Exported as a property of `internals` so tests can replace it.
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Internal references that tests can override (dependency injection seam).
 */
const internals = { sleep };

/**
 * Determines whether an error is retryable based on its name.
 * @param {Error} err
 * @returns {boolean}
 */
const isRetryable = (err) => RETRYABLE_ERRORS.has(err.name);

/**
 * Executes an async function with exponential backoff and full jitter on retryable errors.
 *
 * @param {() => Promise<T>} fn - The async function to execute.
 * @param {object} [opts] - Options.
 * @param {number} [opts.maxRetries=3] - Maximum number of retries.
 * @param {number} [opts.baseMs=1000] - Base delay in milliseconds.
 * @param {number} [opts.capMs=4000] - Maximum delay cap in milliseconds.
 * @returns {Promise<T>} The result of fn.
 * @throws The last error if all retries are exhausted, or immediately on non-retryable errors.
 * @template T
 */
const withRetry = async (fn, opts = {}) => {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseMs = opts.baseMs ?? DEFAULT_BASE_MS;
  const capMs = opts.capMs ?? DEFAULT_CAP_MS;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxRetries) {
        throw err;
      }
      const delay = computeDelay(attempt, baseMs, capMs);
      await internals.sleep(delay);
    }
  }
  // Should not reach here, but satisfy linters.
  throw lastError;
};

module.exports = {
  withRetry,
  isRetryable,
  internals,
};
