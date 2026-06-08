#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =========================================================================
# JMeter Bundle Creator
# =========================================================================
# Creates jmeter-bundle.tgz for S3 deployment, containing:
#   - JMeter binary (version from jmeter.json)
#   - SHA512 checksum for verification
#   - Pre-downloaded plugins as zip files
#   - jmeter.json (copied for runtime plugin detection)
#
# Bundle Structure:
#   jmeter-bundle/
#   ├── apache-jmeter-{version}.tgz
#   ├── apache-jmeter-{version}.tgz.sha512
#   ├── jmeter.json          # Runtime reference for plugin override detection
#   └── plugins/
#       ├── jpgc-json-2.7.zip
#       ├── bzm-http2-2.0.6.zip
#       └── ...
#
# Deployment Flow:
#   1. This script creates the bundle during release builds
#   2. Bundle is uploaded to public AWS Solutions S3 bucket
#   3. CopyJMeterBundle custom resource (custom-resources.ts) copies bundle
#      from Solutions bucket to customer's scenarios bucket at stack deployment
#   4. load-test.sh downloads bundle from scenarios bucket at runtime
#
# Related Files:
#   - jmeter.json: Single source of truth for JMeter version and plugins
#   - load-test.sh: Consumes this bundle at runtime in Fargate tasks
#   - source/infrastructure/lib/common-resources/custom-resources.ts:
#     Contains CopyJMeterBundle custom resource that copies bundle to
#     customer's scenarios bucket (s3://{bucket}/frameworks/jmeter/)
#
# Usage:
#   ./scripts/download-jmeter-bundle.sh <output_directory>
#   Used by both release builds (build-s3-dist.sh) and local development (Makefile)
# =========================================================================

set -e

download_jmeter_assets() {
    echo "[Download] JMeter and Plugins"

    # Get project root
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local project_root="$(cd "$script_dir/.." && pwd)"
    local jmeter_json="$project_root/jmeter.json"

    # Output directory is passed as argument
    local output_dir="${1:-}"
    if [ -z "$output_dir" ]; then
        echo "Error: Output directory not specified"
        echo "Usage: $0 <output_directory>"
        exit 1
    fi

    # Create output directory if it doesn't exist
    mkdir -p "$output_dir"

    # Create temp directory for downloads
    local temp_dir=$(mktemp -d)
    local bundle_dir="$temp_dir/jmeter-bundle"
    local plugins_dir="$bundle_dir/plugins"

    echo "Creating temporary directories..."
    mkdir -p "$bundle_dir"
    mkdir -p "$plugins_dir"

    # Parse jmeter.json
    echo "Reading jmeter.json..."
    local jmeter_version=$(jq -r '.version' "$jmeter_json")
    local binary_url_template=$(jq -r '.download.binary' "$jmeter_json")
    local sha512_url_template=$(jq -r '.download.sha512' "$jmeter_json")
    local plugins_url_template=$(jq -r '.download.plugins' "$jmeter_json")

    # Substitute {version} placeholder in JMeter URLs
    local binary_url="${binary_url_template//\{version\}/$jmeter_version}"
    local sha512_url="${sha512_url_template//\{version\}/$jmeter_version}"

    # Download JMeter binary
    echo "Downloading JMeter ${jmeter_version}..."
    curl -fSL -o "$bundle_dir/apache-jmeter-${jmeter_version}.tgz" "$binary_url" || {
        echo "Error: Failed to download JMeter binary"
        rm -rf "$temp_dir"
        exit 1
    }

    # Download SHA512 checksum
    echo "Downloading SHA512 checksum..."
    curl -fSL -o "$bundle_dir/apache-jmeter-${jmeter_version}.tgz.sha512" "$sha512_url" || {
        echo "Error: Failed to download SHA512 checksum"
        rm -rf "$temp_dir"
        exit 1
    }

    # Verify SHA512 checksum
    echo "Verifying SHA512 checksum..."
    cd "$bundle_dir"
    sha512sum -c "apache-jmeter-${jmeter_version}.tgz.sha512" || {
        echo "Error: SHA512 checksum verification failed"
        cd "$project_root"
        rm -rf "$temp_dir"
        exit 1
    }
    cd "$project_root"

    # Download plugins
    echo "Downloading JMeter plugins..."
    local plugin_count=$(jq -r '.plugins | length' "$jmeter_json")
    echo "Found ${plugin_count} plugins to download"

    local current=0
    for plugin in $(jq -r '.plugins | keys[]' "$jmeter_json"); do
        current=$((current + 1))
        version=$(jq -r ".plugins[\"$plugin\"]" "$jmeter_json")
        
        # Substitute {plugin} and {version} placeholders in plugin URL template
        local plugin_url="${plugins_url_template//\{plugin\}/$plugin}"
        plugin_url="${plugin_url//\{version\}/$version}"
        
        echo "  [${current}/${plugin_count}] Downloading ${plugin}-${version}.zip..."
        curl -fSL -o "$plugins_dir/${plugin}-${version}.zip" "$plugin_url" || {
            echo "Error: Failed to download plugin ${plugin}-${version}"
            rm -rf "$temp_dir"
            exit 1
        }
    done

    # Copy jmeter.json to bundle for runtime reference
    echo "Copying jmeter.json to bundle..."
    cp "$jmeter_json" "$bundle_dir/jmeter.json"

    # Create bundle
    echo "Creating jmeter-bundle.tgz..."
    tar --format=ustar -czf "$output_dir/jmeter-bundle.tgz" -C "$temp_dir" jmeter-bundle || {
        echo "Error: Failed to create bundle"
        rm -rf "$temp_dir"
        exit 1
    }

    # Cleanup
    echo "Cleaning up temporary files..."
    rm -rf "$temp_dir"

    echo "Successfully created jmeter-bundle.tgz in $output_dir"
}

# If script is executed directly (not sourced), run the function
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    download_jmeter_assets "$@"
fi
