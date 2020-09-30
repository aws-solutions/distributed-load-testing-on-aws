# Change Log
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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