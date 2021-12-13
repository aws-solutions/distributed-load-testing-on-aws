# Distributed Load Testing on AWS

The Distributed Load Testing Solution leverages managed, highly available and highly scalable AWS services to effortlessly create and simulate thousands of connected users generating a selected amount of transactions per second. As a result, developers can understand the behavior of their applications at scale and at load to identify any bottleneck problems before they deploy to Production.

## On this Page

- [Architecture Overview](#architecture-overview)
- [Deployment](#deployment)
- [Source Code](#source-code)
- [Creating a custom build](#creating-a-custom-build)

## Architecture Overview

![Architecture](architecture.png)

## Deployment

The solution is deployed using a CloudFormation template with a lambda backed custom resource. For details on deploying the solution please see the details on the solution home page: [Distributed Load Testing](https://aws.amazon.com/solutions/implementations/distributed-load-testing-on-aws/)

## Source Code

**source/api-services**<br/>
A NodeJS Lambda function for the API microservices. Integrated with Amazon API Gateway, used to manage test scenarios.

**source/console**<br/>
ReactJS Single page application to provide a GUI to the solutions. Authenticated through Amazon Cognito this dashboard allows users to Create tests and view the final results.

**source/custom-resource**<br/>
A NodeJS Lambda function used as a CloudFormation custom resource for configuring Amazon S3 bucket notifications and to send anonymous metrics.

**source/results-parser**<br/>
A NodeJS Lambda function used to write the xml output from the docker images to Amazon DynamoDB and generate the final results for each test.

**source/task-canceler**<br/>
A NodeJS Lambda function used to stop tasks for a test that has been cancelled.

**source/task-runner**<br/>
A NodeJS Lambda function that runs the Amazon ECS task definition for each test.

**source/task-status-checker**<br/>
A NodeJS Lambda function that checks if the Amazon ECS tasks are running or not.

## Creating a custom build

The solution can be deployed through the CloudFormation template available on the solution home page: [Distributed Load Testing](https://aws.amazon.com/solutions/implementations/distributed-load-testing-on-aws/).

To make changes to the solution, download or clone this repository, update the source code and then run the deployment/build-s3-dist.sh script to deploy the updated Lambda code to an Amazon S3 bucket in your account.

### Prerequisites

* Node.js 14.x or later

### Running unit tests for customization

* Clone the repository and make the desired code changes.

```bash
git clone https://github.com/aws-solutions/distributed-load-testing-on-aws.git
cd distributed-load-testing-on-aws
export BASE_DIRECTORY=$PWD
```

* Run unit tests to make sure the updates pass the tests.

```bash
cd $BASE_DIRECTORY/deployment
chmod +x ./run-unit-tests.sh
./run-unit-tests.sh
```

### Building distributable for customization

* Configure the environment variables.

```bash
export DIST_BUCKET_PREFIX=my-bucket-name # bucket where customized code will reside
export SOLUTION_NAME=my-solution-name
export VERSION=my-version # version number for the customized code
export REGION=aws-region-code # the AWS region to launch the solution (e.g. us-east-1)
export PUBLIC_ECR_REGISTRY=public.ecr.aws/awssolutions/distributed-load-testing-on-aws-load-tester # replace with the container registry and image if you want to use a different container image
export PUBLIC_ECR_TAG=v2.0 # replace with the container image tag if you want to use a different container image
```

> **Note:** When you define `DIST_BUCKET_PREFIX`, a randomized value is recommended. You will need to create an S3 bucket where the name is `<DIST_BUCKET_PREFIX>-<REGION>`. The solution's CloudFormation template will expect the source code to be located in a bucket matching that name.

* Build the distributable.

```bash
cd $BASE_DIRECTORY/deployment
chmod +x ./build-s3-dist.sh
./build-s3-dist.sh $DIST_BUCKET_PREFIX $SOLUTION_NAME $VERSION
```

> **Note**: The _build-s3-dist_ script expects the bucket name as one of its parameters, and this value should not include the region suffix. In addition to that, the version parameter will be used to tag the npm packages, and therefore should be in the [Semantic Versioning format](https://semver.org/spec/v2.0.0.html).

* Deploy the distributable to the Amazon S3 bucket in your account.

  * Make sure you are uploading the distributable to the `<DIST_BUCKET_PREFIX>-<REGION>` bucket.
  * Get the link of the solution template uploaded to your Amazon S3 bucket.

* Deploy the solution to your account by launching a new AWS CloudFormation stack using the link of the solution template in Amazon S3.

## Creating a custom container build

This solution uses a public Amazon Elastic Container Registry (Amazon ECR) image repository managed by AWS to store the solution container image that is used to run the configured tests. If you want to customize the container image, you can rebuild and push the image into an ECR image repository in your own AWS account.
For details on how to customize the container image, please see the **Container image customization** section of the [implementation guide](https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/container-image.html).

## Collection of operational metrics

This solution collects anonymous operational metrics to help AWS improve the quality and features of the solution. For more information, including how to disable this capability, please see the [implementation guide](https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/operational-metrics.html).
***

Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.<br />
SPDX-License-Identifier: Apache-2.0