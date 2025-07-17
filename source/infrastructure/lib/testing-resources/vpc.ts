// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, Tags } from "aws-cdk-lib";
import { IpAddresses, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

/**
 * Distributed Load Testing on AWS VPC construct.
 * Creates a VPC for the Fargate test tasks.
 * Includes 2 public subnets across 2 availability zones.
 */
export class FargateVpcConstruct extends Construct {
  public vpc: Vpc;

  constructor(scope: Construct, id: string, vpcCidrBlock: string) {
    super(scope, id);

    const fargateVpc = new Vpc(this, "DLTFargateVpc", {
      ipAddresses: IpAddresses.cidr("192.168.0.0/16"),
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {
          name: "DLTSubnetA",
          subnetType: SubnetType.PUBLIC,
          cidrMask: 20,
        },
        {
          name: "DLTSubnetB",
          subnetType: SubnetType.PUBLIC,
          cidrMask: 20,
        },
      ],
      maxAzs: 2,
      natGateways: 0,
    });

    fargateVpc.node.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W60",
          reason: "This VPC is used for the test runner Fargate tasks only, it does not require VPC flow logs.",
        },
      ],
    });

    this.vpc = fargateVpc;

    Tags.of(fargateVpc).add("Name", Aws.STACK_NAME);
  }
}
