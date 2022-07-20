#!/bin/bash

SELFPATH="$(dirname "$(realpath "$0")")"
BASEPATH="$(realpath "$SELFPATH/..")"
BUILDPATH="$(realpath "$BASEPATH/deployment")"


export DIST_BUCKET_PREFIX=pulse-alp-custom-aws-dlt # bucket where customized code will reside
export SOLUTION_NAME=pulse-alp-dlt
export VERSION=v1.0 # version number for the customized code
export REGION=us-east-1 # the AWS region to launch the solution (e.g. us-east-1)
export PUBLIC_ECR_REGISTRY=042551056984.dkr.ecr.us-east-1.amazonaws.com/pulse-alp-custom-aws-dlt
export PUBLIC_ECR_TAG=v1.0 # replace with the container image tag if you want to use a different container image


cd $BUILDPATH
chmod +x ./build-s3-dist.sh
./build-s3-dist.sh $DIST_BUCKET_PREFIX $SOLUTION_NAME $VERSION
