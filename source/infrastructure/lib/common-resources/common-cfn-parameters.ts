// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CfnParameter } from "aws-cdk-lib";
import { Construct } from "constructs";
import { defineParam, PARAMETERS } from "./cfn-parameter-factory";

/**
 * The shared VPC/subnet CIDR block parameters, used by both the main and
 * regional stacks. Constraints (pattern, defaults, descriptions) come from the
 * parameter spec, so the two stacks cannot diverge.
 */
export class CidrBlockCfnParameters extends Construct {
  readonly vpcCidrBlock: CfnParameter;
  readonly subnetACidrBlock: CfnParameter;
  readonly subnetBCidrBlock: CfnParameter;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.vpcCidrBlock = defineParam(this, PARAMETERS.VpcCidrBlock);
    this.subnetACidrBlock = defineParam(this, PARAMETERS.SubnetACidrBlock);
    this.subnetBCidrBlock = defineParam(this, PARAMETERS.SubnetBCidrBlock);

    this.vpcCidrBlock.overrideLogicalId("VpcCidrBlock");
    this.subnetACidrBlock.overrideLogicalId("SubnetACidrBlock");
    this.subnetBCidrBlock.overrideLogicalId("SubnetBCidrBlock");
  }
}
