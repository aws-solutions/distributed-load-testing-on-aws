// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  ArnFormat,
  Aspects,
  Aws,
  CfnCondition,
  CfnResource,
  CustomResource,
  Duration,
  Fn,
  IAspect,
  RemovalPolicy,
  Stack,
} from "aws-cdk-lib";
import {
  CfnIdentityPool,
  CfnIdentityPoolRoleAttachment,
  CfnLogDeliveryConfiguration,
  CfnUserPool,
  CfnUserPoolDomain,
  CfnUserPoolUser,
  ClientAttributes,
  OAuthScope,
  UserPool,
  UserPoolClient,
} from "aws-cdk-lib/aws-cognito";
import { Effect, FederatedPrincipal, PolicyDocument, PolicyStatement, Role, CfnRole } from "aws-cdk-lib/aws-iam";
import { CfnPolicy } from "aws-cdk-lib/aws-iot";
import { Architecture, CfnFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct, IConstruct } from "constructs";
import * as fs from "fs";
import * as path from "path";
import { addCfnGuardSuppression } from "../common-resources/add-cfn-guard-suppression";

class LambdaSuppressionAspect implements IAspect {
  visit(node: IConstruct): void {
    if (node instanceof CfnFunction) {
      node.addMetadata("cfn_nag", {
        rules_to_suppress: [
          {
            id: "W89",
            reason: "Lambda function for Cognito UI customization does not need to be in a VPC",
          },
          {
            id: "W92",
            reason: "Lambda function for Cognito UI customization does not need reserved concurrency",
          },
        ],
      });
    }
  }
}

/**
 * CognitoAuthConstruct props
 * @interface CognitoAuthConstructProps
 */
export interface CognitoAuthConstructProps {
  adminEmail: string;
  adminName: string;
  apiId: string;
  uuid: string;
  webAppURL: string;
  scenariosBucketArn: string;
  /**
   * When true, excludes webAppURL from Cognito callback/logout URLs.
   * Used for customer self-hosted web console stack deployments where the hosting URL is unknown at deploy time.
   */
  isConsoleHostedExternally?: boolean;
}

export class CognitoAuthConstruct extends Construct {
  cognitoUserPool: UserPool;
  cognitoIdentityPoolId: string;
  cognitoUserPoolClientId: string;
  cognitoUserPoolId: string;
  cognitoUserPoolDomain: string;
  public iotPolicy: CfnPolicy;

  constructor(scope: Construct, id: string, props: CognitoAuthConstructProps) {
    super(scope, id);

    const dltIotPolicy = new CfnPolicy(this, "IoT-Policy", {
      policyDocument: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["iot:Connect"],
            resources: [
              Stack.of(this).formatArn({
                service: "iot",
                resource: "client",
                resourceName: "*",
                arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
              }),
            ],
          }),
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["iot:Subscribe"],
            resources: [
              Stack.of(this).formatArn({
                service: "iot",
                resource: "topicfilter",
                resourceName: "dlt/*",
                arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
              }),
            ],
          }),
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["iot:Receive"],
            resources: [
              Stack.of(this).formatArn({
                service: "iot",
                resource: "topic",
                resourceName: "dlt/*",
                arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
              }),
            ],
          }),
        ],
      }),
    });
    this.iotPolicy = dltIotPolicy;
    dltIotPolicy.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W11",
          reason: "Cannot specify the resource to attach policy to identity",
        },
      ],
    });

    // For self-hosted stack, show placeholder since URL is unknown at deploy time
    const consoleUrlMessage = props.isConsoleHostedExternally
      ? "<em>This is a self-hosted deployment. The web console URL will be available once hosting is configured.</em>"
      : `<strong>${props.webAppURL}/</strong>`;

    const cognitoUserPool = new UserPool(this, "DLTUserPool", {
      autoVerify: {
        email: true,
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        requireUppercase: true,
      },
      removalPolicy: RemovalPolicy.DESTROY,
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
        username: true,
      },
      standardAttributes: {
        email: {
          required: true,
        },
      },
      userInvitation: {
        emailSubject: "Welcome to Distributed Load Testing",
        emailBody: `
                <p>
                   Please use the credentials below to login to the Distributed Load Testing console.
                </p>
                <p>
                    Username: <strong>{username}</strong>
                </p>
                <p>
                    Password: <strong>{####}</strong>
                </p>
                <p>
                    Console: ${consoleUrlMessage}
                </p>
              `,
        smsMessage: "Your username is {username} and temporary password is {####}.",
      },
      userPoolName: `${Aws.STACK_NAME}-user-pool`,
    });
    (cognitoUserPool.node.defaultChild as CfnUserPool).userPoolAddOns = { advancedSecurityMode: "ENFORCED" };
    this.cognitoUserPool = cognitoUserPool;
    this.cognitoUserPoolId = cognitoUserPool.userPoolId;

    // CloudWatch log group for Cognito user pool activity logging.
    const cognitoLogGroup = new LogGroup(this, "CognitoUserPoolLogGroup", {
      retention: RetentionDays.TEN_YEARS,
    });
    addCfnGuardSuppression(cognitoLogGroup, "CLOUDWATCH_LOG_GROUP_ENCRYPTED");

    // CDK's logGroupArn includes a trailing `:*` suffix which Cognito's API regex rejects.
    // Build the base ARN without the wildcard suffix.
    const cognitoLogGroupArn = Stack.of(this).formatArn({
      service: "logs",
      resource: "log-group",
      resourceName: cognitoLogGroup.logGroupName,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });

    // Export user auth events (threat protection activity) and notification delivery errors to CloudWatch.
    new CfnLogDeliveryConfiguration(this, "CognitoLogDeliveryConfiguration", {
      userPoolId: cognitoUserPool.userPoolId,
      logConfigurations: [
        {
          eventSource: "userAuthEvents",
          logLevel: "INFO",
          cloudWatchLogsConfiguration: {
            logGroupArn: cognitoLogGroupArn,
          },
        },
        {
          eventSource: "userNotification",
          logLevel: "ERROR",
          cloudWatchLogsConfiguration: {
            logGroupArn: cognitoLogGroupArn,
          },
        },
      ],
    });

    const clientWriteAttributes = new ClientAttributes().withStandardAttributes({
      address: true,
      email: true,
      phoneNumber: true,
    });

    // Add Cognito domain for Hosted UI
    // Use UUID-based domain prefix to ensure global uniqueness
    const domainPrefix = Fn.join("", ["dlt-", props.uuid]);
    const cognitoDomain = new CfnUserPoolDomain(this, "CognitoDomain", {
      domain: domainPrefix,
      userPoolId: cognitoUserPool.userPoolId,
    });
    cognitoDomain.overrideLogicalId("MCPServerDLTUserPoolDomainA26D16C0");
    // GovCloud uses FIPS endpoints (.auth-fips.) for the Cognito hosted UI domain;
    // commercial partitions use the standard .auth. subdomain.
    // Ref: https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/govcloud-cog.html#govcloud-cog-diffs
    const isGovCloudRegion = new CfnCondition(this, "IsGovCloudPartition", {
      expression: Fn.conditionEquals(Aws.PARTITION, "aws-us-gov"),
    });
    const authSubdomain = Fn.conditionIf(isGovCloudRegion.logicalId, ".auth-fips.", ".auth.").toString();
    this.cognitoUserPoolDomain = Fn.join("", [domainPrefix, authSubdomain, Aws.REGION, ".amazoncognito.com"]);

    const callbackUrls = [
      // Deployed web console (excluded for self-hosted stacks where URL is unknown at deploy time)
      ...(props.isConsoleHostedExternally ? [] : [props.webAppURL, `${props.webAppURL}/`]),

      // Local dev server
      "http://localhost:3000",
      "http://localhost:3000/",
      "http://localhost:3000/callback",

      // OAuth callback port (shared by CLI and MCP clients that support configurable ports)
      "http://localhost:7521/callback",
      "http://localhost:7521",
      "http://127.0.0.1:7521", // Kiro requires explicit IP address

      // MCP clients with fixed callback schemes
      "cursor://anysphere.cursor-mcp/oauth/callback",
    ];
    const logoutUrls = callbackUrls;

    const cognitoUserPoolClient = new UserPoolClient(this, "DLTUserPoolClient", {
      userPoolClientName: `${Aws.STACK_NAME}-userpool-client`,
      userPool: cognitoUserPool,
      generateSecret: false,
      writeAttributes: clientWriteAttributes,
      refreshTokenValidity: Duration.days(1),
      enableTokenRevocation: true,
      refreshTokenRotationGracePeriod: Duration.seconds(60),
      // Enable SRP auth for headless CLI authentication (CI/CD pipelines)
      authFlows: {
        userSrp: true,
      },
      // OAuth settings for Hosted UI
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls,
        logoutUrls,
      },
    });

    this.cognitoUserPoolClientId = cognitoUserPoolClient.userPoolClientId;

    // Cognito Hosted UI customization via custom resource
    // CloudFormation's AWS::Cognito::UserPoolUICustomizationAttachment only supports CSS,
    // not ImageFile. We use a custom resource Lambda that calls the Cognito SetUICustomization
    // API directly, which supports both CSS and ImageFile.
    const logoPath = path.join(__dirname, "../../assets/dlt-logo.png");
    const logoBase64 = fs.readFileSync(logoPath).toString("base64");

    const customCss = [
      ".banner-customizable { background-color: #232f3e; padding: 25px 0px; }",
      ".logo-customizable { max-width: 350px; max-height: 80px; }",
      ".submitButton-customizable { background-color: #ec7211; }",
      ".submitButton-customizable:hover { background-color: #eb5f07; }",
    ].join(" ");

    const hostedUiLambda = new NodejsFunction(this, "CognitoHostedUiLambda", {
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      handler: "handler",
      timeout: Duration.minutes(5),
      entry: "lambda/cognito-hosted-ui-handler/index.ts",
    });

    addCfnGuardSuppression(hostedUiLambda, "LAMBDA_INSIDE_VPC");
    addCfnGuardSuppression(hostedUiLambda, "LAMBDA_CONCURRENCY_CHECK");

    hostedUiLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["cognito-idp:SetUICustomization"],
        resources: [cognitoUserPool.userPoolArn],
      })
    );

    const hostedUiProvider = new Provider(this, "CognitoHostedUiProvider", {
      onEventHandler: hostedUiLambda,
    });

    const uiCustomization = new CustomResource(this, "CognitoUICustomization", {
      serviceToken: hostedUiProvider.serviceToken,
      properties: {
        UserPoolId: cognitoUserPool.userPoolId,
        CSS: customCss,
        ImageFileBase64: logoBase64,
      },
    });

    // UI customization requires the domain to exist first
    uiCustomization.node.addDependency(cognitoDomain);
    // Also depends on the client
    uiCustomization.node.addDependency(cognitoUserPoolClient);

    // Suppress CFN NAG rules for the provider framework Lambda functions
    Aspects.of(hostedUiProvider).add(new LambdaSuppressionAspect());

    const cognitoIdentityPool = new CfnIdentityPool(this, "DLTIdentityPool", {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.cognitoUserPoolClientId,
          providerName: cognitoUserPool.userPoolProviderName,
        },
      ],
    });

    this.cognitoIdentityPoolId = cognitoIdentityPool.ref;

    const apiProdExecuteArn = Stack.of(this).formatArn({
      service: "execute-api",
      resource: props.apiId,
      resourceName: "prod/*",
    });
    // GovCloud uses a different Cognito Identity federated principal and condition keys.
    // CDK's FederatedPrincipal doesn't support CloudFormation intrinsics in the Principal
    // or condition key fields, so we use CfnRole escape hatch to emit Fn::If directly.
    // Commercial:            cognito-identity.amazonaws.com
    // GovCloud (US-West):    cognito-identity-us-gov.amazonaws.com
    // GovCloud (US-East):    cognito-identity.us-gov-east-1.amazonaws.com
    // Ref: https://docs.aws.amazon.com/govcloud-us/latest/UserGuide/govcloud-cog.html#govcloud-cog-diffs
    const govWestPrincipal = "cognito-identity-us-gov.amazonaws.com";
    const govEastPrincipal = "cognito-identity.us-gov-east-1.amazonaws.com";
    const comPrincipal = "cognito-identity.amazonaws.com";

    const isGovCloudEast = new CfnCondition(this, "IsGovCloudEastRegion", {
      expression: Fn.conditionEquals(Aws.REGION, "us-gov-east-1"),
    });

    // Helper: build a trust policy statement for a specific principal
    const buildTrustStatement = (principal: string, amrValue: string) => ({
      Effect: "Allow",
      Principal: { Federated: principal },
      Action: "sts:AssumeRoleWithWebIdentity",
      Condition: {
        StringEquals: { [`${principal}:aud`]: this.cognitoIdentityPoolId },
        "ForAnyValue:StringLike": { [`${principal}:amr`]: amrValue },
      },
    });

    // Build trust policy with nested Fn::If:
    // GovCloud US-East → cognito-identity.us-gov-east-1.amazonaws.com
    // GovCloud US-West → cognito-identity-us-gov.amazonaws.com
    // Commercial       → cognito-identity.amazonaws.com
    const buildTrustPolicy = (amrValue: string) => ({
      Version: "2012-10-17",
      Statement: [
        Fn.conditionIf(
          isGovCloudRegion.logicalId,
          Fn.conditionIf(
            isGovCloudEast.logicalId,
            buildTrustStatement(govEastPrincipal, amrValue),
            buildTrustStatement(govWestPrincipal, amrValue)
          ),
          buildTrustStatement(comPrincipal, amrValue)
        ),
      ],
    });

    // Create roles with commercial principal as placeholder, then override via escape hatch
    const cognitoAuthorizedRole = new Role(this, "DLTCognitoAuthorizedRole", {
      assumedBy: new FederatedPrincipal(
        comPrincipal,
        {
          StringEquals: { [`${comPrincipal}:aud`]: this.cognitoIdentityPoolId },
          "ForAnyValue:StringLike": { [`${comPrincipal}:amr`]: "authenticated" },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
      description: `${Aws.STACK_NAME} Identity Pool authenticated role`,
      inlinePolicies: {
        InvokeApiPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["execute-api:Invoke"],
              resources: [apiProdExecuteArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:PutObject", "s3:GetObject"],
              resources: [`${props.scenariosBucketArn}/public/*`],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:GetObject"],
              resources: [`${props.scenariosBucketArn}/results/*`],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:GetObject"],
              resources: [`${props.scenariosBucketArn}/regional-template/*`],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:ListBucket"],
              resources: [props.scenariosBucketArn],
            }),
          ],
        }),
        IoTPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["iot:AttachPolicy"],
              resources: ["*"],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["iot:Connect"],
              resources: [
                Stack.of(this).formatArn({
                  service: "iot",
                  resource: "client",
                  resourceName: "*",
                  arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
                }),
              ],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["iot:Subscribe"],
              resources: [
                Stack.of(this).formatArn({
                  service: "iot",
                  resource: "topicfilter",
                  resourceName: "dlt/*",
                  arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
                }),
              ],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["iot:Receive"],
              resources: [
                Stack.of(this).formatArn({
                  service: "iot",
                  resource: "topic",
                  resourceName: "dlt/*",
                  arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
                }),
              ],
            }),
          ],
        }),
      },
    });
    (cognitoAuthorizedRole.node.defaultChild as CfnResource).addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W11",
          reason: "iot:AttachPolicy does not allow for resource specification",
        },
        {
          id: "F10",
          reason: "requires inline policies",
        },
      ],
    });

    const cognitoUnauthorizedRole = new Role(this, "DLTCognitoUnauthorizedRole", {
      assumedBy: new FederatedPrincipal(
        comPrincipal,
        {
          StringEquals: { [`${comPrincipal}:aud`]: this.cognitoIdentityPoolId },
          "ForAnyValue:StringLike": { [`${comPrincipal}:amr`]: "unauthenticated" },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    // Override trust policies via CfnRole escape hatch so CloudFormation resolves
    // the correct principal/condition keys at deploy time based on partition.
    const cfnAuthorizedRole = cognitoAuthorizedRole.node.defaultChild as CfnRole;
    cfnAuthorizedRole.addPropertyOverride("AssumeRolePolicyDocument", buildTrustPolicy("authenticated"));

    const cfnUnauthorizedRole = cognitoUnauthorizedRole.node.defaultChild as CfnRole;
    cfnUnauthorizedRole.addPropertyOverride("AssumeRolePolicyDocument", buildTrustPolicy("unauthenticated"));

    new CfnIdentityPoolRoleAttachment(this, "CognitoAttachRole", {
      identityPoolId: this.cognitoIdentityPoolId,
      roles: {
        unauthenticated: cognitoUnauthorizedRole.roleArn,
        authenticated: cognitoAuthorizedRole.roleArn,
      },
    });

    new CfnUserPoolUser(this, "CognitoUser", {
      desiredDeliveryMediums: ["EMAIL"],
      forceAliasCreation: true,
      userAttributes: [
        { name: "email", value: props.adminEmail },
        { name: "nickname", value: props.adminName },
        { name: "email_verified", value: "true" },
      ],
      username: props.adminName,
      userPoolId: this.cognitoUserPoolId,
    });
  }
}
