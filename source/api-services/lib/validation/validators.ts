// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ZodError } from "zod";
import {
  testIdSchema,
  testRunIdSchema,
  pathParametersSchema,
  scenariosQuerySchema,
  scenarioQuerySchema,
  testRunsQuerySchema,
  baselineQuerySchema,
  createTestSchema,
  setBaselineSchema,
  deleteTestRunsSchema,
} from "./schemas";
import { formatZodError, getFirstZodError } from "./errors";

/**
 * Validation functions for API inputs
 * These wrap Zod schemas and provide consistent error handling
 */

/**
 * Validates a testId path parameter
 *
 * @param {string | undefined} testId - The testId to validate
 * @returns {string} The validated testId
 * @throws Error with detailed message if validation fails
 */
export function validateTestId(testId: string | undefined): string {
  try {
    return testIdSchema.parse(testId);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(getFirstZodError(error));
    }
    throw error;
  }
}

/**
 * Validates a testRunId path parameter
 *
 * @param {string | undefined} testRunId - The testRunId to validate
 * @returns {string} The validated testRunId
 * @throws Error with detailed message if validation fails
 */
export function validateTestRunId(testRunId: string | undefined): string {
  try {
    return testRunIdSchema.parse(testRunId);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(getFirstZodError(error));
    }
    throw error;
  }
}

/**
 * Validates path parameters
 *
 * @param {Record<string, string> | undefined} pathParams - The path parameters object
 * @returns {object} The validated path parameters
 * @throws Error with detailed message if validation fails
 */
export function validatePathParameters(pathParams: Record<string, string> | undefined) {
  try {
    return pathParametersSchema.parse(pathParams || {});
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(formatZodError(error));
    }
    throw error;
  }
}

/**
 * Validates query parameters for GET /scenarios
 *
 * @param {Record<string, string> | undefined} queryParams - The query parameters object
 * @returns {object} The validated query parameters
 * @throws Error with detailed message if validation fails
 */
export function validateScenariosQuery(queryParams: Record<string, string> | undefined) {
  try {
    return scenariosQuerySchema.parse(queryParams || {});
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(formatZodError(error));
    }
    throw error;
  }
}

/**
 * Validates query parameters for GET /scenarios/{testId}
 *
 * @param {Record<string, string> | undefined} queryParams - The query parameters object
 * @returns {object} The validated query parameters
 * @throws Error with detailed message if validation fails
 */
export function validateScenarioQuery(queryParams: Record<string, string> | undefined) {
  try {
    return scenarioQuerySchema.parse(queryParams || {});
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(formatZodError(error));
    }
    throw error;
  }
}

/**
 * Validates query parameters for GET /scenarios/{testId}/testruns
 *
 * @param {Record<string, string> | undefined} queryParams - The query parameters object
 * @returns {object} The validated query parameters
 * @throws Error with detailed message if validation fails
 */
export function validateTestRunsQuery(queryParams: Record<string, string> | undefined) {
  try {
    return testRunsQuerySchema.parse(queryParams || {});
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(formatZodError(error));
    }
    throw error;
  }
}

/**
 * Validates query parameters for GET /scenarios/{testId}/baseline
 *
 * @param {Record<string, string> | undefined} queryParams - The query parameters object
 * @returns {object} The validated query parameters
 * @throws Error with detailed message if validation fails
 */
export function validateBaselineQuery(queryParams: Record<string, string> | undefined) {
  try {
    return baselineQuerySchema.parse(queryParams || {});
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(formatZodError(error));
    }
    throw error;
  }
}

/**
 * Validates request body for POST /scenarios
 *
 * @param {unknown} body - The request body object
 * @returns {object} The validated request body
 * @throws Error with detailed message if validation fails
 */
export function validateCreateTestBody(body: unknown) {
  try {
    return createTestSchema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(formatZodError(error));
    }
    throw error;
  }
}

/**
 * Validates request body for PUT /scenarios/{testId}/baseline
 *
 * @param {unknown} body - The request body object
 * @returns {object} The validated request body
 * @throws Error with detailed message if validation fails
 */
export function validateSetBaselineBody(body: unknown) {
  try {
    return setBaselineSchema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(formatZodError(error));
    }
    throw error;
  }
}

/**
 * Validates request body for DELETE /scenarios/{testId}/testruns
 *
 * @param {unknown} body - The request body (array of testRunIds)
 * @returns {object} The validated request body
 * @throws Error with detailed message if validation fails
 */
export function validateDeleteTestRunsBody(body: unknown) {
  try {
    return deleteTestRunsSchema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(formatZodError(error));
    }
    throw error;
  }
}

/**
 * Validates query parameters based on the API resource
 *
 * @param {string} resource - The API resource path
 * @param {Record<string, string> | undefined} queryParams - The query parameters object
 * @returns {object} The validated query parameters
 * @throws Error with detailed message if validation fails
 */
export function validateQueryForResource(resource: string, queryParams: Record<string, string> | undefined) {
  switch (resource) {
    case "/scenarios":
      return validateScenariosQuery(queryParams);
    case "/scenarios/{testId}":
      return validateScenarioQuery(queryParams);
    case "/scenarios/{testId}/testruns":
      return validateTestRunsQuery(queryParams);
    case "/scenarios/{testId}/baseline":
      return validateBaselineQuery(queryParams);
    default:
      // For resources without specific query validation, return as-is
      return queryParams || {};
  }
}

/**
 * Validates request body based on the API resource and method
 *
 * @param {string} resource - The API resource path
 * @param {string} method - The HTTP method
 * @param {unknown} body - The request body
 * @returns {object} The validated request body
 * @throws Error with detailed message if validation fails
 */
export function validateBodyForResource(resource: string, method: string, body: unknown) {
  if (resource === "/scenarios" && method === "POST") {
    return validateCreateTestBody(body);
  }

  if (resource === "/scenarios/{testId}/baseline" && method === "PUT") {
    return validateSetBaselineBody(body);
  }

  if (resource === "/scenarios/{testId}/testruns" && method === "DELETE") {
    return validateDeleteTestRunsBody(body);
  }

  // For resources without specific body validation, return as-is
  return body;
}
