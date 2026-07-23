// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { extractErrorMessage } from '../../utils/errorUtils';

describe('extractErrorMessage', () => {
  it('should extract message from AWS Amplify error with string body', () => {
    const error = {
      response: {
        body: 'INVALID_REQUEST_BODY: regionalTaskDetails.us-west-2.dltAvailableTasks: Number must be greater than 0'
      }
    };
    expect(extractErrorMessage(error)).toBe('Invalid request: regionalTaskDetails.us-west-2.dltAvailableTasks: Number must be greater than 0');
  });

  it('should use response.body directly as the message', () => {
    const error = {
      response: {
        body: 'Plain error message'
      }
    };
    expect(extractErrorMessage(error)).toBe('Plain error message');
  });

  it('should extract message from RTK Query error', () => {
    const error = {
      data: {
        message: 'Invalid request parameters'
      }
    };
    expect(extractErrorMessage(error)).toBe('Invalid request parameters');
  });

  it('should extract direct message property', () => {
    const error = {
      message: 'Network error'
    };
    expect(extractErrorMessage(error)).toBe('Network error');
  });

  it('should handle string errors', () => {
    const error = 'Something went wrong';
    expect(extractErrorMessage(error)).toBe('Something went wrong');
  });

  it('should return default message for unknown error structure', () => {
    const error = { someProperty: 'value' };
    expect(extractErrorMessage(error)).toBe('An unexpected error occurred. Please try again.');
  });

  it('should extract error from error property', () => {
    const error = { error: 'Connection refused' };
    expect(extractErrorMessage(error)).toBe('Connection refused');
  });

  it('should ignore message property when it is "Unknown error"', () => {
    const error = { message: 'Unknown error' };
    expect(extractErrorMessage(error)).toBe('An unexpected error occurred. Please try again.');
  });

  it('should strip InvalidParameter prefix with no replacement', () => {
    const error = { response: { body: 'InvalidParameter: concurrency must be positive' } };
    expect(extractErrorMessage(error)).toBe('concurrency must be positive');
  });

  it('should format ValidationException prefix', () => {
    const error = { response: { body: 'ValidationException: field is required' } };
    expect(extractErrorMessage(error)).toBe('Validation error: field is required');
  });

  it('should format ResourceNotFoundException prefix', () => {
    const error = { response: { body: 'ResourceNotFoundException: test-123 not found' } };
    expect(extractErrorMessage(error)).toBe('Resource not found: test-123 not found');
  });

  it('should format AccessDeniedException prefix', () => {
    const error = { response: { body: 'AccessDeniedException: insufficient permissions' } };
    expect(extractErrorMessage(error)).toBe('Access denied: insufficient permissions');
  });

  it('should format InternalServerError prefix', () => {
    const error = { response: { body: 'InternalServerError: unexpected failure' } };
    expect(extractErrorMessage(error)).toBe('Server error: unexpected failure');
  });

  it('should format BadRequestException prefix', () => {
    const error = { response: { body: 'BadRequestException: missing required field' } };
    expect(extractErrorMessage(error)).toBe('Bad request: missing required field');
  });

  it('should handle null and undefined errors', () => {
    expect(extractErrorMessage(null)).toBe('An unexpected error occurred. Please try again.');
    expect(extractErrorMessage(undefined)).toBe('An unexpected error occurred. Please try again.');
  });

  it('should prioritize response.body over other fields', () => {
    const error = {
      response: { body: 'Body error' },
      data: { message: 'Data error' },
      message: 'Message error',
      error: 'Error prop',
    };
    expect(extractErrorMessage(error)).toBe('Body error');
  });

  it('should prioritize data.message over error and message', () => {
    const error = {
      data: { message: 'Data error' },
      error: 'Error prop',
      message: 'Message error',
    };
    expect(extractErrorMessage(error)).toBe('Data error');
  });

  it('should prioritize error property over message', () => {
    const error = {
      error: 'Error prop',
      message: 'Message error',
    };
    expect(extractErrorMessage(error)).toBe('Error prop');
  });
});