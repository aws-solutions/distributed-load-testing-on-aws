// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { withRetry, isRetryable, internals } = require("./retry");

describe("retry helper", () => {
  beforeEach(() => {
    // Replace sleep with a no-op so tests don't actually wait
    internals.sleep = jest.fn().mockResolvedValue(undefined);
  });

  describe("isRetryable", () => {
    it("should return true for ThrottlingException", () => {
      const err = new Error("throttled");
      err.name = "ThrottlingException";
      expect(isRetryable(err)).toBe(true);
    });

    it("should return true for InternalServerException", () => {
      const err = new Error("internal");
      err.name = "InternalServerException";
      expect(isRetryable(err)).toBe(true);
    });

    it("should return false for AccessDeniedException", () => {
      const err = new Error("denied");
      err.name = "AccessDeniedException";
      expect(isRetryable(err)).toBe(false);
    });

    it("should return false for ValidationException", () => {
      const err = new Error("invalid");
      err.name = "ValidationException";
      expect(isRetryable(err)).toBe(false);
    });

    it("should return false for ResourceNotFoundException", () => {
      const err = new Error("not found");
      err.name = "ResourceNotFoundException";
      expect(isRetryable(err)).toBe(false);
    });

    it("should return false for ConflictException", () => {
      const err = new Error("conflict");
      err.name = "ConflictException";
      expect(isRetryable(err)).toBe(false);
    });

    it("should return false for ServiceQuotaExceededException", () => {
      const err = new Error("quota");
      err.name = "ServiceQuotaExceededException";
      expect(isRetryable(err)).toBe(false);
    });

    it("should return false for ContentSizeExceededException", () => {
      const err = new Error("too large");
      err.name = "ContentSizeExceededException";
      expect(isRetryable(err)).toBe(false);
    });

    it("should return false for generic errors", () => {
      const err = new Error("something went wrong");
      expect(isRetryable(err)).toBe(false);
    });
  });

  describe("withRetry", () => {
    it("should return result on first successful attempt", async () => {
      const fn = jest.fn().mockResolvedValue("success");
      const result = await withRetry(fn);
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(internals.sleep).not.toHaveBeenCalled();
    });

    it("should retry on retryable error and succeed on next attempt", async () => {
      const throttleErr = new Error("throttled");
      throttleErr.name = "ThrottlingException";
      const fn = jest.fn().mockRejectedValueOnce(throttleErr).mockResolvedValueOnce("recovered");

      const result = await withRetry(fn);
      expect(result).toBe("recovered");
      expect(fn).toHaveBeenCalledTimes(2);
      expect(internals.sleep).toHaveBeenCalledTimes(1);
    });

    it("should throw immediately on non-retryable error", async () => {
      const validationErr = new Error("bad input");
      validationErr.name = "ValidationException";
      const fn = jest.fn().mockRejectedValueOnce(validationErr);

      await expect(withRetry(fn)).rejects.toThrow("bad input");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(internals.sleep).not.toHaveBeenCalled();
    });

    it("should throw after exhausting max retries", async () => {
      const throttleErr = new Error("persistent throttle");
      throttleErr.name = "ThrottlingException";
      const fn = jest.fn().mockRejectedValue(throttleErr);

      await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow("persistent throttle");
      // 1 initial + 3 retries = 4 total
      expect(fn).toHaveBeenCalledTimes(4);
      expect(internals.sleep).toHaveBeenCalledTimes(3);
    });

    it("should respect custom maxRetries option", async () => {
      const serverErr = new Error("server error");
      serverErr.name = "InternalServerException";
      const fn = jest.fn().mockRejectedValue(serverErr);

      await expect(withRetry(fn, { maxRetries: 1 })).rejects.toThrow("server error");
      // 1 initial + 1 retry = 2 total
      expect(fn).toHaveBeenCalledTimes(2);
      expect(internals.sleep).toHaveBeenCalledTimes(1);
    });

    it("should call sleep between retries with computed delay values", async () => {
      const throttleErr = new Error("throttled");
      throttleErr.name = "ThrottlingException";
      const fn = jest
        .fn()
        .mockRejectedValueOnce(throttleErr)
        .mockRejectedValueOnce(throttleErr)
        .mockResolvedValueOnce("done");

      await withRetry(fn);
      // sleep called twice (before retry 1 and retry 2)
      expect(internals.sleep).toHaveBeenCalledTimes(2);
      // Each delay should be a non-negative number
      for (const call of internals.sleep.mock.calls) {
        expect(call[0]).toBeGreaterThanOrEqual(0);
        expect(typeof call[0]).toBe("number");
      }
    });

    it("should cap delay at capMs regardless of attempt count", async () => {
      const throttleErr = new Error("throttled");
      throttleErr.name = "ThrottlingException";
      const fn = jest.fn().mockRejectedValue(throttleErr);

      await expect(withRetry(fn, { maxRetries: 5, capMs: 2000 })).rejects.toThrow("throttled");
      // All delays should be less than capMs
      for (const call of internals.sleep.mock.calls) {
        expect(call[0]).toBeLessThan(2000);
      }
    });

    it("should succeed on the last allowed retry", async () => {
      const throttleErr = new Error("throttled");
      throttleErr.name = "ThrottlingException";
      const fn = jest
        .fn()
        .mockRejectedValueOnce(throttleErr)
        .mockRejectedValueOnce(throttleErr)
        .mockRejectedValueOnce(throttleErr)
        .mockResolvedValueOnce("last-chance");

      const result = await withRetry(fn, { maxRetries: 3 });
      expect(result).toBe("last-chance");
      expect(fn).toHaveBeenCalledTimes(4);
    });
  });
});
