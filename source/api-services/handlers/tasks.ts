// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// TODO: JS module — implicitly typed as `any` until migrated to TypeScript
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const scenarios = require("../lib/scenarios/");
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const utils = require("solution-utils");

interface RegionalTasks {
  region: string;
  taskArns: string[];
}

interface ErrorException extends Error {
  statusCode?: number;
}

const handleTasks = async (
  method: string,
  _resource: string,
  errorMsg: ErrorException,
  userAgent: string | undefined
): Promise<RegionalTasks[]> => {
  if (method === "GET") {
    try {
      await utils.sendMetric({
        Type: "GetTasks",
        UserAgent: userAgent,
      });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return scenarios.listTasks() as Promise<RegionalTasks[]>;
  }
  throw errorMsg;
};

export { handleTasks };
