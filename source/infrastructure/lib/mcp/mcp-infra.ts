// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ArnFormat, Aws, CfnResource, Duration, Stack } from "aws-cdk-lib";
import { RestApi } from "aws-cdk-lib/aws-apigateway";
import {
  OAuthScope,
  ResourceServerScope,
  UserPool,
  UserPoolClient,
  UserPoolDomain,
  UserPoolResourceServer,
} from "aws-cdk-lib/aws-cognito";
import { Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as path from "path";
import toolSchemaJson from "../../../mcp-server/toolSchema.json";
import { Solution, SOLUTIONS_METRICS_ENDPOINT } from "../../bin/solution";
import { AgentCoreGateway } from "./gateway-construct";
import { AgentCoreGatewayTarget } from "./gateway-target-construct";

/**
 * MCP Server props
 */
export interface MCPServerProps {
  readonly api: RestApi;
  readonly cognitoUserPool: UserPool;
  readonly scenarioBucketName: string;
  readonly solution: Solution;
  readonly userPoolId: string;
  readonly allowedClients: string[];
  readonly uuid: string;
}

const GATEWAY_NAME = "dlt-mcp-server";

/**
 * Construct for creating an MCP server via AgentCore Gateway, using a Lambda function as the target.
 */
export class MCPServer extends Construct {
  public readonly mcpToolLambdaFunction: NodejsFunction;
  public readonly gatewayId: string;
  public readonly gatewayArn: string;
  public readonly gatewayUrl: string;

  constructor(scope: Construct, id: string, props: MCPServerProps) {
    super(scope, id);

    // Add scope for gateway:read
    // We must provide scope(s) to app clients, and standard user-related scopes don't apply for M2M auth
    const gatewayReadScope = new ResourceServerScope({
      scopeName: "read",
      scopeDescription: "Read access",
    });

    // Resource Server for MCP Gateway API
    const resourceServer = new UserPoolResourceServer(this, "DLTResourceServer", {
      userPool: props.cognitoUserPool,
      identifier: "dlt-mcp-gateway",
      userPoolResourceServerName: "DLT MCP Gateway Resource Server",
      scopes: [gatewayReadScope],
    });

    // User Pool Domain for OAuth endpoints
    new UserPoolDomain(this, "DLTUserPoolDomain", {
      userPool: props.cognitoUserPool,
      cognitoDomain: {
        domainPrefix: "dlt-" + props.uuid.replace("-", ""), // prefix must be globally unique
      },
    });

    // Client ID/Client Secret client for machine to machine auth
    const cognitoUserPoolClientMachineToMachine = new UserPoolClient(this, "DLTUserPoolClientMachineToMachine", {
      userPoolClientName: `${Aws.STACK_NAME}-userpool-client-m2m`,
      userPool: props.cognitoUserPool,
      refreshTokenValidity: Duration.days(1),
      generateSecret: true,
      authFlows: {
        userPassword: false,
        userSrp: false,
        adminUserPassword: false,
      },
      oAuth: {
        flows: {
          clientCredentials: true,
        },
        scopes: [OAuthScope.resourceServer(resourceServer, gatewayReadScope)],
      },
    });

    // Add dependency to ensure resource server is created before client
    cognitoUserPoolClientMachineToMachine.node.addDependency(resourceServer);

    // Create CloudWatch Logs Policy for MCP Lambda
    const logGroupResourceArn = Stack.of(this).formatArn({
      service: "logs",
      resource: "log-group",
      resourceName: "/aws/lambda/*",
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });

    // IAM Role for MCP Tool Lambda Function
    const mcpToolLambdaRole = new Role(this, "MCPToolLambdaRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      description: "IAM role for MCP Tool Lambda function",
      inlinePolicies: {
        MCPLambdaPolicy: new PolicyDocument({
          statements: [
            // Invoke API permissions
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["execute-api:Invoke"],
              resources: [props.api.arnForExecuteApi("GET")], // scope policy down to GET requests only
            }),
            // CloudWatch Logs permissions
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [logGroupResourceArn],
            }),
          ],
        }),
      },
    });

    // MCP Lambda Function
    this.mcpToolLambdaFunction = new NodejsFunction(this, "MCPToolLambdaFunction", {
      description: "MCP Tool Lambda Function",
      role: mcpToolLambdaRole,
      entry: path.join(__dirname, "../../../mcp-server/src/index.ts"),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: {
        API_GATEWAY_ENDPOINT: props.api.url.replace(/\/$/, ""), // removes trailing '/'
        SCENARIOS_BUCKET_NAME: props.scenarioBucketName,
        SOLUTION_ID: props.solution.id,
        VERSION: props.solution.version,
        UUID: props.uuid,
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
      },
    });

    // IAM Role for AgentCore Gateway
    const agentCoreGatewayRole = new Role(this, "AgentCoreGatewayRole", {
      assumedBy: new ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      description: "IAM role for AgentCore Gateway",
      inlinePolicies: {
        AgentCoreGatewayPolicy: new PolicyDocument({
          statements: [
            // Gateway permissions
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["bedrock-agentcore:GetGateway"],
              resources: [
                `arn:${Aws.PARTITION}:bedrock-agentcore:${Aws.REGION}:${Aws.ACCOUNT_ID}:gateway/${GATEWAY_NAME}`,
              ],
            }),
            // Lambda permissions
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["lambda:InvokeFunction"],
              resources: [this.mcpToolLambdaFunction.functionArn],
            }),
          ],
        }),
      },
    });

    // AgentCore Gateway (via custom resource)
    const gateway = new AgentCoreGateway(this, "AgentCoreGatewayConstruct", {
      name: GATEWAY_NAME,
      description: "DLT MCP Server managed by AgentCore Gateway",
      executionRole: agentCoreGatewayRole,
      discoveryUrl: `https://cognito-idp.${Aws.REGION}.amazonaws.com/${props.userPoolId}/.well-known/openid-configuration`,
      allowedClients: [...props.allowedClients, cognitoUserPoolClientMachineToMachine.userPoolClientId],
    });
    this.gatewayId = gateway.gatewayId;
    this.gatewayArn = gateway.gatewayArn;
    this.gatewayUrl = gateway.gatewayUrl;

    // Gateway to Lambda Target (via custom resource)
    const lambdaTarget = new AgentCoreGatewayTarget(this, "AgentCoreGatewayTargetConstruct", {
      gatewayId: this.gatewayId,
      lambdaArn: this.mcpToolLambdaFunction.functionArn,
      targetName: "DltMcpToolsLambda",
      targetDescription: "Tool provider for DLT MCP server",
      toolSchema: toolSchemaJson,
    });

    // CfnGuard suppressions (copied from existing suppressions in DLT)
    const mcpToolLambdaResource = this.mcpToolLambdaFunction.node.defaultChild as CfnResource;
    mcpToolLambdaResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W89",
          reason: "VPC not needed for lambda",
        },
        {
          id: "W92",
          reason: "Does not run concurrent executions",
        },
      ],
    });
    const mcpToolLambdaRoleResource = mcpToolLambdaRole.node.defaultChild as CfnResource;
    mcpToolLambdaRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "F10",
          reason: "requires in-line role permissions.",
        },
      ],
    });
    const agentCoreGatewayRoleResource = agentCoreGatewayRole.node.defaultChild as CfnResource;
    agentCoreGatewayRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "F10",
          reason: "requires in-line role permissions.",
        },
      ],
    });

    // Add dependency between AgentCore Gateway and AgentCore Gateway Target
    lambdaTarget.node.addDependency(gateway);
  }
}
