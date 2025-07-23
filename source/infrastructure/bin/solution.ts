// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export const SOLUTIONS_METRICS_ENDPOINT = "https://metrics.awssolutionsbuilder.com/generic";

export class Solution {
  public readonly id: string;
  public readonly name: string;
  public readonly version: string;
  public description: string;

  constructor(id: string, name: string, version: string, description: string) {
    this.id = id;
    this.name = name;
    this.version = version;
    this.description = description;
  }
}
