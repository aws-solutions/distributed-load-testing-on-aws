// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export class AppError extends Error {
  public code: number;

  constructor(message: string, code: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}
