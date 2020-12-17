# Change Log
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2020-12-17
### Added
- JMeter input file support and plugins support
  - JMeter input files should be zipped with the JMeter script file.
  - Add `jetty-*.jar` files to the Amazon ECR to support JMeter HTTP/2 plugin:
    - https://github.com/Blazemeter/jmeter-http2-plugin
    - https://stackoverflow.com/questions/62714281/http-2-request-with-jmeter-fails-with-nullsession-jetty-alpn
    - https://webtide.com/jetty-alpn-java-8u252/
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
- JMeter support with `jmx` script: [#3](https://github.com/awslabs/distributed-load-testing-on-aws/issues/3)
- Add `START` button on details page
- Add `CANCEL` button on create page
- Add AWS Step Functions to run tasks and update result instead of Amazon DynamoDB and Amazon SQS
- Add `BucketEncryption` for `ConsoleBucket`
- Add API Gateway logging

### Changed
- Merge [#15](https://github.com/awslabs/distributed-load-testing-on-aws/pull/15/) by [@afittz](https://github.com/afittz)
- Merge [#16](https://github.com/awslabs/distributed-load-testing-on-aws/pull/16/) by [@Patrick-56Bit](https://github.com/Patrick-56Bit)
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