// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { AuthorizerType, GatewayProtocolType } from "@aws-sdk/client-bedrock-agentcore-control";
import { CfnGateway } from "aws-cdk-lib/aws-bedrockagentcore";
import { Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface AgentCoreGatewayProps {
  readonly name: string;
  readonly description: string;
  readonly executionRole: Role;
  readonly discoveryUrl: string;
  readonly allowedClients: string[];
}

export class AgentCoreGateway extends Construct {
  public readonly gatewayId: string;
  public readonly gatewayArn: string;
  public readonly gatewayUrl: string;

  constructor(scope: Construct, id: string, props: AgentCoreGatewayProps) {
    super(scope, id);

    const gateway = new CfnGateway(this, "DltAgentCoreGateway", {
      name: props.name,
      description: props.description,
      roleArn: props.executionRole.roleArn,
      protocolType: GatewayProtocolType.MCP,
      authorizerType: AuthorizerType.CUSTOM_JWT,
      authorizerConfiguration: {
        customJwtAuthorizer: {
          discoveryUrl: props.discoveryUrl,
          allowedClients: props.allowedClients,
        },
      },
    });

    // Expose gateway attributes
    this.gatewayId = gateway.attrGatewayIdentifier;
    this.gatewayArn = gateway.attrGatewayArn;
    this.gatewayUrl = gateway.attrGatewayUrl;
  }
}
