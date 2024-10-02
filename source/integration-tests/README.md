# Guide to running integration tests locally against a deployed stack of DLT

For fast iteration of testing changes, the `integration-tests` package supports running integration tests against your
own deployment of DLT in AWS account. To do so, follow the steps:

- [API integration tests](#api-integration-tests)
  - [Pre-requisite for running API tests](#pre-requisite-for-running-api-integration-tests-locally)
    - [Creating permission sets and user](#create-permission-set-and-user-in-aws-iam-identity-center)
    - [Configure SSO profile](#configure-sso-profile)
    - [Setup environment variable](#login-with-sso-and-setup-environment-variables-using-sso-profile)
  - [Execute API tests](#execute-api-tests)
- [Console integration tests](#e2e-tests)
  - [Execute e2e tests](#execute-e2e-tests)

## API integration tests

API integration tests allow you to run integration tests against deployed DLT API endpoints and test API behavior.
The tests use API authenticated with AWS SigV4. There is no browser interaction with API tests.

### Pre-requisite for running API integration tests locally

#### Create Permission set and User in AWS IAM Identity Center

The recommended method to run integration tests in your account is using SSO with IAM Identity Center. To run the tests
you need a user in Identity Center with at-minimum following permission added to the respective permission set.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["execute-api:Invoke"],
      "Resource": "arn:aws:execute-api:*:*:*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:*"],
      "Resource": "arn:aws:execute-api:::{s3ScenarioBucket}"
    }
  ]
}
```

_For creating *permission set* and *user* in IAM Identity Center refer [here](https://docs.aws.amazon.com/singlesignon/latest/userguide/getting-started.html)._

#### Configure SSO profile

Configure the AWS CLI to authenticate users with the AWS IAM Identity Center using named profile. The SSO token provider
configuration can automatically retrieve refreshed authentication tokens.

```shell
aws configure sso
```

_For configuring your profile with SSO refer [here](https://docs.aws.amazon.com/cli/latest/userguide/sso-configure-profile-token.html#sso-configure-profile-token-auto-sso).
You may skip above steps if you already have SSO profile configured in your environment and wish to use the same._

#### Login with SSO and setup environment variables using SSO profile

```shell
aws sso login --profile {mySSOProfile}
eval "$(aws configure export-credentials --profile {mySSOProfile} --format env)"
```

_Replace {mySSOProfile} with the SSO profile configured in prior steps_

### Execute API tests

```shell
cd source/integration-tests
npm ci

# for full test suite
API_URL={myDLTApiURL}
S3_SCENARIO_BUCKET={s3ScenarioBucket}
AWS_REGION={region}
npx jest

# for specific test
API_URL={myDLTApiURL} npx jest --testNamePattern={mySpecificTest}
```

_Replace {myDLTApiURL} with API Url from stack outputs and {mySpecificTest} with test name_

## E2E tests

Console tests or better referred as E2E tests interact with the deployed DLT application, the same way as customers.
Test are authenticated using username, password and all tests run in the browser.

### Execute e2e tests

```shell
cd source/integration-tests
npm ci

USERNAME={myUsername} PASSWORD={myPassword} CONSOLE_URL={myConsoleURL} npx cypress run
```

_Replace {myUsername} {myPassword} {myConsoleURL} with appropriate values. They can also be directly supplied with
[cypress config](./cypress.config.ts)._
