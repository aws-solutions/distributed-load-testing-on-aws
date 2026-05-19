// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Reads the version from solution-manifest.yaml and generates a TypeScript
 * constant so the CLI always reflects the canonical solution version.
 *
 * Run automatically as part of `npm run build`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, "../../solution-manifest.yaml");
const outputPath = resolve(__dirname, "src/generated-version.ts");

const yaml = readFileSync(manifestPath, "utf-8");
const match = yaml.match(/^version:\s*(.+)$/m); // NOSONAR - S5852: linear regex with line-anchored pattern, no ReDoS risk
if (!match) {
  console.error("Could not extract version from solution-manifest.yaml");
  process.exit(1);
}

const version = match[1].trim();

writeFileSync(
  outputPath,
  `// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.\n// SPDX-License-Identifier: Apache-2.0\n\n// Auto-generated from solution-manifest.yaml — do not edit manually.\nexport const VERSION = "${version}";\n`,
  "utf-8"
);

console.log(`Generated src/generated-version.ts (version: ${version})`);
