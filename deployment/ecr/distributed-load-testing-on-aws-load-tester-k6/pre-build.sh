#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
source "$SCRIPT_DIR/../bundle-framework-runner.sh"

# These files are generated into the Docker context on every build.
rm -f "$SCRIPT_DIR/k6.js" "$SCRIPT_DIR/k6.json"
bundle_framework_runner "source/load-tester/src/entrypoints/k6.ts" "$SCRIPT_DIR/k6.js"
cp "$PROJECT_ROOT/k6.json" "$SCRIPT_DIR/k6.json"
