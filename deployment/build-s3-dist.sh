#!/usr/bin/env bash
#
# This assumes all of the OS-level configuration has been completed and git repo has already been cloned
#
# This script should be run from the repo's deployment directory
# cd deployment
# ./build-s3-dist.sh source-bucket-base-name trademarked-solution-name version-code
#
# Paramenters:
#  - source-bucket-base-name: Name for the S3 bucket location where the AWS CloudFormation template will source the Lambda code from. 
#    The AWS Lambda code is contained in the zip files. The template will append '-[region_name]' to this bucket name.
#    For example: ./build-s3-dist.sh solutions my-solution v1.0.0
#    The template will then expect the source code to be located in the solutions-[region_name] bucket
#
#  - trademarked-solution-name: name of the solution for consistency
#
#  - version-code: version of the package (should follow semver)

# Check to see if input has been provided:
if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
    echo "Please provide the base source bucket name, trademark approved solution name and version where the lambda code will eventually reside."
    echo "For example: ./build-s3-dist.sh solutions trademarked-solution-name v1.0.0"
    exit 1
fi

set -e

# Get reference for all important folders
template_dir="$PWD"
template_dist_dir="${template_dir}/global-s3-assets"
build_dist_dir="${template_dir}/regional-s3-assets"
source_dir="${template_dir}/../source"

echo "------------------------------------------------------------------------------"
echo "Rebuild distribution"
echo "------------------------------------------------------------------------------"
rm -rf ${template_dist_dir}
mkdir -p ${template_dist_dir}
rm -rf ${build_dist_dir}
mkdir -p ${build_dist_dir}

echo "--------------------------------------------------------------------------------------"
echo "CloudFormation Template generation - for main solution stack and regional deployments"
echo "--------------------------------------------------------------------------------------"
export CODE_BUCKET=$1
export SOLUTION_NAME=$2
export CODE_VERSION=$3
export PUBLIC_ECR_REGISTRY=${PUBLIC_ECR_REGISTRY}
export PUBLIC_ECR_TAG=${PUBLIC_ECR_TAG}

# Change these 
main_cfn_template=${SOLUTION_NAME}
regional_cfn_template=${main_cfn_template}-regional

declare -A templates=(
  [${main_cfn_template}]=${template_dist_dir}
  [${regional_cfn_template}]=${build_dist_dir}
)

cd ${source_dir}/infrastructure
npm run clean
npm install

for template in "${!templates[@]}"; do
  node_modules/aws-cdk/bin/cdk synth --asset-metadata false --path-metadata false -a "npx ts-node --prefer-ts-exts bin/${template}.ts" > ${templates[$template]}/${template}.template
  if [ $? -eq 0 ]
  then
    echo "Build for ${template} succeeded"
  else
    echo "******************************************************************************"
    echo "Build FAILED for ${template}"
    echo "******************************************************************************"
    exit 1
  fi
done

# Setup solution utils package
cd ${source_dir}/solution-utils
rm -rf node_modules 
npm install --production
rm -rf package-lock.json

# Creating custom resource resources for both stacks
main_stack_custom_resource_files="index.js node_modules lib/*"
regional_stack_custom_resource_files="index.js node_modules lib/cfn lib/metrics lib/config-storage lib/iot"

declare -a stacks=(
  "main"
  "regional"
)

cd ${source_dir}/custom-resource
rm -rf node_modules/
npm install --production
rm package-lock.json
for stack in "${stacks[@]}"; do
  cp ${stack}-index.js index.js
  files_to_zip=${stack}_stack_custom_resource_files
  zip -q -r ${build_dist_dir}/${stack}-custom-resource.zip ${!files_to_zip}
  rm index.js
  if [ $? -eq 0 ]
  then
    echo "Build for ${stack}-custom-resource.zip succeeded"
  else
    echo "******************************************************************************"
    echo "Build FAILED for ${stack}-custom-resource.zip"
    echo "******************************************************************************"
    exit 1
  fi
done

# Create lambda packages
declare -a packages=(
    "api-services"
    "results-parser"
    "task-canceler"
    "task-runner"
    "task-status-checker"
    "real-time-data-publisher"
)

for package in "${packages[@]}"; do
  echo "------------------------------------------------------------------------------"
  echo "Creating $package deployment package"
  echo "------------------------------------------------------------------------------"
  cd ${source_dir}/${package}
  rm -rf node_modules/
  npm install --production
  rm package-lock.json
  zip -q -r9 ${build_dist_dir}/${package}.zip *
  if [ $? -eq 0 ]
  then
    echo "Build for ${package} succeeded"
  else
    echo "******************************************************************************"
    echo "Build FAILED for ${package}"
    echo "******************************************************************************"
    exit 1
  fi
done

echo "------------------------------------------------------------------------------"
echo "Creating container deployment package"
echo "------------------------------------------------------------------------------"
cd ${template_dir}/ecr/distributed-load-testing-on-aws-load-tester
# Downloading jetty 9.4.34.v20201102
curl -O https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-alpn-client/9.4.34.v20201102/jetty-alpn-client-9.4.34.v20201102.jar
curl -O https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-alpn-openjdk8-client/9.4.34.v20201102/jetty-alpn-openjdk8-client-9.4.34.v20201102.jar
curl -O https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-client/9.4.34.v20201102/jetty-client-9.4.34.v20201102.jar
curl -O https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-http/9.4.34.v20201102/jetty-http-9.4.34.v20201102.jar
curl -O https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-io/9.4.34.v20201102/jetty-io-9.4.34.v20201102.jar
curl -O https://repo1.maven.org/maven2/org/eclipse/jetty/jetty-util/9.4.34.v20201102/jetty-util-9.4.34.v20201102.jar

echo "------------------------------------------------------------------------------"
echo "Building console"
echo "------------------------------------------------------------------------------"
cd ${source_dir}/console
[ -e build ] && rm -r build
[ -e node_modules ] && rm -rf node_modules
npm install
npm run build
mkdir ${build_dist_dir}/console
cp -r ./build/* ${build_dist_dir}/console/

echo "------------------------------------------------------------------------------"
echo "Generate console manifest file"
echo "------------------------------------------------------------------------------"
cd ${build_dist_dir}/console
manifest=(`find * -type f ! -iname ".DS_Store"`)
manifest_json=$(IFS=,;printf "%s" "${manifest[*]}")
echo "[\"${manifest_json}\"]" | sed 's/,/","/g' > ./console-manifest.json

echo "------------------------------------------------------------------------------"
echo "Build S3 Packaging Complete"
echo "------------------------------------------------------------------------------"