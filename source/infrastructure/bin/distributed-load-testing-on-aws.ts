#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import "source-map-support/register";
import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { DLTStack, DLTStackProps } from "../lib/distributed-load-testing-on-aws-stack";

const getProps = (): DLTStackProps => {
  const { CODE_BUCKET, SOLUTION_NAME, CODE_VERSION, PUBLIC_ECR_REGISTRY, PUBLIC_ECR_TAG } = process.env;
  if (typeof CODE_BUCKET !== "string" || CODE_BUCKET.trim() === "") {
    throw new Error("Missing required environment variable: CODE_BUCKET");
  }

  if (typeof SOLUTION_NAME !== "string" || SOLUTION_NAME.trim() === "") {
    throw new Error("Missing required environment variable: SOLUTION_NAME");
  }

  if (typeof CODE_VERSION !== "string" || CODE_VERSION.trim() === "") {
    throw new Error("Missing required environment variable: CODE_VERSION");
  }

  if (typeof PUBLIC_ECR_REGISTRY !== "string" || PUBLIC_ECR_REGISTRY.trim() === "") {
    throw new Error("Missing required environment variable: PUBLIC_ECR_REGISTRY");
  }

  if (typeof PUBLIC_ECR_TAG !== "string" || PUBLIC_ECR_TAG.trim() === "") {
    throw new Error("Missing required environment variable: PUBLIC_ECR_TAG");
  }

  const codeBucket = CODE_BUCKET;
  const codeVersion = CODE_VERSION;
  const publicECRRegistry = PUBLIC_ECR_REGISTRY;
  const publicECRTag = PUBLIC_ECR_TAG;
  const stackType = "main";
  const solutionId = "SO0062";
  const solutionName = SOLUTION_NAME;
  const description = `(${solutionId}) - Distributed Load Testing on AWS is a reference architecture to perform application load testing at scale. Version ${codeVersion}`;
  const url = "https://metrics.awssolutionsbuilder.com/generic";

  return {
    codeBucket,
    codeVersion,
    description,
    publicECRRegistry,
    publicECRTag,
    stackType,
    solutionId,
    solutionName,
    url,
  };
};

const app = new App();
new DLTStack(app, "DLTStack", {
  synthesizer: new DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
  }),
  ...getProps(),
});
