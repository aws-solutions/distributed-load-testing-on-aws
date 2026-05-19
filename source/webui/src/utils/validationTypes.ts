// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Common validation result type used across form validation utilities.
 */
export interface ValidationResult {
  isValid: boolean;
  errorMessage: string;
}