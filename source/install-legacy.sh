#!/usr/bin/env bash
# Install dependencies for legacy (non-workspace) packages.
# Workspace packages are installed via `npm ci` at the project root.
# Exclusions are derived automatically from the root package.json "workspaces" array.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_PKG="$SCRIPT_DIR/../package.json"

EXCLUDES=$(node -p "
  (require('$ROOT_PKG').workspaces || [])
    .map(w => w.replace(/^source\//, './'))
    .map(p => '-not -path \"' + p + '/*\"')
    .join(' ')
")

eval "find . -maxdepth 2 -name package.json $EXCLUDES -execdir bash -c 'echo \"Installing in \$(pwd)\" && npm ci' \;"
