// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { expect, vi } from "vitest";
import type { HttpClientOptions, HttpResponse } from "../src/lib/http-client.js";

/**
 * Type-safe mock HTTP client interface
 * Avoids 'as any' assertions and provides proper typing for test mocks
 */
export interface MockHttpClient {
  get: ReturnType<typeof vi.fn<(url: string, headers?: Record<string, string>) => Promise<HttpResponse>>>;
  request: ReturnType<typeof vi.fn<(options: HttpClientOptions) => Promise<HttpResponse>>>;
}

/**
 * Common test response types
 */
export interface ErrorResponse {
  error: string;
}

export interface TestRunArtifactsResult {
  bucketName: string;
  testRunPath: string;
  testScenarioPath: string;
  description: string;
}

/**
 * Creates a properly typed mock HTTP client
 * Eliminates @typescript-eslint/no-explicit-any and @typescript-eslint/no-unsafe-assignment errors
 */
export function createMockHttpClient(): MockHttpClient {
  return {
    get: vi.fn<(url: string, headers?: Record<string, string>) => Promise<HttpResponse>>(),
    request: vi.fn<(options: HttpClientOptions) => Promise<HttpResponse>>(),
  };
}

/**
 * Helper to setup a successful mock response
 * Reduces boilerplate in test files
 */
export function mockSuccessResponse(
  mock: MockHttpClient,
  body: unknown,
  statusCode = 200,
  headers: Record<string, string> = {}
): void {
  const response: HttpResponse = {
    statusCode,
    body: JSON.stringify(body),
    headers,
  };
  mock.get.mockResolvedValue(response);
}

/**
 * Helper to setup a mock error response
 */
export function mockErrorResponse(mock: MockHttpClient, statusCode: number, body: string): void {
  const response: HttpResponse = {
    statusCode,
    body,
    headers: {},
  };
  mock.get.mockResolvedValue(response);
}

/**
 * Helper to setup a mock network error
 */
export function mockNetworkError(mock: MockHttpClient, errorMessage: string): void {
  mock.get.mockRejectedValue(new Error(errorMessage));
}

/**
 * Type-safe assertion helper for HTTP GET calls
 * Eliminates @typescript-eslint/unbound-method errors
 */
export function expectGetCalledWith(mock: MockHttpClient, expectedUrl: string): void {
  expect(mock.get).toHaveBeenCalledWith(expectedUrl);
}

/**
 * Type-safe assertion helper for checking if GET was called with a URL containing a substring
 */
export function expectGetCalledWithContaining(mock: MockHttpClient, urlSubstring: string): void {
  expect(mock.get).toHaveBeenCalledWith(expect.stringContaining(urlSubstring));
}

/**
 * Helper to assert that a promise rejects with an AppError of a specific code
 * Eliminates repetitive try/catch blocks and duplicate function calls
 *
 * @example
 * await expectAppError(
 *   () => handleGetTestRun(mockClient, endpoint, event),
 *   400,
 *   "Validation failed"
 * );
 */
export async function expectAppError(
  fn: () => Promise<unknown>,
  expectedCode: number,
  messageContains?: string
): Promise<void> {
  expect.assertions(messageContains ? 2 : 1);

  try {
    await fn();
    // If we get here, the function didn't throw
    throw new Error("Expected function to throw AppError but it did not");
  } catch (error) {
    // Type guard to check if error has required properties
    if (error && typeof error === "object" && "code" in error) {
      expect((error as { code: number }).code).toBe(expectedCode);
      if (messageContains && "message" in error) {
        expect((error as { code: number; message: string }).message).toContain(messageContains);
      }
    } else {
      throw error;
    }
  }
}
