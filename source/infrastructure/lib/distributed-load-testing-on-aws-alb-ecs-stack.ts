// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CfnOutput, CfnParameter } from "aws-cdk-lib";
import { DLTBaseStack, IDLTConsole } from "./distributed-load-testing-on-aws-base-stack";
import { DLTConsoleAlbEcsConstruct } from "./front-end/console-alb-ecs";

// S3 key for web console assets - shared between stack and construct
const WEB_CONSOLE_ZIP_KEY = "dlt-web-console.zip";

// Allowed pattern for ECR image URIs - exported for use in tests
export const ECR_IMAGE_URI_PATTERN =
  "^$|^\\d{12}\\.dkr\\.ecr\\.[a-z]{2}(-gov)?-(central|north|south|east|west|northeast|southeast|northwest|southwest)-\\d\\.amazonaws\\.com\\/[a-z0-9._\\/-]+(:[a-zA-Z0-9._-]+|@sha256:[a-fA-F0-9]{64})?$";

/**
 * Distributed Load Testing on AWS - ALB + ECS Console Stack
 *
 * Uses Application Load Balancer with ECS Fargate to host the web console.
 *
 * Use cases:
 * - Regions where CloudFront is not available (e.g., AWS GovCloud, China regions)
 * - Organizations that require secure network for compliance
 */
export class DLTAlbEcsStack extends DLTBaseStack {
  protected createConsoleConstruct(): IDLTConsole {
    // Add ALB+ECS specific parameters
    const consoleDomainName = new CfnParameter(this, "ConsoleDomainName", {
      type: "String",
      description: "Custom domain name for the web console (e.g., dlt.example.com). Must match the ACM certificate.",
      allowedPattern: "^[a-zA-Z0-9][a-zA-Z0-9\\-\\.]*[a-zA-Z0-9]$",
      constraintDescription: "Must be a valid domain name",
    });

    const acmCertificateArn = new CfnParameter(this, "ACMCertificateArn", {
      type: "String",
      description: "ARN of the ACM certificate for HTTPS. Must be in the same region as the stack.",
      allowedPattern: "arn:aws[a-z-]*:acm:[a-z0-9-]+:[0-9]+:certificate/[a-f0-9-]+",
      constraintDescription: "Must be a valid ACM certificate ARN",
    });

    const webConsoleImageUri = new CfnParameter(this, "WebConsoleImageUri", {
      type: "String",
      default: "",
      description: "URI of web console container image. If empty, the default public image is used.",
      allowedPattern: ECR_IMAGE_URI_PATTERN,
      constraintDescription:
        "Must be empty or a valid ECR image URI (e.g., 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo:tag or .../my-repo@sha256:<64-hex-chars>).",
    });

    const deployWaf = new CfnParameter(this, "DeployWAF", {
      type: "String",
      default: "Yes",
      description:
        "Deploy AWS WAF WebACL on the Application Load Balancer with AWS managed rule groups for common threats, known bad inputs, and IP reputation. Select No to skip WAF deployment.",
      allowedValues: ["Yes", "No"],
    });

    // Add new parameter group for Web Console configuration
    const existingMetadata = this.templateOptions.metadata as {
      "AWS::CloudFormation::Interface": {
        ParameterGroups: Array<{ Label: { default: string }; Parameters: string[] }>;
        ParameterLabels: Record<string, { default: string }>;
      };
    };

    existingMetadata["AWS::CloudFormation::Interface"].ParameterGroups.push({
      Label: { default: "Web Console Configuration" },
      Parameters: [
        consoleDomainName.logicalId,
        acmCertificateArn.logicalId,
        webConsoleImageUri.logicalId,
        deployWaf.logicalId,
      ],
    });

    // Add parameter labels
    existingMetadata["AWS::CloudFormation::Interface"].ParameterLabels[consoleDomainName.logicalId] = {
      default: "* Console Domain Name",
    };
    existingMetadata["AWS::CloudFormation::Interface"].ParameterLabels[acmCertificateArn.logicalId] = {
      default: "* ACM Certificate ARN",
    };
    existingMetadata["AWS::CloudFormation::Interface"].ParameterLabels[webConsoleImageUri.logicalId] = {
      default: "Web Console Container Image URI",
    };
    existingMetadata["AWS::CloudFormation::Interface"].ParameterLabels[deployWaf.logicalId] = {
      default: "Deploy AWS WAF",
    };

    const construct = new DLTConsoleAlbEcsConstruct(this, "DLTConsoleResources", {
      s3LogsBucket: this.commonResources.s3LogsBucket,
      solutionId: this.solutionId,
      buildFromSource: this.shouldBuildFromSource,
      consoleDomainName: consoleDomainName.valueAsString,
      certificateArn: acmCertificateArn.valueAsString,
      webConsoleImageUri: webConsoleImageUri.valueAsString,
      webConsoleZipKey: WEB_CONSOLE_ZIP_KEY,
      deployWaf: deployWaf.valueAsString,
    });

    new CfnOutput(this, "ALBDnsName", {
      description: "ALB DNS name",
      value: construct.albDnsName,
    });

    return construct;
  }
}
