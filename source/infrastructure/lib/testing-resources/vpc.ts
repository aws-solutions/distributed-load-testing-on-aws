// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, Fn, Tags } from "aws-cdk-lib";
import {
  CfnVPC,
  CfnSubnet,
  CfnInternetGateway,
  CfnRouteTable,
  CfnVPCGatewayAttachment,
  CfnRoute,
  CfnSubnetRouteTableAssociation,
} from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface FargateVpcConstructProps {
  // IP CIDR block for Subnet A
  readonly subnetACidrBlock: string;
  // IP CIDR block for Subnet B
  readonly subnetBCidrBlock: string;
  // Solution ID
  readonly solutionId: string;
  // IP CIDR block for VPC
  readonly vpcCidrBlock: string;
}

/**
 * Distributed Load Testing on AWS VPC construct.
 * Creates a VPC for the Fargate test tasks.
 * Includes 2 public subnets across 2 availability zones.
 */
export class FargateVpcConstruct extends Construct {
  // VPC
  public vpcId: string;
  public subnetA: string;
  public subnetB: string;

  constructor(scope: Construct, id: string, props: FargateVpcConstructProps) {
    super(scope, id);

    const fargateVpc = new CfnVPC(this, "DLTFargateVpc", {
      cidrBlock: props.vpcCidrBlock,
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    fargateVpc.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W60",
          reason: "This VPC is used for the test runner Fargate tasks only, it does not require VPC flow logs.",
        },
      ],
    });

    Tags.of(fargateVpc).add("Name", Aws.STACK_NAME);
    this.vpcId = fargateVpc.ref;

    const subnetAResource = new CfnSubnet(this, "DLTSubnetA", {
      cidrBlock: props.subnetACidrBlock,
      vpcId: this.vpcId,
      availabilityZone: Fn.select(0, Fn.getAzs()),
    });
    this.subnetA = subnetAResource.ref;

    const subnetBResource = new CfnSubnet(this, "DLTSubnetB", {
      cidrBlock: props.subnetBCidrBlock,
      vpcId: this.vpcId,
      availabilityZone: Fn.select(1, Fn.getAzs()),
    });
    this.subnetB = subnetBResource.ref;

    const ig = new CfnInternetGateway(this, "DLTFargateIG", {});

    const mainRouteTable = new CfnRouteTable(this, "DLTFargateRT", {
      vpcId: this.vpcId,
    });

    const gwa = new CfnVPCGatewayAttachment(this, "DLTGatewayattachment", {
      vpcId: this.vpcId,
      internetGatewayId: ig.ref,
    });

    const routeToInternet = new CfnRoute(this, "DLTRoute", {
      destinationCidrBlock: "0.0.0.0/0",
      routeTableId: mainRouteTable.ref,
      gatewayId: ig.ref,
    });
    routeToInternet.addDependency(gwa);

    new CfnSubnetRouteTableAssociation(this, "DLTRouteTableAssociationA", {
      routeTableId: mainRouteTable.ref,
      subnetId: subnetAResource.ref,
    });

    new CfnSubnetRouteTableAssociation(this, "DLTRouteTableAssociationB", {
      routeTableId: mainRouteTable.ref,
      subnetId: subnetBResource.ref,
    });
  }
}
