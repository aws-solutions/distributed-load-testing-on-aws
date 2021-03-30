# Distributed Load Testing on AWS

The Distributed Load Testing Solution leverages managed, highly available and highly scalable AWS services to effortlessly create and simulate thousands of connected users generating a selected amount of transactions per second. As a result, developers can understand the behavior of their applications at scale and at load to identify any bottleneck problems before they deploy to Production.


## On this Page
- [Architecture Overview](#architecture-overview)
- [Deployment](#deployment)
- [Source Code](#source-code)
- [Creating a custom build](#additional-resources)


## Architecture Overview
![Architecture](architecture.png)

## Deployment
The solution is deployed using a CloudFormation template with a lambda backed custom resource. For details on deploying the solution please see the details on the solution home page: [Distributed Load Testing](https://aws.amazon.com/solutions/implementations/distributed-load-testing-on-aws/)

## Source Code

**source/api-services**<br/>
A NodeJS Lambda function for the API microservices. Integrated with Amazon API Gateway, used to manage test scenarios.

**source/console**<br/>
ReactJS Single page application to provide a GUI to the solutions. Authenticated through Amazon Cognito this dashboard allows users to Create tests and view the final results.

**source/container**<br/>
The Taurus DockerFile and bash script run at start of the test to download the test definition from S3. This is the source file for the image pipeline to build and deploy the Docker image to Amazon ECR. Details on Taurus can be found [here](https://gettaurus.org/).

**source/custom-resource**<br/>
A NodeJS Lambda function used as a CloudFormation custom resource for configuring Amazon S3 bucket notifications and to send anonymous metrics.

**source/ecr-checker**<br/>
A NodeJS Lambda function that checks if the Amazon ECR is ready or not.

**source/results-parser**<br/>
A NodeJS Lambda function used to write the xml output from the docker images to Amazon DynamoDB and generate the final results for each test.

**source/task-runner**<br/>
A NodeJS Lambda function that runs the Amazon ECS task definition for each test.

**source/task-status-checker**<br/>
A NodeJS Lambda function that checks if the Amazon ECS tasks are running or not.

## Creating a custom build
The solution can be deployed through the CloudFormation template available on the solution home page: [Distributed Load Testing](https://aws.amazon.com/solutions/implementations/distributed-load-testing-on-aws/).
To make changes to the solution, download or clone this repo, update the source code and then run the deployment/build-s3-dist.sh script to deploy the updated Lambda code to an Amazon S3 bucket in your account.

### Prerequisites:
* [AWS Command Line Interface](https://aws.amazon.com/cli/)
* Node.js 12.x or later
* Optionally, a Docker Hub account (to alleviate [anonymous access rate limiting](https://www.docker.com/increase-rate-limits))

### 1. Clone the Distributed Load Testing on AWS solution repository
Clone the ```distributed-load-testing-on-aws``` GitHub repositroy, then make the desired code changes.

```bash
git clone https://github.com/awslabs/distributed-load-testing-on-aws.git
```

### 2. Run unit tests
Run unit tests to make sure added customization passes the tests:
```bash
cd ./deployment
chmod +x ./run-unit-tests.sh
./run-unit-tests.sh
```

### 3. Declare environment variables
```bash
export REGION=aws-region-code # the AWS region to launch the solution (e.g. us-east-1)
export DIST_OUTPUT_BUCKET=my-bucket-name # bucket where customized code will reside
export SOLUTION_NAME=my-solution-name
export VERSION=my-version # version number for the customized code
```

### 4. Create an Amazon S3 Bucket
The CloudFormation template is configured to pull the Lambda deployment packages from Amazon S3 bucket in the region the template is being launched in. Create a bucket in the desired region with the region name appended to the name of the bucket. eg: for us-east-1 create a bucket named: ```my-bucket-us-east-1```
```bash
aws s3 mb s3://$DIST_OUTPUT_BUCKET-$REGION --region $REGION
```

### 5. Create the deployment packages
Build the distributable:
```bash
chmod +x ./build-s3-dist.sh
./build-s3-dist.sh $DIST_OUTPUT_BUCKET $SOLUTION_NAME $VERSION
```

> **Notes**: The _build-s3-dist_ script expects the bucket name as one of its parameters, and this value should not include the region suffix. In addition to that, the version parameter will be used to tag the npm packages, and therefore should be in the [Semantic Versioning format](https://semver.org/spec/v2.0.0.html).

### 6. Upload deployment assets to your Amazon S3 bucket
Deploy the distributable to the Amazon S3 bucket in your account:
```bash
aws s3 cp ./regional-s3-assets/ s3://$DIST_OUTPUT_BUCKET-$REGION/$SOLUTION_NAME/$VERSION/ --recursive --acl bucket-owner-full-control
aws s3 cp ./global-s3-assets/ s3://$DIST_OUTPUT_BUCKET-$REGION/$SOLUTION_NAME/$VERSION/ --recursive --acl bucket-owner-full-control
```

### 7. Launch the CloudFormation template.
* Get the link of the `distributed-load-testing-on-aws.template` uploaded to your Amazon S3 bucket.
* _Optionally, the Docker image pipeline can use your own Docker Hub account, instead of authenticating anonymously._
	1. _Create a temporary `dockerhub_creds.json` file containing your Docker Hub credentials:_
		```
		{
			"username": "your_dockerhub_username",
			"password": "your_dockerhub_access_token"
		}
		```
	2. _Create an AWS Secrets Manager secret containing these credentials:_
		```bash
		aws secretsmanager create-secret --name dockerhub --description "for $SOLUTION_NAME $VERSION" --secret-string file://dockerhub_creds.json
        rm dockerhub_creds.json
		```
	3. _Make note of the secret ARN returned in the previous step, and provide it when asked during launch of the CloudFormation stack below._
* Deploy the Distributed Load Testing on AWS solution to your account by launching a new AWS CloudFormation stack using the link of the `distributed-load-testing-on-aws.template`.

***

Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.<br />
SPDX-License-Identifier: Apache-2.0