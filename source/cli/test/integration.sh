#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =============================================================================
# DLT CLI Integration Test Suite
#
# Exercises every CLI command against a live DLT installation.
#
# Prerequisites:
#   1. CLI is built:     npm run build -w source/cli
#   2. Config exists:    dlt configure --from-file aws-exports.json
#   3. User is logged in: dlt login
#   4. jq is installed:  brew install jq  (or apt-get install jq)
#
# Usage:
#   bash source/cli/test/integration.sh
#
# Environment variables:
#   DLT_BIN          — Override CLI binary (default: node source/cli/dist/index.js)
#   SKIP_START_TEST  — Set to "true" to skip the scenario start test
#   SKIP_DOWNLOAD    — Set to "true" to skip artifact download tests
#   POLL_TIMEOUT     — Max seconds to wait for a started test to finish (default: 600)
#   TEST_ID_OVERRIDE — Use a specific testId instead of discovering one
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
TEST_NUMBER=0
TEST_NAME=""
LAST_EXIT_CODE=0

STDOUT_FILE=""
STDERR_FILE=""
DOWNLOAD_DIR=""

# Discovered state (populated during tests)
DISCOVERED_TEST_ID=""
DISCOVERED_RUN_ID=""
DISCOVERED_RUN_START_TIME=""
STARTED_TEST_ID=""

# CLI binary
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DLT="${DLT_BIN:-node ${REPO_ROOT}/source/cli/dist/index.js}"

POLL_TIMEOUT="${POLL_TIMEOUT:-600}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

setup() {
  STDOUT_FILE=$(mktemp)
  STDERR_FILE=$(mktemp)
  DOWNLOAD_DIR=$(mktemp -d)

  # Verify prerequisites
  if ! command -v jq &>/dev/null; then
    echo -e "${RED}Error: jq is required but not installed.${RESET}"
    echo "Install with: brew install jq (macOS) or apt-get install jq (Linux)"
    exit 2
  fi

  if ! command -v node &>/dev/null; then
    echo -e "${RED}Error: node is required but not installed.${RESET}"
    exit 2
  fi

  # Verify CLI is built
  if [[ ! -f "${REPO_ROOT}/source/cli/dist/index.js" ]]; then
    echo -e "${RED}Error: CLI not built. Run: npm run build -w source/cli${RESET}"
    exit 2
  fi

  echo -e "${BOLD}═══════════════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}  DLT CLI Integration Test Suite${RESET}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${RESET}"
  echo ""
  echo "  CLI:          ${DLT}"
  echo "  Repo root:    ${REPO_ROOT}"
  echo "  Download dir: ${DOWNLOAD_DIR}"
  echo "  Poll timeout: ${POLL_TIMEOUT}s"
  echo ""
}

teardown() {
  rm -f "$STDOUT_FILE" "$STDERR_FILE"
  if [[ -d "$DOWNLOAD_DIR" ]]; then
    rm -rf "$DOWNLOAD_DIR"
  fi
}

# Run a DLT CLI command, capturing stdout, stderr, and exit code.
# Usage: run_dlt scenarios list --format json
run_dlt() {
  LAST_EXIT_CODE=0
  # shellcheck disable=SC2086
  $DLT "$@" >"$STDOUT_FILE" 2>"$STDERR_FILE" || LAST_EXIT_CODE=$?
}

stdout() {
  cat "$STDOUT_FILE"
}

stderr() {
  cat "$STDERR_FILE"
}

begin_test() {
  TEST_NUMBER=$((TEST_NUMBER + 1))
  TEST_NAME="$1"
  echo -e "${CYAN}  [${TEST_NUMBER}] ${TEST_NAME}${RESET}"
}

pass() {
  local msg="${1:-$TEST_NAME}"
  PASS_COUNT=$((PASS_COUNT + 1))
  echo -e "      ${GREEN}✓ PASS${RESET} ${msg}"
}

fail() {
  local msg="${1:-$TEST_NAME}"
  local detail="${2:-}"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo -e "      ${RED}✗ FAIL${RESET} ${msg}"
  if [[ -n "$detail" ]]; then
    echo -e "        ${RED}${detail}${RESET}"
  fi
  # Show captured output for debugging
  local err
  err=$(stderr)
  if [[ -n "$err" ]]; then
    echo -e "        stderr: $(echo "$err" | head -3)"
  fi
}

skip() {
  local msg="${1:-$TEST_NAME}"
  local reason="${2:-}"
  SKIP_COUNT=$((SKIP_COUNT + 1))
  echo -e "      ${YELLOW}⊘ SKIP${RESET} ${msg}${reason:+ ($reason)}"
}

# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------

assert_exit_success() {
  if [[ "$LAST_EXIT_CODE" -eq 0 ]]; then
    pass "${1:-exit code 0}"
  else
    fail "${1:-exit code 0}" "Expected exit 0, got $LAST_EXIT_CODE"
  fi
}

assert_exit_failure() {
  if [[ "$LAST_EXIT_CODE" -ne 0 ]]; then
    pass "${1:-exit code non-zero}"
  else
    fail "${1:-exit code non-zero}" "Expected non-zero exit, got 0"
  fi
}

assert_exit_code() {
  local expected="$1"
  local msg="${2:-exit code $expected}"
  if [[ "$LAST_EXIT_CODE" -eq "$expected" ]]; then
    pass "$msg"
  else
    fail "$msg" "Expected exit $expected, got $LAST_EXIT_CODE"
  fi
}

assert_stdout_contains() {
  local needle="$1"
  local msg="${2:-stdout contains '$needle'}"
  if grep -qF "$needle" "$STDOUT_FILE"; then
    pass "$msg"
  else
    fail "$msg" "String not found in stdout"
  fi
}

assert_stderr_contains() {
  local needle="$1"
  local msg="${2:-stderr contains '$needle'}"
  if grep -qF "$needle" "$STDERR_FILE"; then
    pass "$msg"
  else
    fail "$msg" "String not found in stderr"
  fi
}

assert_stdout_not_empty() {
  local msg="${1:-stdout not empty}"
  if [[ -s "$STDOUT_FILE" ]]; then
    pass "$msg"
  else
    fail "$msg" "stdout was empty"
  fi
}

assert_stdout_valid_json() {
  local msg="${1:-stdout is valid JSON}"
  if jq . "$STDOUT_FILE" >/dev/null 2>&1; then
    pass "$msg"
  else
    fail "$msg" "jq failed to parse stdout"
  fi
}

assert_stdout_json_field() {
  local jq_path="$1"
  local expected_value="${2:-}"
  local msg="${3:-JSON field $jq_path exists}"
  local actual
  actual=$(jq -r "$jq_path" "$STDOUT_FILE" 2>/dev/null)
  if [[ "$actual" == "null" ]] || [[ -z "$actual" ]]; then
    fail "$msg" "Field $jq_path is null or empty"
  elif [[ -n "$expected_value" ]] && [[ "$actual" != "$expected_value" ]]; then
    fail "$msg" "Expected '$expected_value', got '$actual'"
  else
    pass "$msg"
  fi
}

assert_stdout_json_array() {
  local msg="${1:-stdout is JSON array}"
  local type
  type=$(jq -r 'type' "$STDOUT_FILE" 2>/dev/null)
  if [[ "$type" == "array" ]]; then
    pass "$msg"
  else
    fail "$msg" "Expected array, got $type"
  fi
}

assert_stdout_json_array_nonempty() {
  local msg="${1:-stdout is non-empty JSON array}"
  local len
  len=$(jq 'length' "$STDOUT_FILE" 2>/dev/null)
  if [[ "$len" -gt 0 ]]; then
    pass "$msg"
  else
    fail "$msg" "Array is empty"
  fi
}

assert_stdout_json_array_length_lte() {
  local max="$1"
  local msg="${2:-JSON array length <= $max}"
  local len
  len=$(jq 'length' "$STDOUT_FILE" 2>/dev/null)
  if [[ "$len" -le "$max" ]]; then
    pass "$msg"
  else
    fail "$msg" "Array length $len > $max"
  fi
}

assert_stdout_line_count_gte() {
  local min="$1"
  local msg="${2:-stdout has >= $min lines}"
  local count
  count=$(wc -l < "$STDOUT_FILE" | tr -d ' ')
  if [[ "$count" -ge "$min" ]]; then
    pass "$msg"
  else
    fail "$msg" "Got $count lines, expected >= $min"
  fi
}

assert_file_exists() {
  local filepath="$1"
  local msg="${2:-file exists: $filepath}"
  if [[ -e "$filepath" ]]; then
    pass "$msg"
  else
    fail "$msg" "File does not exist"
  fi
}

assert_dir_not_empty() {
  local dirpath="$1"
  local msg="${2:-directory not empty: $dirpath}"
  if [[ -d "$dirpath" ]] && [[ "$(ls -A "$dirpath" 2>/dev/null)" ]]; then
    pass "$msg"
  else
    fail "$msg" "Directory is empty or does not exist"
  fi
}

# ===========================================================================
# Test Groups
# ===========================================================================

section() {
  echo ""
  echo -e "${BOLD}── $1 ──${RESET}"
}

# ---------------------------------------------------------------------------
# 1. Basic CLI
# ---------------------------------------------------------------------------

test_version() {
  begin_test "dlt --version"
  run_dlt --version
  assert_exit_success
  assert_stdout_not_empty "outputs version string"
}

test_help() {
  begin_test "dlt --help"
  run_dlt --help
  assert_exit_success
  assert_stdout_contains "configure" "lists configure command"
  assert_stdout_contains "login" "lists login command"
  assert_stdout_contains "scenarios" "lists scenarios command"
  assert_stdout_contains "runs" "lists runs command"
  assert_stdout_contains "token" "lists token command"
  assert_stdout_contains "logout" "lists logout command"
}

test_help_subcommands() {
  begin_test "subcommand --help"

  for cmd in configure login logout scenarios runs token; do
    run_dlt "$cmd" --help
    if [[ "$LAST_EXIT_CODE" -eq 0 ]]; then
      pass "$cmd --help"
    else
      fail "$cmd --help"
    fi
  done
}

# ---------------------------------------------------------------------------
# 2. Token Commands
# ---------------------------------------------------------------------------

test_token_status_table() {
  begin_test "dlt token status (table)"
  run_dlt token status --format table
  assert_exit_success
  assert_stdout_not_empty "table output present"
}

test_token_status_json() {
  begin_test "dlt token status --format json"
  run_dlt token status --format json
  assert_exit_success
  assert_stdout_valid_json
  assert_stdout_json_field '.authMode' "" "has authMode field"
}

test_token_output_access() {
  begin_test "dlt token output (access token)"
  run_dlt token output --type access
  # IAM mode will fail — that's expected, handle both cases
  if [[ "$LAST_EXIT_CODE" -eq 0 ]]; then
    assert_stdout_not_empty "token written to stdout"
    # Access tokens are typically long JWT strings
    local len
    len=$(wc -c < "$STDOUT_FILE" | tr -d ' ')
    if [[ "$len" -gt 20 ]]; then
      pass "token is reasonably long ($len chars)"
    else
      fail "token seems too short ($len chars)"
    fi
  else
    # IAM mode — expect specific error
    assert_stderr_contains "IAM mode" "expected IAM mode error"
    skip "token output (access)" "IAM mode — no Cognito tokens"
  fi
}

test_token_output_id() {
  begin_test "dlt token output --type id"
  run_dlt token output --type id
  if [[ "$LAST_EXIT_CODE" -eq 0 ]]; then
    assert_stdout_not_empty "ID token written to stdout"
  else
    skip "token output (id)" "IAM mode — no Cognito tokens"
  fi
}

test_token_output_invalid_type() {
  begin_test "dlt token output --type bogus (should fail)"
  run_dlt token output --type bogus
  assert_exit_failure "rejects invalid token type"
}

# ---------------------------------------------------------------------------
# 3. Scenarios Commands
# ---------------------------------------------------------------------------

test_scenarios_list_json() {
  begin_test "dlt scenarios list --format json"
  run_dlt scenarios list --format json
  assert_exit_success
  assert_stdout_valid_json
  assert_stdout_json_array "result is array"

  # Discover a test ID for subsequent tests
  DISCOVERED_TEST_ID=$(jq -r '.[0].testId // empty' "$STDOUT_FILE" 2>/dev/null)
  if [[ -n "$DISCOVERED_TEST_ID" ]]; then
    pass "discovered testId: $DISCOVERED_TEST_ID"
  else
    fail "no scenarios found — subsequent tests will be skipped"
  fi

  # Allow override
  if [[ -n "${TEST_ID_OVERRIDE:-}" ]]; then
    DISCOVERED_TEST_ID="$TEST_ID_OVERRIDE"
    echo -e "      ${YELLOW}Using override testId: $DISCOVERED_TEST_ID${RESET}"
  fi
}

test_scenarios_list_table() {
  begin_test "dlt scenarios list --format table"
  run_dlt scenarios list --format table
  assert_exit_success
  assert_stdout_not_empty "table output present"
  # Table should have header + separator + at least one row = 3 lines minimum
  assert_stdout_line_count_gte 3 "table has header + data rows"
  assert_stdout_contains "testId" "table header has testId column"
}

test_scenarios_get_json() {
  if [[ -z "$DISCOVERED_TEST_ID" ]]; then
    begin_test "dlt scenarios get <testId> --format json"
    skip "scenarios get (json)" "no testId discovered"
    return
  fi

  begin_test "dlt scenarios get $DISCOVERED_TEST_ID --format json"
  run_dlt scenarios get "$DISCOVERED_TEST_ID" --format json
  assert_exit_success
  assert_stdout_valid_json
  assert_stdout_json_field '.testId' "$DISCOVERED_TEST_ID" "testId matches"
  assert_stdout_json_field '.testName' "" "has testName"
}

test_scenarios_get_table() {
  if [[ -z "$DISCOVERED_TEST_ID" ]]; then
    begin_test "dlt scenarios get <testId> --format table"
    skip "scenarios get (table)" "no testId discovered"
    return
  fi

  begin_test "dlt scenarios get $DISCOVERED_TEST_ID --format table"
  run_dlt scenarios get "$DISCOVERED_TEST_ID" --format table
  assert_exit_success
  assert_stdout_not_empty "table output present"
}

test_scenarios_get_invalid() {
  begin_test "dlt scenarios get nonexistent-id-xxxxx (should fail)"
  run_dlt scenarios get "nonexistent-id-xxxxx" --format json
  assert_exit_failure "rejects invalid testId"
}

# ---------------------------------------------------------------------------
# 4. Runs Commands
# ---------------------------------------------------------------------------

test_runs_list_json() {
  if [[ -z "$DISCOVERED_TEST_ID" ]]; then
    begin_test "dlt runs list <testId> --format json"
    skip "runs list (json)" "no testId discovered"
    return
  fi

  begin_test "dlt runs list $DISCOVERED_TEST_ID --format json"
  run_dlt runs list "$DISCOVERED_TEST_ID" --format json
  assert_exit_success
  assert_stdout_valid_json
  assert_stdout_json_array "result is array"

  # Discover a run ID
  DISCOVERED_RUN_ID=$(jq -r '.[0].testRunId // .[0].runId // empty' "$STDOUT_FILE" 2>/dev/null)
  if [[ -n "$DISCOVERED_RUN_ID" ]]; then
    pass "discovered runId: $DISCOVERED_RUN_ID"
  else
    echo -e "      ${YELLOW}No runs found — run-specific tests will be limited${RESET}"
  fi
}

test_runs_list_table() {
  if [[ -z "$DISCOVERED_TEST_ID" ]]; then
    begin_test "dlt runs list <testId> --format table"
    skip "runs list (table)" "no testId discovered"
    return
  fi

  begin_test "dlt runs list $DISCOVERED_TEST_ID --format table"
  run_dlt runs list "$DISCOVERED_TEST_ID" --format table
  assert_exit_success
  # May be empty if no runs
  if [[ -s "$STDOUT_FILE" ]]; then
    assert_stdout_contains "runId" "table header has runId column"
  else
    pass "empty result (no runs yet)"
  fi
}

test_runs_list_with_limit() {
  if [[ -z "$DISCOVERED_TEST_ID" ]]; then
    begin_test "dlt runs list <testId> --limit 1"
    skip "runs list with limit" "no testId discovered"
    return
  fi

  begin_test "dlt runs list $DISCOVERED_TEST_ID --limit 1 --format json"
  run_dlt runs list "$DISCOVERED_TEST_ID" --limit 1 --format json
  assert_exit_success
  assert_stdout_valid_json
  assert_stdout_json_array "result is array"
  assert_stdout_json_array_length_lte 1 "respects --limit 1"
}

test_runs_get_json() {
  if [[ -z "$DISCOVERED_TEST_ID" ]] || [[ -z "$DISCOVERED_RUN_ID" ]]; then
    begin_test "dlt runs get <testId> <runId> --format json"
    skip "runs get (json)" "no testId/runId discovered"
    return
  fi

  begin_test "dlt runs get $DISCOVERED_TEST_ID $DISCOVERED_RUN_ID --format json"
  run_dlt runs get "$DISCOVERED_TEST_ID" "$DISCOVERED_RUN_ID" --format json
  assert_exit_success
  assert_stdout_valid_json
  assert_stdout_json_field '.testRunId' "$DISCOVERED_RUN_ID" "testRunId matches"
  assert_stdout_json_field '.status' "" "has status field"
}

test_runs_get_table() {
  if [[ -z "$DISCOVERED_TEST_ID" ]] || [[ -z "$DISCOVERED_RUN_ID" ]]; then
    begin_test "dlt runs get <testId> <runId> --format table"
    skip "runs get (table)" "no testId/runId discovered"
    return
  fi

  begin_test "dlt runs get $DISCOVERED_TEST_ID $DISCOVERED_RUN_ID --format table"
  run_dlt runs get "$DISCOVERED_TEST_ID" "$DISCOVERED_RUN_ID" --format table
  assert_exit_success
  assert_stdout_not_empty "table output present"
}

test_runs_latest_json() {
  if [[ -z "$DISCOVERED_TEST_ID" ]]; then
    begin_test "dlt runs latest <testId> --format json"
    skip "runs latest (json)" "no testId discovered"
    return
  fi

  begin_test "dlt runs latest $DISCOVERED_TEST_ID --format json"
  run_dlt runs latest "$DISCOVERED_TEST_ID" --format json
  if [[ "$LAST_EXIT_CODE" -eq 0 ]]; then
    assert_stdout_valid_json
    assert_stdout_json_field '.testRunId' "" "has testRunId"
    assert_stdout_json_field '.status' "" "has status"
  else
    # No runs for this scenario — that's OK
    pass "no runs yet (exit $LAST_EXIT_CODE is acceptable)"
  fi
}

test_runs_latest_table() {
  if [[ -z "$DISCOVERED_TEST_ID" ]]; then
    begin_test "dlt runs latest <testId> --format table"
    skip "runs latest (table)" "no testId discovered"
    return
  fi

  begin_test "dlt runs latest $DISCOVERED_TEST_ID --format table"
  run_dlt runs latest "$DISCOVERED_TEST_ID" --format table
  # May exit non-zero if no runs
  if [[ "$LAST_EXIT_CODE" -eq 0 ]]; then
    assert_stdout_not_empty "table output present"
  else
    pass "no runs yet (acceptable)"
  fi
}

test_runs_baseline_json() {
  if [[ -z "$DISCOVERED_TEST_ID" ]]; then
    begin_test "dlt runs baseline <testId> --format json"
    skip "runs baseline" "no testId discovered"
    return
  fi

  begin_test "dlt runs baseline $DISCOVERED_TEST_ID --format json"
  run_dlt runs baseline "$DISCOVERED_TEST_ID" --format json
  # Baseline may not exist — both success and failure are valid
  if [[ "$LAST_EXIT_CODE" -eq 0 ]]; then
    assert_stdout_valid_json
    pass "baseline run found"
  else
    pass "no baseline run (exit $LAST_EXIT_CODE is acceptable)"
  fi
}

# ---------------------------------------------------------------------------
# 5. Active Runs
# ---------------------------------------------------------------------------

test_runs_active_json() {
  begin_test "dlt runs active --format json"
  run_dlt runs active --format json
  assert_exit_success
  assert_stdout_valid_json
  assert_stdout_json_array "result is array (may be empty)"
}

test_runs_active_single_json() {
  if [[ -z "$DISCOVERED_TEST_ID" ]]; then
    begin_test "dlt runs active <testId> --format json"
    skip "runs active single" "no testId discovered"
    return
  fi

  begin_test "dlt runs active $DISCOVERED_TEST_ID --format json"
  run_dlt runs active "$DISCOVERED_TEST_ID" --format json
  assert_exit_success
  assert_stdout_valid_json
  assert_stdout_json_array "result is array"
}

test_runs_active_table() {
  begin_test "dlt runs active --format table"
  run_dlt runs active --format table
  assert_exit_success
  # May be empty — (no results) goes to stderr
  pass "active table executed without error"
}

# ---------------------------------------------------------------------------
# 6. Artifacts
# ---------------------------------------------------------------------------

test_runs_artifacts_json() {
  if [[ -z "$DISCOVERED_TEST_ID" ]] || [[ -z "$DISCOVERED_RUN_ID" ]]; then
    begin_test "dlt runs artifacts <testId> <runId> --format json"
    skip "runs artifacts (json)" "no testId/runId discovered"
    return
  fi

  begin_test "dlt runs artifacts $DISCOVERED_TEST_ID $DISCOVERED_RUN_ID --format json"
  run_dlt runs artifacts "$DISCOVERED_TEST_ID" "$DISCOVERED_RUN_ID" --format json
  assert_exit_success
  assert_stdout_valid_json
  assert_stdout_json_field '.testId' "$DISCOVERED_TEST_ID" "testId matches"
  assert_stdout_json_field '.runId' "$DISCOVERED_RUN_ID" "runId matches"
  assert_stdout_json_field '.artifactPrefix' "" "has artifactPrefix"
}

test_runs_artifacts_table() {
  if [[ -z "$DISCOVERED_TEST_ID" ]] || [[ -z "$DISCOVERED_RUN_ID" ]]; then
    begin_test "dlt runs artifacts <testId> <runId> --format table"
    skip "runs artifacts (table)" "no testId/runId discovered"
    return
  fi

  begin_test "dlt runs artifacts $DISCOVERED_TEST_ID $DISCOVERED_RUN_ID --format table"
  run_dlt runs artifacts "$DISCOVERED_TEST_ID" "$DISCOVERED_RUN_ID" --format table
  assert_exit_success
  assert_stdout_not_empty "table output present"
}

# ---------------------------------------------------------------------------
# 7. Download Artifacts
# ---------------------------------------------------------------------------

test_runs_download_dry_run() {
  if [[ -z "$DISCOVERED_TEST_ID" ]] || [[ -z "$DISCOVERED_RUN_ID" ]]; then
    begin_test "dlt runs download --dry-run"
    skip "runs download dry-run" "no testId/runId discovered"
    return
  fi
  if [[ "${SKIP_DOWNLOAD:-}" == "true" ]]; then
    begin_test "dlt runs download --dry-run"
    skip "runs download dry-run" "SKIP_DOWNLOAD=true"
    return
  fi

  begin_test "dlt runs download $DISCOVERED_TEST_ID $DISCOVERED_RUN_ID --dry-run"
  run_dlt runs download "$DISCOVERED_TEST_ID" "$DISCOVERED_RUN_ID" --dry-run
  assert_exit_success
  # Dry run lists files to stdout (may be empty if no artifacts yet)
  pass "dry-run completed"
}

test_runs_download_to_dir() {
  if [[ -z "$DISCOVERED_TEST_ID" ]] || [[ -z "$DISCOVERED_RUN_ID" ]]; then
    begin_test "dlt runs download to directory"
    skip "runs download to dir" "no testId/runId discovered"
    return
  fi
  if [[ "${SKIP_DOWNLOAD:-}" == "true" ]]; then
    begin_test "dlt runs download to directory"
    skip "runs download to dir" "SKIP_DOWNLOAD=true"
    return
  fi

  local target_dir="${DOWNLOAD_DIR}/dir-download"

  begin_test "dlt runs download $DISCOVERED_TEST_ID $DISCOVERED_RUN_ID -o $target_dir"
  run_dlt runs download "$DISCOVERED_TEST_ID" "$DISCOVERED_RUN_ID" -o "$target_dir"
  assert_exit_success

  if [[ -d "$target_dir" ]]; then
    assert_dir_not_empty "$target_dir" "downloaded files to directory"
  else
    # No artifacts found is acceptable for some runs
    pass "no artifacts found (directory not created)"
  fi
}

test_runs_download_to_zip() {
  if [[ -z "$DISCOVERED_TEST_ID" ]] || [[ -z "$DISCOVERED_RUN_ID" ]]; then
    begin_test "dlt runs download --zip"
    skip "runs download to zip" "no testId/runId discovered"
    return
  fi
  if [[ "${SKIP_DOWNLOAD:-}" == "true" ]]; then
    begin_test "dlt runs download --zip"
    skip "runs download to zip" "SKIP_DOWNLOAD=true"
    return
  fi

  local zip_file="${DOWNLOAD_DIR}/test-artifacts.zip"

  begin_test "dlt runs download $DISCOVERED_TEST_ID $DISCOVERED_RUN_ID --zip -o $zip_file"
  run_dlt runs download "$DISCOVERED_TEST_ID" "$DISCOVERED_RUN_ID" --zip -o "$zip_file"
  assert_exit_success

  if [[ -f "$zip_file" ]]; then
    assert_file_exists "$zip_file" "zip file created"
    # Verify it's actually a zip
    if command -v unzip &>/dev/null; then
      if unzip -t "$zip_file" >/dev/null 2>&1; then
        pass "zip file is valid"
      else
        fail "zip file is corrupted"
      fi
    else
      pass "zip file exists (unzip not available for validation)"
    fi
  else
    pass "no artifacts found (zip not created)"
  fi
}

test_runs_download_with_filter() {
  if [[ -z "$DISCOVERED_TEST_ID" ]] || [[ -z "$DISCOVERED_RUN_ID" ]]; then
    begin_test "dlt runs download --filter --dry-run"
    skip "runs download with filter" "no testId/runId discovered"
    return
  fi
  if [[ "${SKIP_DOWNLOAD:-}" == "true" ]]; then
    begin_test "dlt runs download --filter --dry-run"
    skip "runs download with filter" "SKIP_DOWNLOAD=true"
    return
  fi

  begin_test "dlt runs download $DISCOVERED_TEST_ID $DISCOVERED_RUN_ID --filter '*.json' --dry-run"
  run_dlt runs download "$DISCOVERED_TEST_ID" "$DISCOVERED_RUN_ID" --filter "*.json" --dry-run
  assert_exit_success
  pass "filter dry-run completed"
}

# ---------------------------------------------------------------------------
# 8. Scenario Start (full lifecycle)
# ---------------------------------------------------------------------------

test_scenarios_start() {
  if [[ -z "$DISCOVERED_TEST_ID" ]]; then
    begin_test "dlt scenarios start <testId>"
    skip "scenarios start" "no testId discovered"
    return
  fi
  if [[ "${SKIP_START_TEST:-}" == "true" ]]; then
    begin_test "dlt scenarios start <testId>"
    skip "scenarios start" "SKIP_START_TEST=true"
    return
  fi

  # Find a scenario that is NOT currently running
  STARTED_TEST_ID=""
  run_dlt scenarios list --format json
  if [[ "$LAST_EXIT_CODE" -ne 0 ]]; then
    begin_test "dlt scenarios start (find idle scenario)"
    skip "scenarios start" "could not list scenarios"
    return
  fi

  local idle_id
  idle_id=$(jq -r '[.[] | select(.status != "running" and .status != "pending" and .status != "provisioning")] | .[0].testId // empty' "$STDOUT_FILE" 2>/dev/null)

  if [[ -z "$idle_id" ]]; then
    begin_test "dlt scenarios start (find idle scenario)"
    skip "scenarios start" "all scenarios are currently running"
    return
  fi

  STARTED_TEST_ID="$idle_id"
  begin_test "dlt scenarios start $STARTED_TEST_ID"
  run_dlt scenarios start "$STARTED_TEST_ID" --format json
  assert_exit_success "start command succeeded"
  assert_stdout_valid_json
  pass "test started for $STARTED_TEST_ID"
}

test_scenarios_start_poll_complete() {
  if [[ -z "$STARTED_TEST_ID" ]]; then
    begin_test "poll started test to completion"
    skip "poll completion" "no test was started"
    return
  fi

  begin_test "poll $STARTED_TEST_ID until complete (timeout: ${POLL_TIMEOUT}s)"
  local start_time
  start_time=$(date +%s)
  local status="unknown"

  while true; do
    local elapsed=$(( $(date +%s) - start_time ))
    if [[ "$elapsed" -ge "$POLL_TIMEOUT" ]]; then
      fail "poll timed out after ${POLL_TIMEOUT}s (last status: $status)"
      return
    fi

    run_dlt scenarios get "$STARTED_TEST_ID" --format json
    if [[ "$LAST_EXIT_CODE" -ne 0 ]]; then
      echo -e "      ${YELLOW}  Warning: scenarios get failed, retrying...${RESET}"
      sleep 15
      continue
    fi

    status=$(jq -r '.status // "unknown"' "$STDOUT_FILE" 2>/dev/null)
    echo -e "      ${CYAN}  Status: $status (${elapsed}s elapsed)${RESET}"

    case "$status" in
      complete|completed)
        pass "test completed (${elapsed}s)"
        return
        ;;
      failed|cancelled|error)
        pass "test finished with status: $status (${elapsed}s) — this is still a valid result"
        return
        ;;
      running|pending|provisioning)
        sleep 15
        ;;
      *)
        # Unknown status — might be done
        if [[ "$status" != "running" ]] && [[ "$status" != "pending" ]] && [[ "$status" != "provisioning" ]]; then
          pass "test reached terminal status: $status (${elapsed}s)"
          return
        fi
        sleep 15
        ;;
    esac
  done
}

# ---------------------------------------------------------------------------
# 9. Error Paths
# ---------------------------------------------------------------------------

test_runs_invalid_testid() {
  begin_test "dlt runs list nonexistent-id-zzzzz (should fail)"
  run_dlt runs list "nonexistent-id-zzzzz" --format json
  # API may return empty array or error — both are acceptable
  if [[ "$LAST_EXIT_CODE" -eq 0 ]]; then
    assert_stdout_valid_json
    pass "returned successfully (likely empty result)"
  else
    assert_exit_failure "rejects invalid testId"
  fi
}

test_runs_invalid_runid() {
  if [[ -z "$DISCOVERED_TEST_ID" ]]; then
    begin_test "dlt runs get <testId> nonexistent-run"
    skip "runs get invalid runId" "no testId discovered"
    return
  fi

  begin_test "dlt runs get $DISCOVERED_TEST_ID nonexistent-run-zzzzz (should fail)"
  run_dlt runs get "$DISCOVERED_TEST_ID" "nonexistent-run-zzzzz" --format json
  assert_exit_failure "rejects invalid runId"
}

test_login_missing_args() {
  begin_test "dlt login --srp (missing username, should fail)"
  run_dlt login --srp
  assert_exit_failure "requires --username for SRP"
}

test_login_mutually_exclusive() {
  begin_test "dlt login --srp --iam (mutually exclusive, should fail)"
  run_dlt login --srp --iam
  assert_exit_failure "rejects --srp + --iam"
}

# ---------------------------------------------------------------------------
# 10. Logout (non-destructive check only)
# ---------------------------------------------------------------------------

test_logout_dry_check() {
  begin_test "dlt logout (skipped — would disrupt session)"
  skip "logout" "would remove credentials and require re-login"
}

# ===========================================================================
# Main
# ===========================================================================

main() {
  setup

  # Trap to ensure cleanup even on error
  trap teardown EXIT

  section "1. Basic CLI"
  test_version
  test_help
  test_help_subcommands

  section "2. Token Commands"
  test_token_status_table
  test_token_status_json
  test_token_output_access
  test_token_output_id
  test_token_output_invalid_type

  section "3. Scenarios Commands"
  test_scenarios_list_json
  test_scenarios_list_table
  test_scenarios_get_json
  test_scenarios_get_table
  test_scenarios_get_invalid

  section "4. Runs Commands"
  test_runs_list_json
  test_runs_list_table
  test_runs_list_with_limit
  test_runs_get_json
  test_runs_get_table
  test_runs_latest_json
  test_runs_latest_table
  test_runs_baseline_json

  section "5. Active Runs"
  test_runs_active_json
  test_runs_active_single_json
  test_runs_active_table

  section "6. Artifacts"
  test_runs_artifacts_json
  test_runs_artifacts_table

  section "7. Download Artifacts"
  test_runs_download_dry_run
  test_runs_download_to_dir
  test_runs_download_to_zip
  test_runs_download_with_filter

  section "8. Scenario Start (Full Lifecycle)"
  test_scenarios_start
  test_scenarios_start_poll_complete

  section "9. Error Paths"
  test_runs_invalid_testid
  test_runs_invalid_runid
  test_login_missing_args
  test_login_mutually_exclusive

  section "10. Logout"
  test_logout_dry_check

  # Summary
  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}  Test Summary${RESET}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${RESET}"
  echo ""
  echo -e "  ${GREEN}Passed:  ${PASS_COUNT}${RESET}"
  echo -e "  ${RED}Failed:  ${FAIL_COUNT}${RESET}"
  echo -e "  ${YELLOW}Skipped: ${SKIP_COUNT}${RESET}"
  echo -e "  Total assertions: $((PASS_COUNT + FAIL_COUNT + SKIP_COUNT))"
  echo ""

  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    echo -e "  ${RED}${BOLD}RESULT: FAIL${RESET}"
    exit 1
  else
    echo -e "  ${GREEN}${BOLD}RESULT: PASS${RESET}"
    exit 0
  fi
}

main "$@"
