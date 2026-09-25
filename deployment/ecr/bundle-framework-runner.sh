#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# Shared esbuild bundling for native-mode container images. Source this from a
# framework's pre-build.sh, then call bundle_framework_runner with the entrypoint
# and the file to write into that image's Docker context.
set -euo pipefail

bundle_framework_runner() {
  local entrypoint="$1" # repo-relative, e.g. source/load-tester/src/entrypoints/locust.ts
  local outfile="$2"    # absolute path of the bundle to write

  # BASH_SOURCE[1] is the pre-build.sh that sourced us, not this file, so the
  # project root resolves relative to the caller's own deployment/ecr/<image>/ dir.
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)"
  local project_root
  project_root="$(cd "$script_dir/../../.." && pwd)"

  # Use the installed esbuild to bundle the framework runner
  local esbuild="$project_root/node_modules/.bin/esbuild"
  if [[ ! -x "$esbuild" ]]; then
    echo "esbuild not found at $esbuild — run 'make install-deps' first" >&2
    return 1
  fi

  # The banner keeps the copyright header — esbuild strips source comments under --minify,
  # and build-open-source-dist.sh ships this bundle. createRequire shim lets the
  # ESM output pull in any CommonJS transitive dependency.
  "$esbuild" "$project_root/$entrypoint" \
    --bundle \
    --minify \
    --platform=node \
    --target=node24 \
    --format=esm \
    --outfile="$outfile" \
    --banner:js="/* Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved. SPDX-License-Identifier: Apache-2.0 */import{createRequire}from'module';const require=createRequire(import.meta.url);"
}
