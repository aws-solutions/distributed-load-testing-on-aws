// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const DLT_DIR = join(homedir(), ".dlt");

export function ensureDltDir(): void {
  if (!existsSync(DLT_DIR)) {
    mkdirSync(DLT_DIR, { recursive: true, mode: 0o700 });
  }
}
