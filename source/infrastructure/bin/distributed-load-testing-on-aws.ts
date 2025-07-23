// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { DLTStack } from "../lib/distributed-load-testing-on-aws-stack";
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
const mainStackDescription = `(${solutionId}) - ${solutionName}. Version ${solutionVersion}`;
const regionsStackDescription = `(${solutionId}-regional) - Distributed Load Testing on AWS testing resources regional deployment. Version ${solutionVersion}`;

const solution = new Solution(solutionId, solutionName, solutionVersion, mainStackDescription);

// main stack
new DLTStack(app, "distributed-load-testing-on-aws", {
  synthesizer,
  solution,
  stackType: "main",
});

// regional stack
solution.description = regionsStackDescription;
new RegionalInfrastructureDLTStack(app, "distributed-load-testing-on-aws-regional", {
  synthesizer,
  solution,
  stackType: "regional",
});
