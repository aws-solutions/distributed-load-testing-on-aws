// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export default {
  versionGroups: [
    {
      // DLT workspace packages are referenced via "*"
      label: "DLT workspace packages must be referenced with *",
      dependencies: ["@amzn/dlt-*"],
      dependencyTypes: ["prod", "dev", "peer"],
      pinVersion: "*",
    },
    {
      // Zod v3 to v4 migration is not trivial.
      // This is a temporary workaround until we migrate all usages.
      label: "Accept Zod v3 (used in api-services package)",
      dependencies: ["zod"],
      dependencyTypes: ["prod", "dev", "peer"],
      isIgnored: true
    },
    {
      // AWS SDK v3 clients must share the same version range
      label: "AWS SDK v3 clients must share the same range",
      dependencies: ["@aws-sdk/**"],
      dependencyTypes: ["prod", "dev", "peer"],
      policy: "sameRange"
    }
  ],
} satisfies import("syncpack").RcFile;
