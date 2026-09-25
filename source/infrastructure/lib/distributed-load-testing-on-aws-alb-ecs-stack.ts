// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CfnOutput } from "aws-cdk-lib";
import { DLTBaseStack, IDLTConsole } from "./distributed-load-testing-on-aws-base-stack";
import { defineParam, PARAMETERS } from "./common-resources/cfn-parameter-factory";
import { DLTConsoleAlbEcsConstruct } from "./front-end/console-alb-ecs";

// S3 key for web console assets - shared between stack and construct
const WEB_CONSOLE_ZIP_KEY = "dlt-web-console.zip";

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
    // Add ALB+ECS specific parameters. Constraints come from the parameter spec
    // (single source of truth shared with the Launch Wizard metadata).
    const consoleDomainName = defineParam(this, PARAMETERS.ConsoleDomainName);
    const acmCertificateArn = defineParam(this, PARAMETERS.ACMCertificateArn);
    const webConsoleImageUri = defineParam(this, PARAMETERS.WebConsoleImageUri);
    const deployWaf = defineParam(this, PARAMETERS.DeployWAF);

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
