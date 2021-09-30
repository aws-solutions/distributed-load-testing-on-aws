// Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import '@aws-cdk/assert/jest';
import { SynthUtils } from '@aws-cdk/assert';
import { Stack } from '@aws-cdk/core';
import { FargateVpcContruct } from '../lib/vpc';

test('DLT VPC Test', () => {
    const stack = new Stack();
    const vpc = new FargateVpcContruct(stack, 'TestVPC', {
        subnetACidrBlock: '10.0.0.0/24',
        subnetBCidrBlock: '10.0.1.0/24',
        solutionId: 'SO0062',
        vpcCidrBlock: '10.0.0.0/16',
    });

    expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
    expect(vpc.DLTfargateVpcId).toBeDefined();
    expect(stack).toHaveResource('AWS::EC2::VPC', {
        CidrBlock: '10.0.0.0/16',
        EnableDnsHostnames: true,
        EnableDnsSupport: true
    })
    expect(vpc.subnetA).toBeDefined();
    expect(stack).toHaveResource('AWS::EC2::Subnet', {
        CidrBlock: '10.0.0.0/24'
    });
    expect(vpc.subnetB).toBeDefined();
    expect(stack).toHaveResource('AWS::EC2::Subnet', {
        CidrBlock: '10.0.1.0/24'
    });
    expect(stack).toHaveResource('AWS::EC2::InternetGateway');
    expect(stack).toHaveResource('AWS::EC2::Route', {
        DestinationCidrBlock: '0.0.0.0/0',
        GatewayId: {
            Ref: "TestVPCDLTFargateIG4FFBAA11",
        },
        RouteTableId: {
            Ref: "TestVPCDLTFargateRT6952750D",
        }
    });
    expect(stack).toHaveResource('AWS::EC2::RouteTable');
    expect(stack).toHaveResource('AWS::EC2::VPCGatewayAttachment', {
        InternetGatewayId: {
            Ref: "TestVPCDLTFargateIG4FFBAA11",
        }
    });
    expect(stack).toHaveResource('AWS::EC2::SubnetRouteTableAssociation', {
        RouteTableId: {
            Ref: "TestVPCDLTFargateRT6952750D",
        },
        SubnetId: {
            Ref: "TestVPCDLTSubnetA8E320A43",
        }
    });
    expect(stack).toHaveResource('AWS::EC2::SubnetRouteTableAssociation', {
        RouteTableId: {
            Ref: "TestVPCDLTFargateRT6952750D",
        },
        SubnetId: {
            Ref: "TestVPCDLTSubnetB7A2BD254",
        }
    })
});