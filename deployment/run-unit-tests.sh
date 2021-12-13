#!/bin/bash
#
# This script runs all tests for the root CDK project, as well as any microservices, Lambda functions, or dependency
# source code packages. These include unit tests and snapshot tests.
#
# The if/then blocks are for error handling. They will cause the script to stop executing if an error is thrown from the
# node process running the test case(s). Removing them or not using them for additional calls with result in the
# script continuing to execute despite an error being thrown.

[ "$DEBUG" == 'true' ] && set -x
set -e


prepare_jest_coverage_report() {
	local component_name=$1

    if [ ! -d "coverage" ]; then
        echo "ValidationError: Missing required directory coverage after running unit tests"
        exit 129
    fi

	# prepare coverage reports
    rm -fr coverage/lcov-report
    mkdir -p $coverage_reports_top_path/jest
    coverage_report_path=$coverage_reports_top_path/jest/$component_name
    rm -fr $coverage_report_path
    mv coverage $coverage_report_path
}

run_tests() {
  local component_path=$1
  local component_name=$2

  echo "------------------------------------------------------------------------------"
  echo "[Test] Run unit test with coverage for $component_name"
  echo "------------------------------------------------------------------------------"
  echo "cd $component_path"
  cd $component_path

  # install dependencies
  npm run clean
  npm install

  # run unit tests
  npm test

  # prepare coverage reports
  prepare_jest_coverage_report $component_name
}

# Run unit tests
echo "Running unit tests"

# Get reference for source folder
source_dir="$(cd $PWD/../source; pwd -P)"
coverage_reports_top_path=$source_dir/test/coverage-reports

# Test packages
declare -a packages=(
    "api-services"
    "custom-resource"
    "infrastructure"
    "results-parser"
    "task-canceler"
    "task-runner"
    "task-status-checker"
)

for package in "${packages[@]}"; do
  run_tests $source_dir/$package $package
  # Check the result of the test and exit if a failure is identified
  if [ $? -eq 0 ]
  then
    echo "Test for $package passed"
  else
    echo "******************************************************************************"
    echo "Test FAILED for $package"
    echo "******************************************************************************"
    exit 1
  fi
done