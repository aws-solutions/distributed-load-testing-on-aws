#!/usr/bin/env bash
# Pre-build script: Copy required files from project root into Docker context
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

cp "$PROJECT_ROOT/k6.json" "$SCRIPT_DIR/"
cp "$PROJECT_ROOT/locust.json" "$SCRIPT_DIR/"
