# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.8] - 2024-04-15

### Updated

- Updated webpack-dev-middleware from 5.3.3 to 5.3.4 to resolve security vulnerability [CVE-2024-29180]
- Updated express from 4.18.1 to 4.19.2 to resolve security vulnerability [CVE-2024-29041]
- Updated follow-redirects from 1.15.4 to 1.15.6 to resolve security vulnerability [CVE-2024-28849]
- Updated docker image to resolve security vulnerabilities

### Fixed

- Fixed issues pertaining to [https://github.com/aws-solutions/distributed-load-testing-on-aws/issues/170] 
- Fixed issues pertaining the update stack problem from versions before DLT v3.2.6 to DLT versions after 3.2.6 

## [3.2.7] - 2024-03-11

### Fixed

- Fixed CHANGELOG for v3.2.6

### Added

- Added package-lock.json

## [3.2.6] - 2024-03-06

### Changed

- Updated version of taurus from v1.16.27 to v1.16.29
- Updated version of chart.js from v3.9.1 to v4.1.1
- Updated version of react from v17.0.2 to v18.2.0
- Updated version of react-dom from v17.0.2 to v18.2.0
- Updated version of aws-amplify from v4.3.31 to v6.0.17
- Updated version of @aws-amplify/pubsub from v4.4.10 to v6.0.17
- Updated version of @aws-amplify/ui-react from v1.2.26 to v6.1.4
- Removed moment.js as the library was in maintenance mode. Replaced with javascript built-in date objects
- Updated Jmeter dependencies and taurus dependencis within the docker image to enhance the security of the docker image

### Fixed

- Bug fix to resolve issue with graph not showing on scheduled tests [#158](https://github.com/aws-solutions/distributed-load-testing-on-aws/issues/158)
- Bug fix created by changes of the ECS account setting and enabling Tag Resource Authorization as default settings [#162](https://github.com/aws-solutions/distributed-load-testing-on-aws/issues/162)
- Bug fix to resolve issue with running the tests on OPT-IN regions [#163](https://github.com/aws-solutions/distributed-load-testing-on-aws/issues/163)

## [3.2.5] - 2024-01-11

### Changed

- Updated version of taurus image to 1.16.27
- Updated Jmeter dependencies and taurus dependencis within the docker image to enhance the security of the docker image
- Updated version of "@aws-solutions-constructs/aws-cloudfront-s3" from 2.46.0 to 2.48.0
- Updated version of "@aws-cdk/aws-servicecatalogappregistry-alpha" from 2.108.0-alpha.0 to 2.121.1-alpha.0

### Fixed

- Bug fix to resolve issues with automatic plugins installation [#152](https://github.com/aws-solutions/distributed-load-testing-on-aws/issues/152)

## [3.2.4] - 2023-11-10

### Changed

- Updating lambda runtimes to use node-18
- Updated version of taurus image to 1.16.26
- Updated Jmeter dependencies and taurus dependencis within the docker image to enhance the security of the docker image

### Fixed

- Bug fix to resolve issues with our recurring schedulers [#141](https://github.com/aws-solutions/distributed-load-testing-on-aws/issues/141)
- Bug fix to resolve issues with deploying to distant regions as additional regions to the main region [#138](https://github.com/aws-solutions/distributed-load-testing-on-aws/issues/138)

## [3.2.3] - 2023-10-05

### Fixed

- Bug fix to resolve Multipart upload for files bigger than 5MB
- Bug fix to show success codes other than 200
- Bug fix to reoslve [#131](https://github.com/aws-solutions/distributed-load-testing-on-aws/issues/131)
- Updating CDK libraries to latest version to allow deployment in some form in Israel Region
- Fixing Security Hotspots and resolving codesmells
- Updating the Docker Image to the latest version

## [3.2.2] - 2023-06-29

### Fixed

- Bug fix to resolve issue with Start button on Details page
- Bug fix to resolve issue with Sign Out button not working
- Updated to react-scripts "5.0.1"
- Removed @aws-amplify/ui-componenet as it was deprecated

## [3.2.1] - 2023-04-17

### Fixed

- Add ownership parameter to S3 logging bucket to account for [changes in S3 default behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-faq.html).

## [3.2.0] - 2023-03-09

### Added

- Task limits based on on-demand vCPU quotas for the account along with currently running Fargate tasks.
  - Table to the console when creating a test to visualize available Fargate quotas.
- Auto-refresh functionality
- eslint and prettier formatting

### Fixed

- Bug fix for [#115](https://github.com/aws-solutions/distributed-load-testing-on-aws/issues/115) where Step Functions hits a task execution limit.
- Bug fix for [#115](https://github.com/aws-solutions/distributed-load-testing-on-aws/issues/115) where test does not cancel properly.
- CloudWatch Dashboards link in console
- Deletion of CloudWatch Dashboards on test deletion

### Security

- Updated to bootstrap 5
- Updated to blazemeter/taurus version 1.16.9

## [3.1.1] - 2022-11-18

### Fixed

- Bug fix for [#111](https://github.com/aws-solutions/distributed-load-testing-on-aws/issues/111) where a CloudFormation bug would occasionally cause deployments to fail.

## [3.1.0] - 2022-11-10

### Added

- Added AppRegistryAWS Service Catalog AppRegistry support for all deployments of the solution.
  - Due to current limitations of AppRegistry, a separate instance of AppRegistry is launched for each region that this solution is deployed to.

## [3.0.0] - 2022-08-24

⚠ BREAKING CHANGES
Version 3.0.0 does not support upgrading from previous versions.

### Added

- Merge [#71](https://github.com/aws-solutions/distributed-load-testing-on-aws/pull/71) by [@pyranja](https://github.com/pyranja)
- Multi-region load test support
  - Template for secondary regions
  - Menu option for region management
  - Region selection in test creation
  - Results viewable by region
- Real time data on UI for running tests
- Upload bzt log, as well as jmeter log, out, and err logs to S3
- Link to S3 test results in the test details
- Logging for failed tasks

### Changed

- History moved to separate table
- History view moved to modal rather than separate link
- Updated to CDK V2

### Fixed

- Bug fix for long running containers by adding timeout to sockets
- Bug fix port issues by handing SIGTERM properly
- Bug fix for graceful failure when leader task fails
- Bug fix for tasks which launched but failed to provision

### Removed

- Sleep between runTask API calls

## [2.0.2] - 2022-03-31

### Added

- Enabled encryption in transit for the logging S3 bucket.

## [2.0.1] - 2021-12-13

Version 2.0.1 supports upgrading from version 2.0.0 but not from version 1.3.0 and below

> **Note**: When upgrading from version 2.0.0 to 2.0.1, make sure to clear CloudFront and browser cache to avoid image issues.

### Changed

- Updated AWS SDK version in development dependencies for AWS Lambda functions
- Bug fix to resolve issue with displaying a large number of tests
- Bug fix for error _finalResults function error ValidationException: Item size to update has exceeded the maximum allowed size_
- Merge [#64](https://github.com/aws-solutions/distributed-load-testing-on-aws/pull/64) from [@rmdashrfslash](https://github.com/rmdashrfslash)

## [2.0.0] - 2021-09-30

⚠ BREAKING CHANGES
Version 2.0.0 does not support upgrading from previous versions.

### Added

- Support to view complete data from previous test runs, including test configuration, test data, and Amazon CloudWatch dashboards
  - Results History now has a `View details` link to display data from previous test runs
- Support for an existing Amazon VPC
- Launch Fargate tasks in multiple availability zones
- Using AWS CDK source code to generate the AWS CloudFormation template

### Changed

- Results History displays:
  - Run Time
  - Task Count
  - Concurrency
  - Average Response Time
  - Success %
- Tags created in CloudFormation propagated to Fargate test tasks
- Test ids only contain alphanumeric characters

### Removed

- Remove AWS CodePipeline, AWS CodeBuild, and Amazon ECR image repository resource creation by AWS CloudFormation stack
  - The solution's container image is stored in a public ECR image repository managed by AWS
- Remove `ECRChecker` lambda function and state machine stage

## [1.3.0] - 2021-04-30

### Added

- Support for up to 1000 tasks
  - Added TaskCanceler lambda to cancel tasks
  - Added steps in step function to support launching 1000 tasks
  - Added StartedBy tag to tasks for use by task listing functions
  - Modified all ECS task listing functions to support listing 1000 tasks
  - Modified TaskRunning lambda function to support being called multiple times from step functions
- Tests start simultaneously
  - Added ecscontroller.py to container package
  - Added ecslistener.py to container package
  - TaskRunner lambda launches worker tasks first, then leader task once workers are running
- Run tests concurrently
  - Removed disabling of submit buttons if there is a test running
  - Unbuffered bzt output and added test Id to CloudWatch logs for access to test specific logs
- Added support for Docker Hub login
  - Added Secrets manager parameter to include secret containing Docker Hub credentials
- Included more metrics
  - Added virtual users, failures, and successes to graph
  - Added individual CloudWatch dashboards and widget for each metric for real time results
- Added support for scheduling tests
  - Added scheduling options to form
  - Added scheduled CloudWatch rules to start tests on schedule
- Added next run and recurrence to dashboard page in UI
- Added recurrence to details page in UI
- Added SolutionId and TestId tag to Fargate tasks and SolutionId tag to API Gateway

### Changed

- Merge [#50](https://github.com/aws-solutions/distributed-load-testing-on-aws/pull/50/) by [@naxxster](https://github.com/naxxster)
- Increased Task Count limits
- Changed ETA for running tasks to be dynamic based on number of tasks
- Increased task cpu and memory to handle increased cpu load
- Package versions
- Improved unit tests
- UI changes
  - Changed update button to edit in details page
  - Changed submit button to "Run Now" or "Schedule" in create page
  - Changed details URL to include test id
  - Changed concurrency message to provide guidelines to determine max concurrency

### Removed

- Concurrency Limits
- Removed aggregated CloudWatch dashboard and metric

## [1.2.0] - 2020-12-17

### Added

- JMeter input file support and plugins support
  - JMeter input files should be zipped with the JMeter script file.
  - Add `jetty-*.jar` files to the Amazon ECR to support JMeter HTTP/2 plugin:
    - <https://github.com/Blazemeter/jmeter-http2-plugin>
    - <https://stackoverflow.com/questions/62714281/http-2-request-with-jmeter-fails-with-nullsession-jetty-alpn>
    - <https://webtide.com/jetty-alpn-java-8u252/>
    - See the latest `jetty-*.jar` files in the [Maven repository](https://mvnrepository.com/):
      - [jetty-alpn-client](https://mvnrepository.com/artifact/org.eclipse.jetty/jetty-alpn-client)
      - [jetty-alpn-openjdk8-client](https://mvnrepository.com/artifact/org.eclipse.jetty/jetty-alpn-openjdk8-client)
      - [jetty-client](https://mvnrepository.com/artifact/org.eclipse.jetty/jetty-client)
      - [jetty-http](https://mvnrepository.com/artifact/org.eclipse.jetty/jetty-http)
      - [jetty-io](https://mvnrepository.com/artifact/org.eclipse.jetty/jetty-io)
      - [jetty-util](https://mvnrepository.com/artifact/org.eclipse.jetty/jetty-util)
- UI Detail page
  - Sub test results by labels
  - Requests per second
  - Complete task counts
- Check if Amazon ECR is ready before running the test
- More error handlings in AWS Step Functions
  - If any error happens in any steps, the Lambda function updates the test status to `FAILED`.
  - If any AWS Fargate tasks are possibly hanged forever, the `task-status-checker` Lambda function stops the tasks.
  - When there is no result in the S3 bucket, it regards the result as `FAILED`.

### Changed

- Use `Promise.all()` in `results-parser` to improve the performance
- Correct average bandwidth on the Detail page
- Packages version
- Fix occasional wrong test duration time on the report
- Dashboard order by `Last Run (UTC)`
- Maximum upload file size to 50MB to support JMeter input files

## [1.1.0] - 2020-09-30

### Added

- JMeter support with `jmx` script: [#3](https://github.com/aws-solutions/distributed-load-testing-on-aws/issues/3)
- Add `START` button on details page
- Add `CANCEL` button on create page
- Add AWS Step Functions to run tasks and update result instead of Amazon DynamoDB and Amazon SQS
- Add `BucketEncryption` for `ConsoleBucket`
- Add API Gateway logging

### Changed

- Merge [#15](https://github.com/aws-solutions/distributed-load-testing-on-aws/pull/15/) by [@afittz](https://github.com/afittz)
- Merge [#16](https://github.com/aws-solutions/distributed-load-testing-on-aws/pull/16/) by [@Patrick-56Bit](https://github.com/Patrick-56Bit)
- Change `LAST RAN` to `STARTED AT` and add `ENDED AT` information when test is completed
- Change CodeBuild image to `aws/codebuild/standard:4.0`
- Update Node.js version from 10.x to 12.x
- All Amazon S3 buckets do not allow public access.

### Removed

- Amazon SQS queue
- Amazon DynamoDB Results table

## [1.0.0] - 2019-11-14

### Added

- CHANGELOG version 1.0.0 release
