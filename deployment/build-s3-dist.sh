#!/bin/bash
#
# This assumes all of the OS-level configuration has been completed and git repo has already been cloned
#
# This script should be run from the repo's deployment directory
# cd deployment
# ./build-s3-dist.sh source-bucket-base-name trademarked-solution-name version-code
#
# Paramenters:
#  - source-bucket-base-name: Name for the S3 bucket location where the template will source the Lambda
#    code from. The template will append '-[region_name]' to this bucket name.
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
template_dist_dir="$template_dir/global-s3-assets"
build_dist_dir="$template_dir/regional-s3-assets"
source_dir="$template_dir/../source"

echo "------------------------------------------------------------------------------"
echo "Rebuild distribution"
echo "------------------------------------------------------------------------------"
rm -rf $template_dist_dir
mkdir -p $template_dist_dir
rm -rf $build_dist_dir
mkdir -p $build_dist_dir

[ -e $template_dist_dir ] && rm -r $template_dist_dir
[ -e $build_dist_dir ] && rm -r $build_dist_dir
mkdir -p $template_dist_dir $build_dist_dir

echo "------------------------------------------------------------------------------"
echo "CloudFormation Template"
echo "------------------------------------------------------------------------------"
cp $template_dir/distributed-load-testing-on-aws.yaml $template_dist_dir/distributed-load-testing-on-aws.template

replace="s/CODE_BUCKET/$1/g"
echo "sed -i -e $replace"
sed -i -e $replace $template_dist_dir/distributed-load-testing-on-aws.template
replace="s/SOLUTION_NAME/$2/g"
echo "sed -i -e $replace"
sed -i -e $replace $template_dist_dir/distributed-load-testing-on-aws.template
replace="s/CODE_VERSION/$3/g"
echo "sed -i -e $replace"
sed -i -e $replace $template_dist_dir/distributed-load-testing-on-aws.template
# remove tmp file for MACs
[ -e $template_dist_dir/distributed-load-testing-on-aws.template-e ] && rm -r $template_dist_dir/distributed-load-testing-on-aws.template-e

cd $source_dir
echo "------------------------------------------------------------------------------"
echo "Creating custom-resource deployment package"
echo "------------------------------------------------------------------------------"
cd custom-resource/
rm -rf node_modules/
npm install --production
rm package-lock.json
zip -q -r9 ../../deployment/regional-s3-assets/custom-resource.zip *

echo "------------------------------------------------------------------------------"
echo "Creating api-services deployment package"
echo "------------------------------------------------------------------------------"
cd ../api-services
rm -rf node_modules/
npm install --production
rm package-lock.json
zip -q -r9 $build_dist_dir/api-services.zip *

echo "------------------------------------------------------------------------------"
echo "Creating results-parser deployment package"
echo "------------------------------------------------------------------------------"
cd ../results-parser
rm -rf node_modules/
npm install --production
rm package-lock.json
zip -q -r9 $build_dist_dir/results-parser.zip *

echo "------------------------------------------------------------------------------"
echo "Creating task-runner deployment package"
echo "------------------------------------------------------------------------------"
cd ../task-runner
rm -rf node_modules/
npm install --production
rm package-lock.json
zip -q -r9 $build_dist_dir/task-runner.zip *

echo "------------------------------------------------------------------------------"
echo "Creating container deployment package"
echo "------------------------------------------------------------------------------"
cd ../container
zip -q -r9 ../../deployment/regional-s3-assets/container.zip *
cp container-manifest.json $build_dist_dir/

echo "------------------------------------------------------------------------------"
echo "Building console"
echo "------------------------------------------------------------------------------"
cd ../console
[ -e build ] && rm -r build
[ -e node_modules ] && rm -rf node_modules
npm install
touch public/aws_config.js
npm run build
mkdir $build_dist_dir/console
cp -r ./build/* $build_dist_dir/console/

echo "------------------------------------------------------------------------------"
echo "Generate console manifest file"
echo "------------------------------------------------------------------------------"
cd $build_dist_dir
manifest=(`find console -type f | sed 's|^./||'`)
manifest_json=$(IFS=,;printf "%s" "${manifest[*]}")
echo "[\"$manifest_json\"]" | sed 's/,/","/g' > ./console-manifest.json

echo "------------------------------------------------------------------------------"
echo "Build S3 Packaging Complete"
echo "------------------------------------------------------------------------------"
