#!/bin/bash

SELFPATH="$(dirname "$(realpath "$0")")"
BASEPATH="$(realpath "$SELFPATH/..")"
BUILDPATH="$(realpath "$BASEPATH/deployment")"


export DIST_BUCKET_PREFIX=pulse-alp-custom-aws-dlt # bucket where customized code will reside
export SOLUTION_NAME=pulse-alp-dlt
export VERSION=v1.0 # version number for the customized code
export REGION=us-east-1 # the AWS region to launch the solution (e.g. us-east-1)
export PUBLIC_ECR_REGISTRY=public.ecr.aws/c4a5t4n3/pulse-alp-custom-aws-dlt
export PUBLIC_ECR_TAG=v1.0 # replace with the container image tag if you want to use a different container image


# Build lambdas and step functions
cd $BUILDPATH
chmod +x ./build-s3-dist.sh
./build-s3-dist.sh $DIST_BUCKET_PREFIX $SOLUTION_NAME $VERSION

# Build ECS container
cd $BUILDPATH/ecr/distributed-load-testing-on-aws-load-tester
REPO_URL=${PUBLIC_ECR_REGISTRY%/*}
DOCKER_TAG=${PUBLIC_ECR_REGISTRY##*/}
docker build -t $DOCKER_TAG:$PUBLIC_ECR_TAG .

# Deploy lambda and step function code to s3
cd $BUILDPATH/regional-s3-assets
aws s3 cp --recursive . s3://$DIST_BUCKET_PREFIX-$REGION/$SOLUTION_NAME/$VERSION
cd $BUILDPATH/global-s3-assets
aws s3 cp --recursive . s3://$DIST_BUCKET_PREFIX/$SOLUTION_NAME/$VERSION
aws s3 cp --recursive . s3://$DIST_BUCKET_PREFIX/$SOLUTION_NAME/latest

# Deploy ECS container to ECR
aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin $REPO_URL
docker tag $DOCKER_TAG:$PUBLIC_ECR_TAG $PUBLIC_ECR_REGISTRY:$PUBLIC_ECR_TAG
docker push $PUBLIC_ECR_REGISTRY:$PUBLIC_ECR_TAG