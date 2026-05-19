#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { DLTStack } from "../lib/distributed-load-testing-on-aws-stack";
import { DLTAlbEcsStack } from "../lib/distributed-load-testing-on-aws-alb-ecs-stack";
import { DLTHeadlessStack } from "../lib/distributed-load-testing-on-aws-headless-stack";
import { Solution } from "./solution";
import { RegionalInfrastructureDLTStack } from "../lib/distributed-load-testing-on-aws-regional-stack";

// CDK and default deployment
let synthesizer = new DefaultStackSynthesizer({ generateBootstrapVersionRule: false });

// Solutions pipeline deployment
const { DIST_OUTPUT_BUCKET, SOLUTION_ID, SOLUTION_NAME, VERSION, PUBLIC_ECR_REGISTRY, PUBLIC_ECR_TAG } = process.env;
if (DIST_OUTPUT_BUCKET && SOLUTION_NAME && VERSION && PUBLIC_ECR_REGISTRY && PUBLIC_ECR_TAG)
  synthesizer = new DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
    fileAssetsBucketName: `${DIST_OUTPUT_BUCKET}-\${AWS::Region}`,
    bucketPrefix: `${SOLUTION_NAME}/${VERSION}/`,
    imageAssetsRepositoryName: PUBLIC_ECR_REGISTRY,
    dockerTagPrefix: PUBLIC_ECR_TAG,
  });

const app = new App();
const solutionName = app.node.tryGetContext("solutionName");
const solutionVersion = VERSION ?? app.node.tryGetContext("solutionVersion");
const solutionId = SOLUTION_ID ?? app.node.tryGetContext("solutionId");
const mainStackDescription = `(${solutionId}) - Distributed Load Testing on AWS. Fargate-based load testing with JMeter, K6, and Locust. CloudFront web console. Version ${solutionVersion}`;
const albEcsStackDescription = `(${solutionId}-alb-ecs) - Distributed Load Testing on AWS. Fargate-based load testing with JMeter, K6, and Locust. ALB/ECS web console. Version ${solutionVersion}`;
const headlessStackDescription = `(${solutionId}-headless) - Distributed Load Testing on AWS. Fargate-based load testing with JMeter, K6, and Locust. API-only, no web console. Version ${solutionVersion}`;
const regionsStackDescription = `(${solutionId}-regional) - Distributed Load Testing on AWS resources for running load tests in additional AWS Regions. Version ${solutionVersion}`;

const solution = new Solution(solutionId, solutionName, solutionVersion, mainStackDescription);

// main stack - CloudFront console (default)
new DLTStack(app, "distributed-load-testing-on-aws", {
  synthesizer,
  solution,
  stackType: "main",
  solutionTemplate: "cloudfront",
});

// ALB + ECS console stack
solution.description = albEcsStackDescription;
new DLTAlbEcsStack(app, "distributed-load-testing-on-aws-alb-ecs", {
  synthesizer,
  solution,
  stackType: "main",
  solutionTemplate: "alb-ecs",
});

// Headless stack (no web console hosting)
solution.description = headlessStackDescription;
new DLTHeadlessStack(app, "distributed-load-testing-on-aws-headless", {
  synthesizer,
  solution,
  stackType: "main",
  solutionTemplate: "headless",
});

// regional stack
solution.description = regionsStackDescription;
new RegionalInfrastructureDLTStack(app, "distributed-load-testing-on-aws-regional", {
  synthesizer,
  solution,
  stackType: "regional",
});
