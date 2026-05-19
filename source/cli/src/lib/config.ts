// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DLT_DIR, ensureDltDir } from "./paths.js";

const CONFIG_FILE = join(DLT_DIR, "config.json");

export interface DltConfig {
  apiEndpoint: string;
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
  userPoolDomain: string;
  region: string;
  scenariosBucket?: string | undefined;
}

export interface AwsExportsJson {
  UserPoolId: string;
  PoolClientId: string;
  IdentityPoolId: string;
  UserPoolDomain: string;
  ApiEndpoint: string;
  UserFilesBucket?: string;
  UserFilesBucketRegion?: string;
  IoTEndpoint?: string;
  IoTPolicy?: string;
}

export function extractRegionFromUserPoolId(userPoolId: string): string {
  const parts = userPoolId.split("_");
  if (parts.length < 2 || !parts[0]) {
    throw new Error(`Invalid UserPoolId format: "${userPoolId}". Expected format: <region>_<id>`);
  }
  return parts[0];
}

export function parseAwsExportsFile(filePath: string): DltConfig {
  const raw = readFileSync(filePath, "utf-8");
  let data: AwsExportsJson;
  try {
    data = JSON.parse(raw) as AwsExportsJson;
  } catch {
    throw new Error(`Failed to parse JSON from ${filePath}`);
  }

  const required: (keyof AwsExportsJson)[] = [
    "UserPoolId",
    "PoolClientId",
    "IdentityPoolId",
    "UserPoolDomain",
    "ApiEndpoint",
  ];
  for (const key of required) {
    if (!data[key]) {
      throw new Error(`Missing required field "${key}" in ${filePath}`);
    }
  }

  const region = extractRegionFromUserPoolId(data.UserPoolId);

  return {
    apiEndpoint: data.ApiEndpoint,
    userPoolId: data.UserPoolId,
    userPoolClientId: data.PoolClientId,
    identityPoolId: data.IdentityPoolId,
    userPoolDomain: data.UserPoolDomain,
    region,
    scenariosBucket: data.UserFilesBucket,
  };
}

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

export function loadConfig(): DltConfig {
  if (!existsSync(CONFIG_FILE)) {
    throw new Error(`Configuration not found. Run "dlt configure" first.\nExpected: ${CONFIG_FILE}`);
  }
  const raw = readFileSync(CONFIG_FILE, "utf-8");
  const config = JSON.parse(raw) as DltConfig;

  if (
    !config.apiEndpoint ||
    !config.userPoolId ||
    !config.userPoolClientId ||
    !config.identityPoolId ||
    !config.userPoolDomain ||
    !config.region
  ) {
    throw new Error(`Invalid configuration in ${CONFIG_FILE}. Run "dlt configure" to fix.`);
  }

  return config;
}

export function saveConfig(config: DltConfig): void {
  ensureDltDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
