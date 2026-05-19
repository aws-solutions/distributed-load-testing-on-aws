#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
[[ $DEBUG ]] && set -x
set -e -o pipefail

header() {
    declare text=$1
    echo "------------------------------------------------------------------------------"
    echo "$text"
    echo "------------------------------------------------------------------------------"
}

usage() {
    echo "Please provide the base source bucket name, trademark approved solution name and version where the lambda code will eventually reside."
    echo "For example: ./build-s3-dist.sh solutions trademarked-solution-name v1.0.0"
}

main() {
    if [ ! "$1" ] || [ ! "$2" ] || [ ! "$3" ]; then
        usage
        exit 1
    fi
    set -u

    declare DIST_OUTPUT_BUCKET=$1 SOLUTION_NAME=$2 VERSION=$3

    # Validate version contains a parseable semver (matches source regex: /v?(\d+)\.(\d+)\.(\d+)/)
    if ! echo "$VERSION" | grep -qE '(^|[^0-9])v?[0-9]+\.[0-9]+\.[0-9]+'; then
        echo "Error: VERSION '$VERSION' must contain a valid semver pattern (e.g. v4.1.0, custom-v4.1.0)"
        exit 1
    fi

    # Warn if version doesn't match cdk.json solutionVersion
    local project_root_check=$(dirname "$(cd -P -- "$(dirname "$0")" && pwd -P)")
    local CDK_VERSION=$(node -p "require('${project_root_check}/source/infrastructure/cdk.json').context.solutionVersion" 2>/dev/null)
    if [ -n "$CDK_VERSION" ]; then
        local SCRIPT_SEMVER=$(echo "$VERSION" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
        local CDK_SEMVER=$(echo "$CDK_VERSION" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
        if [ "$SCRIPT_SEMVER" != "$CDK_SEMVER" ]; then
            echo "Warning: VERSION '$VERSION' ($SCRIPT_SEMVER) does not match cdk.json solutionVersion '$CDK_VERSION' ($CDK_SEMVER)"
        fi
    fi

    export DIST_OUTPUT_BUCKET
    export SOLUTION_NAME
    export VERSION

    # Get reference for all important folders
    local project_root=$(dirname "$(cd -P -- "$(dirname "$0")" && pwd -P)")
    local deployment_dir="$project_root"/deployment
    #output folders
    local global_dist_dir="$deployment_dir"/global-s3-assets
    local regional_dist_dir="$deployment_dir"/regional-s3-assets

    #build directories
    local source_dir="$project_root"/source
    local cdk_out_dir="$source_dir"/infrastructure/cdk.out

    # Launch Wizard directory
    local launch_wizard_dir="$deployment_dir/launch-wizard-assets"

    header "[Init] Remove any old dist files from previous runs"

    rm -rf "$global_dist_dir"
    mkdir -p "$global_dist_dir"
    rm -rf "$regional_dist_dir"
    mkdir -p "$regional_dist_dir"
    rm -rf "$cdk_out_dir"

    header "[Synth] CDK Project"

    # Install workspace dependencies at project root.
    # Workspace packages have their deps hoisted here and must be
    # available before CDK synth bundles Lambda code via esbuild.
    cd "${project_root}"
    npm ci

    header "[Build-CLI] Bundling DLT CLI"
    npm run bundle -w source/cli

    cd "${source_dir}"/infrastructure
    npm ci
    npm run install:all

    # Run pre-build scripts for container images before CDK synth
    # CDK needs these files when building Docker images during synth
    header "[Docker] Running pre-build scripts"
    for image_dir in "$deployment_dir"/ecr/*/; do
        if [ -f "$image_dir/pre-build.sh" ]; then
            echo "Running pre-build for $(basename "$image_dir")"
            (cd "$image_dir" && bash pre-build.sh)
        fi
    done

    node_modules/aws-cdk/bin/cdk synth --asset-metadata false --path-metadata false

    # Download JMeter bundled assets using shared script
    header "[JMeter] Downloading JMeter Bundle"
    source "$project_root/scripts/download-jmeter-bundle.sh"
    download_jmeter_assets "$regional_dist_dir"

    header "[Packing] Template artifacts"

    # copy templates to global_dist_dir
    echo "Move templates from staging to global_dist_dir"
    cp "$cdk_out_dir"/*.template.json "$global_dist_dir"/

    # Rename all *.template.json files to *.template
    echo "Rename all *.template.json to *.template"
    echo "copy templates and rename"
    for f in "$global_dist_dir"/*.template.json; do
        mv -- "$f" "${f%.template.json}.template"
    done

    header "[Move-Regional-Template] Move regional template to regional folder"
    mv "$global_dist_dir"/*-regional.template "$regional_dist_dir"

    header "[Build-Console] Building console assets"
    cd "$source_dir/webui/" || exit 1
    # Remove old build assets
    rm -rf dist/
    npm ci
    # npm run build outputs to dist/
    GENERATE_SOURCEMAP=false INLINE_RUNTIME_CHUNK=false npm run build
    if [ $? -eq 0 ]
    then
      header "UI build succeeded"
    else
      header "UI build FAILED"
      exit 1
    fi

    header "[CDK-Helper] Copy the Lambda Asset and Console Assets"
    pushd "$cdk_out_dir"
    # Loop over already zipped assets (console asset mainly) and copy to destination
    for f in asset.*.zip; do cp "$f" "$regional_dist_dir/${f#asset.}"; done

    # Loop over all items in the current directory that start with "asset. but are not zipped"
    for f in asset.*; do
      # Check if it is a directory
      if [ -d "$f" ]; then
        # The zip file is created with the original name (with asset. prefix)
        zipfile="${f}.zip"

        # Only zip it if the zip file doesn't already exist
        if [ ! -f "$zipfile" ]; then
          echo "Zipping folder: $f -> $zipfile"
          (cd "$f" && zip -r "../$zipfile" .)
        else
          echo "Zip file already exists: $zipfile"
        fi

        new_name="${f#asset.}.zip"

        # Copy the zip file to $regional_dist_dir
        cp "$zipfile" "$regional_dist_dir/$new_name"
        echo "Copied $zipfile as $new_name to $regional_dist_dir"
      fi
    done
    popd

    header "[Packing] Launch Wizard Assets"
    if [ -d "${launch_wizard_dir}" ]; then
        for profile_dir in "${launch_wizard_dir}"/*; do
            if [ -d "${profile_dir}" ]; then
                for version_dir in "${profile_dir}"/*; do
                    if [ -d "${version_dir}/helpPanels" ]; then
                        echo "Zipping helpPanels for $(basename "${profile_dir}")/$(basename "${version_dir}")"
                        (cd "${version_dir}/helpPanels" && zip -q -r9 "${version_dir}/helpPanels.zip" .) || exit 1
                    fi
                done
            fi
        done
    fi
}

main "$@"