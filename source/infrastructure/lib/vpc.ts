// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import {
    CfnSubnet,
    CfnVPC,
    CfnInternetGateway,
    CfnRouteTable,
    CfnVPCGatewayAttachment,
    CfnRoute,
    CfnSubnetRouteTableAssociation
} from '@aws-cdk/aws-ec2';
import { Aws, Construct, Fn, Tags } from '@aws-cdk/core';


/**
 * FargageVPCConstruct props
 * @interface FargateVpcContructProps
 */
export interface FargateVpcContructProps {
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
 * @class
 * Distributed Load Testing on AWS VPC construct.
 * Creates a VPC for the Fagate test tasks. 
 * Includes 2 subnets across 2 availability zones and supporting resources.
 */
export class FargateVpcContruct extends Construct {
    // VPC
    public DLTfargateVpcId: string;
    public subnetA: string;
    public subnetB: string;

    constructor(scope: Construct, id: string, props: FargateVpcContructProps) {
        super(scope, id);

        const fargateVpc = new CfnVPC(this, 'DLTFargateVpc', {
            cidrBlock: props.vpcCidrBlock,
            enableDnsHostnames: true,
            enableDnsSupport: true
        });

        fargateVpc.addMetadata('cfn_nag', {
            rules_to_suppress: [{
                id: 'W60',
                reason: 'This VPC is used for the test runner Fargate tasks only, it does not require VPC flow logs.'
            }]
        });

        Tags.of(fargateVpc).add('SolutionId', props.solutionId);
        Tags.of(fargateVpc).add('Name', Aws.STACK_NAME)
        this.DLTfargateVpcId = fargateVpc.ref

        const subnetAResource = new CfnSubnet(this, 'DLTSubnetA', {
            cidrBlock: props.subnetACidrBlock,
            vpcId: this.DLTfargateVpcId,
            availabilityZone: Fn.select(0, Fn.getAzs())
        });
        Tags.of(subnetAResource).add('SolutionId', props.solutionId);
        this.subnetA = subnetAResource.ref

        const subnetBResource = new CfnSubnet(this, 'DLTSubnetB', {
            cidrBlock: props.subnetBCidrBlock,
            vpcId: this.DLTfargateVpcId,
            availabilityZone: Fn.select(1, Fn.getAzs())
        });
        Tags.of(subnetBResource).add('SolutionId', props.solutionId);
        this.subnetB = subnetBResource.ref

        const ig = new CfnInternetGateway(this, 'DLTFargateIG', {
        });
        Tags.of(ig).add('SolutionId', props.solutionId);

        const mainRouteTable = new CfnRouteTable(this, 'DLTFargateRT', {
            vpcId: this.DLTfargateVpcId,
        });
        Tags.of(mainRouteTable).add('SolutionId', props.solutionId);

        const gwa = new CfnVPCGatewayAttachment(this, 'DLTGatewayattachment', {
            vpcId: this.DLTfargateVpcId,
            internetGatewayId: ig.ref
        });

        const routeToInternet = new CfnRoute(this, 'DLTRoute', {
            destinationCidrBlock: '0.0.0.0/0',
            routeTableId: mainRouteTable.ref,
            gatewayId: ig.ref
        });
        routeToInternet.addDependsOn(gwa);

        new CfnSubnetRouteTableAssociation(this, 'DLTRouteTableAssociationA', {
            routeTableId: mainRouteTable.ref,
            subnetId: subnetAResource.ref
        });

        new CfnSubnetRouteTableAssociation(this, 'DLTRouteTableAssociationB', {
            routeTableId: mainRouteTable.ref,
            subnetId: subnetBResource.ref
        });

    }
}