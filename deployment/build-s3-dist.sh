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
    # Check to see if the required parameters have been provided:


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

    header "[Init] Remove any old dist files from previous runs"

    rm -rf "$global_dist_dir"
    mkdir -p "$global_dist_dir"
    rm -rf "$regional_dist_dir"
    mkdir -p "$regional_dist_dir"
    rm -rf "$cdk_out_dir"

    header "[Synth] CDK Project"
    cd ${source_dir}/infrastructure
    npm ci 
    npm run install:all

    node_modules/aws-cdk/bin/cdk synth --asset-metadata false --path-metadata false

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

    header "[Move-Regiona-Template] Move regional template to regional folder"
    mv "$global_dist_dir"/*-regional.template "$regional_dist_dir"

    header "[Build-Console] Building console assets"
    cd ${source_dir}/console
    npm ci
    npm run build

    header "[CDK-Helper] Copy the Lambda Asset and Console Assets"
    pushd $cdk_out_dir
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

}

main "$@"
