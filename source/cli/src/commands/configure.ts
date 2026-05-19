// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { parseAwsExportsFile, saveConfig, extractRegionFromUserPoolId, type DltConfig } from "../lib/config.js";
import { withErrorHandler } from "../lib/error-handler.js";
import { confirmOverwrite } from "../lib/prompt.js";
import { DLT_DIR } from "../lib/paths.js";
import { join } from "node:path";

export function registerConfigureCommand(program: Command): void {
  program
    .command("configure")
    .description("Configure the DLT CLI with your stack settings")
    .option("--from-file <path>", "Import configuration from an aws-exports.json file")
    .option("--api-endpoint <url>", "REST API Gateway endpoint URL")
    .option("--user-pool-id <id>", "Cognito User Pool ID")
    .option("--user-pool-client-id <id>", "Cognito User Pool Client ID")
    .option("--identity-pool-id <id>", "Cognito Identity Pool ID")
    .option("--user-pool-domain <domain>", "Cognito Hosted UI domain")
    .option("--region <region>", "AWS region")
    .option("--scenarios-bucket <bucket>", "S3 bucket name for test scenarios and results")
    .option("--force", "Overwrite existing configuration without prompting")
    .action(withErrorHandler(handleConfigure));
}

async function handleConfigure(options: {
  fromFile?: string | undefined;
  apiEndpoint?: string | undefined;
  userPoolId?: string | undefined;
  userPoolClientId?: string | undefined;
  identityPoolId?: string | undefined;
  userPoolDomain?: string | undefined;
  region?: string | undefined;
  scenariosBucket?: string | undefined;
  force?: boolean | undefined;
}): Promise<void> {
  let config: DltConfig;

  if (options.fromFile) {
    config = parseAwsExportsFile(options.fromFile);
    console.error(`Configuration imported from ${options.fromFile}`);
  } else if (
    options.apiEndpoint &&
    options.userPoolId &&
    options.userPoolClientId &&
    options.identityPoolId &&
    options.userPoolDomain
  ) {
    const region = options.region ?? extractRegionFromUserPoolId(options.userPoolId);
    config = {
      apiEndpoint: options.apiEndpoint,
      userPoolId: options.userPoolId,
      userPoolClientId: options.userPoolClientId,
      identityPoolId: options.identityPoolId,
      userPoolDomain: options.userPoolDomain,
      region,
      scenariosBucket: options.scenariosBucket,
    };
  } else {
    config = await promptForConfig();
  }

  const configFile = join(DLT_DIR, "config.json");
  await confirmOverwrite(configFile, !!options.force);

  saveConfig(config);
  console.error("Configuration saved to ~/.dlt/config.json");
  console.error(`  Region:       ${config.region}`);
  console.error(`  API Endpoint: ${config.apiEndpoint}`);
  console.error(`  User Pool:    ${config.userPoolId}`);
}

async function promptForConfig(): Promise<DltConfig> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const apiEndpoint = await rl.question("API Endpoint URL: ");
    const userPoolId = await rl.question("User Pool ID: ");
    const userPoolClientId = await rl.question("User Pool Client ID: ");
    const identityPoolId = await rl.question("Identity Pool ID: ");
    const userPoolDomain = await rl.question("User Pool Domain: ");
    const regionDefault = extractRegionFromUserPoolId(userPoolId);
    const region = (await rl.question(`Region [${regionDefault}]: `)) || regionDefault;
    const scenariosBucket = await rl.question("Scenarios S3 Bucket: ");

    if (!apiEndpoint || !userPoolId || !userPoolClientId || !identityPoolId || !userPoolDomain || !scenariosBucket) {
      throw new Error("All fields are required.");
    }

    return {
      apiEndpoint,
      userPoolId,
      userPoolClientId,
      identityPoolId,
      userPoolDomain,
      region,
      scenariosBucket,
    };
  } finally {
    rl.close();
  }
}
