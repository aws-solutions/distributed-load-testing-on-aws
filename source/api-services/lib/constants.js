// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const StatusCodes = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ALLOWED: 405,
  CONFLICT: 409,
  REQUEST_TOO_LONG: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  TIMEOUT: 503,
};

class ErrorException extends Error {
  constructor(code, errMsg, statusCode = StatusCodes.BAD_REQUEST) {
    super(errMsg);
    this.code = code;
    this.message = errMsg;
    this.statusCode = statusCode;
  }

  toString() {
    return `${this.code}: ${this.message}`;
  }
}

module.exports = {
  StatusCodes,
  ErrorException,
};
