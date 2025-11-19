// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CredentialProviderType } from "@aws-sdk/client-bedrock-agentcore-control";
import { CfnGatewayTarget } from "aws-cdk-lib/aws-bedrockagentcore";
import { Construct } from "constructs";

export interface AgentCoreGatewayTargetProps {
  readonly gatewayId: string;
  readonly lambdaArn: string;
  readonly targetName: string;
  readonly targetDescription: string;
  readonly toolSchema: unknown;
}

/**
 * Helper function to convert raw JSON tool schema to CfnGatewayTarget.ToolDefinitionProperty[]
 *
 * @param {unknown} rawSchema - The raw JSON tool schema
 * @returns {CfnGatewayTarget.ToolDefinitionProperty[]} Converted tool schema as ToolDefinitionProperty array
 */
function convertToolSchemaToDefinitionProperties(rawSchema: unknown): CfnGatewayTarget.ToolDefinitionProperty[] {
  return rawSchema as CfnGatewayTarget.ToolDefinitionProperty[];
}

export class AgentCoreGatewayTarget extends Construct {
  public readonly targetId: string;

  constructor(scope: Construct, id: string, props: AgentCoreGatewayTargetProps) {
    super(scope, id);

    // Convert raw JSON tool schema to typed definition properties
    const convertedToolSchema = convertToolSchemaToDefinitionProperties(props.toolSchema);

    const target = new CfnGatewayTarget(this, "DltAgentCoreGatewayTarget", {
      gatewayIdentifier: props.gatewayId,
      name: props.targetName,
      description: props.targetDescription,
      targetConfiguration: {
        mcp: {
          lambda: {
            lambdaArn: props.lambdaArn,
            toolSchema: {
              inlinePayload: convertedToolSchema,
            },
          },
        },
      },
      credentialProviderConfigurations: [
        {
          credentialProviderType: CredentialProviderType.GATEWAY_IAM_ROLE,
        },
      ],
    });

    // Expose target ID
    this.targetId = target.attrTargetId;
  }
}
