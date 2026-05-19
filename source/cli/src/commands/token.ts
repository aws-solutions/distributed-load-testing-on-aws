// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { ApiClient } from "../lib/api-client.js";
import { loadCredentials, isTokenExpired } from "../lib/credentials.js";
import { withErrorHandler } from "../lib/error-handler.js";
import { printResult } from "../lib/output.js";

export function registerTokenCommand(program: Command): void {
  const token = program.command("token").description("Manage and inspect authentication tokens");

  token
    .command("output", { isDefault: true })
    .description("Output the current access or ID token to stdout")
    .option("--type <type>", 'Token type to output: "access" or "id"', "access")
    .action(withErrorHandler(handleTokenOutput));

  token
    .command("status")
    .description("Show token and credential expiry status")
    .option("--format <format>", "Output format: json or table", "table")
    .action(withErrorHandler(handleTokenStatus));
}

async function handleTokenOutput(options: { type: string }): Promise<void> {
  const api = await ApiClient.create();
  const creds = api.credentials;

  if (creds.authMode === "iam") {
    throw new Error(
      "No Cognito tokens available in IAM mode.\n" +
        "Use 'dlt login --srp' or 'dlt login' (browser) to get Cognito tokens.\n" +
        "Use 'dlt token status' to inspect credential expiry."
    );
  }

  const tokenType = options.type.toLowerCase();
  if (tokenType === "id") {
    if (!creds.idToken) {
      throw new Error("No ID token available. Run 'dlt login' first.");
    }
    process.stdout.write(creds.idToken);
  } else if (tokenType === "access") {
    if (!creds.accessToken) {
      throw new Error("No access token available. Run 'dlt login' first.");
    }
    process.stdout.write(creds.accessToken);
  } else {
    throw new Error(`Unknown token type: "${options.type}". Use "access" or "id".`);
  }
}

async function handleTokenStatus(options: { format: string }): Promise<void> {
  const creds = loadCredentials();
  const now = new Date();

  interface StatusRow {
    credential: string;
    expires: string;
    remainingMinutes: string;
    status: string;
  }

  const rows: StatusRow[] = [];

  if (creds.authMode === "iam") {
    // IAM mode: only AWS credentials, no Cognito tokens
    rows.push(buildStatusRow("AWS Credentials", creds.awsCredentialExpiry, now));
    rows.push({
      credential: "Cognito Tokens",
      expires: "(not applicable — IAM mode)",
      remainingMinutes: "—",
      status: "—",
    });
  } else {
    // Browser/SRP mode: Cognito tokens + AWS credentials
    if (creds.tokenExpiry) {
      rows.push(buildStatusRow("Cognito Token", creds.tokenExpiry, now));
    } else {
      rows.push({
        credential: "Cognito Token",
        expires: "(unknown)",
        remainingMinutes: "—",
        status: isTokenExpired(creds) ? "EXPIRED" : "unknown",
      });
    }

    rows.push(buildStatusRow("AWS Credentials", creds.awsCredentialExpiry, now));

    rows.push({
      credential: "Refresh Token",
      expires: "(not tracked)",
      remainingMinutes: "—",
      status: creds.refreshToken ? "present" : "missing",
    });
  }

  // Add auth mode info
  const result = {
    authMode: creds.authMode,
    credentials: rows,
  };

  if (options.format === "table") {
    console.error(`Auth mode: ${creds.authMode}`);
    printResult(rows, { format: "table" });
  } else {
    printResult(result, { format: "json" });
  }
}

function buildStatusRow(
  name: string,
  expiryIso: string,
  now: Date
): {
  credential: string;
  expires: string;
  remainingMinutes: string;
  status: string;
} {
  const expiry = new Date(expiryIso);
  const remainingMs = expiry.getTime() - now.getTime();
  const remainingMin = Math.round(remainingMs / 60_000);

  let status: string;
  if (remainingMs <= 0) {
    status = "EXPIRED";
  } else if (remainingMs <= 5 * 60_000) {
    status = "expiring soon";
  } else {
    status = "valid";
  }

  return {
    credential: name,
    expires: expiryIso,
    remainingMinutes: remainingMin <= 0 ? `${remainingMin} (expired)` : String(remainingMin),
    status,
  };
}
