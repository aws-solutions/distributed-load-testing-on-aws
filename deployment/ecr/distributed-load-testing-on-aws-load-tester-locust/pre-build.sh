#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
source "$SCRIPT_DIR/../bundle-framework-runner.sh"

# Clear any existing artifacts
rm -f "$SCRIPT_DIR/locust.js" "$SCRIPT_DIR/sidecar.py" "$SCRIPT_DIR/locust.json"

# Bundle our Locust framework runner before it gets copied by the Dockerfile
bundle_framework_runner "source/load-tester/src/entrypoints/locust.ts" "$SCRIPT_DIR/locust.js"
cp "$PROJECT_ROOT/source/load-tester/src/locust/sidecar.py" "$SCRIPT_DIR/sidecar.py"
cp "$PROJECT_ROOT/locust.json" "$SCRIPT_DIR/locust.json"
