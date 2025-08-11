// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CfnParameter } from "aws-cdk-lib";
import { Construct } from "constructs";

export interface CidBlockParameterProps {
  default: string;
  description: string;
  constraintDescription: string;
}

export class CidrBlockCfnParameters extends Construct {
  readonly vpcCidrBlock: CfnParameter;
  readonly subnetACidrBlock: CfnParameter;
  readonly subnetBCidrBlock: CfnParameter;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const getCfnParameter = (scope: Construct, id: string, props: CidBlockParameterProps) => {
      return new CfnParameter(scope, id, {
        type: "String",
        default: props.default,
        description: props.description,
        allowedPattern: "(^$|(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2})$)",
        constraintDescription: props.constraintDescription,
      });
    };

    // VPC CIDR Block
    this.vpcCidrBlock = getCfnParameter(this, "VpcCidrBlock", {
      default: "192.168.0.0/16",
      description: "You may leave this parameter blank if you are using existing VPC",
      constraintDescription: "The VPC CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
    });

    // Subnet A CIDR Block
    this.subnetACidrBlock = getCfnParameter(this, "SubnetACidrBlock", {
      default: "192.168.0.0/20",
      description: "CIDR block for subnet A of the AWS Fargate VPC",
      constraintDescription: "The subnet CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
    });

    // Subnet B CIDR Block
    this.subnetBCidrBlock = getCfnParameter(this, "SubnetBCidrBlock", {
      default: "192.168.16.0/20",
      constraintDescription: "The subnet CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
      description: "CIDR block for subnet B of the AWS Fargate VPC",
    });

    this.vpcCidrBlock.overrideLogicalId("VpcCidrBlock");
    this.subnetACidrBlock.overrideLogicalId("SubnetACidrBlock");
    this.subnetBCidrBlock.overrideLogicalId("SubnetBCidrBlock");
  }
}
