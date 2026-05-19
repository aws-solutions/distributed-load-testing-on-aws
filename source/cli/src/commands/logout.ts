// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { credentialsExist, clearCredentials } from "../lib/credentials.js";
import { withErrorHandler } from "../lib/error-handler.js";

export function registerLogoutCommand(program: Command): void {
  program.command("logout").description("Remove stored credentials").action(withErrorHandler(handleLogout));
}

async function handleLogout(): Promise<void> {
  if (!credentialsExist()) {
    console.error("No credentials found — already logged out.");
    return;
  }
  clearCredentials();
  console.error("Logged out — credentials removed.");
}
