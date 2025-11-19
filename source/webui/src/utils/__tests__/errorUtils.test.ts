// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { extractErrorMessage } from '../errorUtils';

describe('extractErrorMessage', () => {
  it('should extract message from AWS Amplify error with JSON string body', () => {
    const error = {
      response: {
        body: '{"message": "INVALID_REQUEST_BODY: regionalTaskDetails.us-west-2.dltAvailableTasks: Number must be greater than 0"}'
      }
    };
    expect(extractErrorMessage(error)).toBe('INVALID_REQUEST_BODY: regionalTaskDetails.us-west-2.dltAvailableTasks: Number must be greater than 0');
  });

  it('should extract message from AWS Amplify error with object body', () => {
    const error = {
      response: {
        body: {
          message: 'Resource not found'
        }
      }
    };
    expect(extractErrorMessage(error)).toBe('Resource not found');
  });

  it('should return raw string body when JSON parsing fails', () => {
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
});