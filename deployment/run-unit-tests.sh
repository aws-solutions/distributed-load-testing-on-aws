#!/bin/bash
#
# This script runs all tests for the root CDK project, as well as any microservices, Lambda functions, or dependency
# source code packages. These include unit tests and snapshot tests.
#
# The if/then blocks are for error handling. They will cause the script to stop executing if an error is thrown from the
# node process running the test case(s). Removing them or not using them for additional calls with result in the
# script continuing to execute despite an error being thrown.
# 
# Options:
#   --skip-install  Skip npm ci and npm install:all steps (useful when dependencies are already installed).

[ "$DEBUG" == 'true' ] && set -x
set -e

skip_install=false
for arg in "$@"; do
  case $arg in
    --skip-install) skip_install=true ;;
    --skip-installs) skip_install=true ;;
  esac
done


prepare_jest_coverage_report() {
	local component_name=$1

    if [ ! -d "coverage" ]; then
        echo "ValidationError: Missing required directory coverage after running unit tests"
        exit 129
    fi

	  # prepare coverage reports
    rm -fr coverage/lcov-report
    mkdir -p $coverage_reports_top_path
    coverage_report_path=$coverage_reports_top_path/$component_name
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

  # run unit tests
  npm test

  # prepare coverage reports
  prepare_jest_coverage_report $component_name

}

check_version_consistency() {
  local project_root=$1
  local version_file="$project_root/VERSION.txt"
  local manifest_file="$project_root/solution-manifest.yaml"
  local ecr_tags_file="$project_root/deployment/ecr_image_tags.json"

  echo "Running version consistency check"

  if [ ! -f "$version_file" ]; then
    echo "******************************************************************************"
    echo "VERSION.txt not found"
    echo "******************************************************************************"
    exit 1
  fi

  local version
  version=$(<"$version_file")
  version=$(echo "$version" | tr -d '[:space:]')

  local manifest_version
  manifest_version=$(grep '^version:' "$manifest_file" | sed 's/version: v//' | tr -d '[:space:]')

  if [ "$version" != "$manifest_version" ]; then
    echo "******************************************************************************"
    echo "Version mismatch: VERSION.txt ($version) != solution-manifest.yaml ($manifest_version)"
    echo "******************************************************************************"
    exit 1
  fi

  local major_minor
  major_minor=$(echo "$version" | cut -d. -f1,2)

  if [ -f "$ecr_tags_file" ]; then
    if ! command -v jq &> /dev/null; then
      echo "******************************************************************************"
      echo "jq is required for ECR image tag validation but is not installed"
      echo "******************************************************************************"
      exit 1
    fi

    local invalid_tags
    invalid_tags=$(jq -r --arg prefix "v${major_minor}" 'to_entries[] | select(.value | startswith($prefix) | not) | "\(.key): \(.value)"' "$ecr_tags_file")
    if [ -n "$invalid_tags" ]; then
      echo "******************************************************************************"
      echo "ECR image tag(s) do not match VERSION.txt major.minor (v${major_minor}):"
      echo "$invalid_tags"
      echo "******************************************************************************"
      exit 1
    fi
  fi

  echo "Version consistency check passed"
}

# Get reference for source folder
source_dir="$(cd $PWD/../source; pwd -P)"
coverage_reports_top_path=$source_dir/coverage-reports

if [ "$skip_install" = false ]; then
  # Install workspace dependencies
  cd $source_dir/..
  npm ci

  # Install legacy package dependencies (via source/ package.json script)
  cd $source_dir
  npm run install:all
fi

cd $source_dir

#run prettier
echo "Running prettier formatting check"
npm run prettier-check
if [ $? -eq 0 ]
then
  echo "Formatting check passed"
else
  echo "******************************************************************************"
  echo "Test FAILED formatting check, run prettier-formatting on code"
  echo "******************************************************************************"
  exit 1
fi

#run linting check
echo "Running linting check"
npm run lint
if [ $? -eq 0 ]
then
  echo "Formatting check passed"
else
  echo "******************************************************************************"
  echo "Test FAILED linting check, run eslint on code and fix corresponding issues"
  echo "******************************************************************************"
  exit 1
fi

check_version_consistency "$source_dir/.."

# # Run workspace checks (root eslint.config.ts + root prettier)
# echo "Running workspace formatting check"
# cd $source_dir/..
# npm run fmt:check
# if [ $? -eq 0 ]
# then
#   echo "Workspace formatting check passed"
# else
#   echo "******************************************************************************"
#   echo "Test FAILED workspace formatting check"
#   echo "******************************************************************************"
#   exit 1
# fi

# echo "Running workspace linting check"
# cd $source_dir/..
# npm run lint
# if [ $? -eq 0 ]
# then
#   echo "Workspace linting check passed"
# else
#   echo "******************************************************************************"
#   echo "Test FAILED workspace linting check"
#   echo "******************************************************************************"
#   exit 1
# fi

# echo "Running workspace unit tests"
cd $source_dir/..
npm test
if [ $? -eq 0 ]
then
  echo "Workspace unit tests passed"
else
  echo "******************************************************************************"
  echo "Workspace unit tests FAILED"
  echo "******************************************************************************"
  exit 1
fi

# Build webui for infrastructure tests
echo "Building webui for infrastructure tests"
cd $source_dir/webui
npm run build
if [ $? -eq 0 ]
then
  echo "WebUI build passed"
else
  echo "******************************************************************************"
  echo "WebUI build FAILED"
  echo "******************************************************************************"
  exit 1
fi

# Run unit tests
echo "Running unit tests"

rm -rf $source_dir/test # clean up legacy coverage files
rm -rf $source_dir/coverage-reports # clean up past coverage files

# Workspace packages are already tested by root npm test above; collect their directory names to skip
workspace_pkgs=" $(jq -r '.workspaces[] | split("/")[-1]' "$source_dir/../package.json" | tr '\n' ' ')"

# Discover legacy packages dynamically: any folder under source/ with a test script that is not a workspace package
declare -a packages=()
for dir in "$source_dir"/*/; do
  package=$(basename "$dir")
  [[ "$workspace_pkgs" == *" $package "* ]] && continue
  if [ -f "$dir/package.json" ] && jq -e '.scripts.test' "$dir/package.json" > /dev/null 2>&1; then
    packages+=("$package")
  fi
done

echo "Discovered test packages: ${packages[*]}"

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

# Collect workspace package coverage reports into source/coverage-reports/
echo "Collecting workspace package coverage reports"
for ws in $(jq -r '.workspaces[]' "$source_dir/../package.json"); do
  ws_dir="$source_dir/../$ws"
  ws_name=$(basename "$ws")
  if [ -d "$ws_dir/coverage" ]; then
    rm -fr "$ws_dir/coverage/lcov-report"
    coverage_report_path="$coverage_reports_top_path/$ws_name"
    rm -fr "$coverage_report_path"
    mv "$ws_dir/coverage" "$coverage_report_path"
    echo "  Collected coverage for $ws_name"
  fi
done
