// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { FargateVpcConstruct } from "../lib/testing-resources/vpc";

test("DLT VPC Test", () => {
  const app = new App();
  const stack = new Stack(app, "DLTStack", {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  const vpc = new FargateVpcConstruct(stack, "TestVPC", {
    subnetACidrBlock: "10.0.0.0/24",
    subnetBCidrBlock: "10.0.1.0/24",
    solutionId: "SO0062",
    vpcCidrBlock: "10.0.0.0/16",
  });

  expect(Template.fromStack(stack)).toMatchSnapshot();
  expect(vpc.vpcId).toBeDefined();
  Template.fromStack(stack).hasResourceProperties("AWS::EC2::VPC", {
    CidrBlock: "10.0.0.0/16",
    EnableDnsHostnames: true,
    EnableDnsSupport: true,
  });
  expect(vpc.subnetA).toBeDefined();
  Template.fromStack(stack).hasResourceProperties("AWS::EC2::Subnet", {
    CidrBlock: "10.0.0.0/24",
  });
  expect(vpc.subnetB).toBeDefined();
  Template.fromStack(stack).hasResourceProperties("AWS::EC2::Subnet", {
    CidrBlock: "10.0.1.0/24",
  });
  Template.fromStack(stack).resourceCountIs("AWS::EC2::InternetGateway", 1);
  Template.fromStack(stack).hasResourceProperties("AWS::EC2::Route", {
    DestinationCidrBlock: "0.0.0.0/0",
    GatewayId: {
      Ref: "TestVPCDLTFargateIG4FFBAA11",
    },
    RouteTableId: {
      Ref: "TestVPCDLTFargateRT6952750D",
    },
  });
  Template.fromStack(stack).resourceCountIs("AWS::EC2::RouteTable", 1);
  Template.fromStack(stack).hasResourceProperties("AWS::EC2::VPCGatewayAttachment", {
    InternetGatewayId: {
      Ref: "TestVPCDLTFargateIG4FFBAA11",
    },
  });
  Template.fromStack(stack).hasResourceProperties("AWS::EC2::SubnetRouteTableAssociation", {
    RouteTableId: {
      Ref: "TestVPCDLTFargateRT6952750D",
    },
    SubnetId: {
      Ref: "TestVPCDLTSubnetA8E320A43",
    },
  });
  Template.fromStack(stack).hasResourceProperties("AWS::EC2::SubnetRouteTableAssociation", {
    RouteTableId: {
      Ref: "TestVPCDLTFargateRT6952750D",
    },
    SubnetId: {
      Ref: "TestVPCDLTSubnetB7A2BD254",
    },
  });
});
