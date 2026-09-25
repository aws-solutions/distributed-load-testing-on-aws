#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../bundle-framework-runner.sh"

rm -f "$SCRIPT_DIR/jmeter.js"
bundle_framework_runner "source/load-tester/src/entrypoints/jmeter.ts" "$SCRIPT_DIR/jmeter.js"
