# Guide to deploying Distributed Load Testing on AWS (DLT) using cdk

To support custom deployments of DLT, solution's IaC is developed with AWS CDK.

#### Pre-requisites
Following instructions for `cdk deploy` require docker engine running
Make sure to run the docker login command for public.aws.ecr/v2
`aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws/v2`

#### Deploy primary stack
Time to deploy: ~ 10 minutes

```shell
# install dependencies
npm ci
npm run install:all

# bootstrap cdk environment
npx cdk bootstrap --profile {myProfile}

# deploy stack
npx cdk deploy DLTStack --profile {myProfile} --parameters AdminName={myAdmin} --parameters AdminEmail={myEmail}
```
- myProfile - aws profile with required permissions to deploy in your account
- myAdmin - username to login to DLT web portal
- myEmail - email address to receive temporary login credentials

#### Deploy ALB + ECS stack (alternative to CloudFront)

For regions where CloudFront is not available or for organizations that require a secure network deployment, use the ALB + ECS stack variant. This stack hosts the web console behind an Application Load Balancer with ECS Fargate instead of CloudFront + S3.

```shell
npx cdk deploy distributed-load-testing-on-aws-alb-ecs --profile {myProfile} \
  --parameters AdminName={myAdmin} \
  --parameters AdminEmail={myEmail} \
  --parameters ConsoleDomainName={myDomain} \
  --parameters ACMCertificateArn={myCertArn}
```
- myDomain - custom domain name for the web console (e.g., dlt.example.com), must match the ACM certificate
- myCertArn - ARN of an ACM certificate in the same region for HTTPS

By default, the ALB stack deploys an AWS WAF WebACL with AWS managed rule groups (CommonRuleSet, AmazonIpReputationList, AnonymousIpList) to protect the load balancer. To skip WAF deployment, add `--parameters DeployWAF=No`.

#### Deploy headless stack (no web console hosting)

For organizations that want to host the web console on their own infrastructure or integrate with existing web platforms. The backend services (API, Lambda, DynamoDB, Step Functions) are deployed normally. The web console assets are packaged as a ZIP file in an S3 bucket for download and self-hosting.

```shell
npx cdk deploy distributed-load-testing-on-aws-headless --profile {myProfile} \
  --parameters AdminName={myAdmin} \
  --parameters AdminEmail={myEmail}
```

The stack outputs include a ConsoleAssetsBucket URL where you can download the web console ZIP package.

#### Deploy regional stack
Time to deploy: ~ 5 minutes

```shell
# bootstrap cdk environment
AWS_REGION={myRegion} npx cdk bootstrap --profile {myProfile}

AWS_REGION={myRegion} npx cdk deploy RegionalDLTStack --profile {myProfile} --parameters ScenariosBucket={myBucket} \
--parameters ScenariosTable={myTable} --parameters PrimaryStackRegion={myPrimaryRegion}
```
- myRegion - aws region for deploying regional DLT stack, to perform load test from that region
- myBucket - s3 bucket from primary stack output
- myTable - dynamodb table from primary stack output
- myPrimaryRegion - region of deployment for primary stack

_Note: AWS_REGION={myRegion} can be prepended to `cdk deploy` to change region of deployment_
