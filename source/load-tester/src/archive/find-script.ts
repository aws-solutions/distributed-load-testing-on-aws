// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Users may upload a zip containing the test script alongside sample data,
// config files, or helper modules. This module locates the correct entry
// point script using framework-specific extension/name conventions.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LoadTestFramework } from "@amzn/dlt-common";
import { isIgnoredTestFile } from "./ignored-files.js";

export interface FindScriptInput {
  readonly dir: string;
  readonly framework: LoadTestFramework;
}

export async function findScript(input: FindScriptInput): Promise<string> {
  const files = await listTopLevelFiles(input.dir);
  switch (input.framework) {
    case "jmeter":
      return pickByExtension(files, input.dir, [".jmx"]);
    case "k6":
      return pickByExtension(files, input.dir, [".ts", ".js"]);
    case "locust":
      return pickExact(files, input.dir, "locustfile.py");
    default:
      throw new Error(`Unsupported framework: ${String(input.framework)}`);
  }
}

async function listTopLevelFiles(dir: string): Promise<string[]> {
  const dirents = await readdir(dir, { withFileTypes: true });
  return dirents
    .filter((d) => d.isFile() && !isIgnoredTestFile(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

function pickByExtension(files: readonly string[], dir: string, extensions: readonly string[]): string {
  for (const ext of extensions) {
    const match = files.find((f) => f.toLowerCase().endsWith(ext));
    if (match !== undefined) return join(dir, match);
  }
  throw new Error(`No ${extensions.join(" or ")} file found at the top level of "${dir}"`);
}

function pickExact(files: readonly string[], dir: string, name: string): string {
  if (!files.includes(name)) {
    throw new Error(`No "${name}" file found at the top level of "${dir}"`);
  }
  return join(dir, name);
}
