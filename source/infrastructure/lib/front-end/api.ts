// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Aws, ArnFormat, CfnResource, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { ILogGroup, LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Effect, Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import {
  AccessLogFormat,
  AuthorizationType,
  CfnAccount,
  ContentHandling,
  Deployment,
  EndpointType,
  Integration,
  IntegrationType,
  LogGroupLogDestination,
  MethodLoggingLevel,
  MethodOptions,
  PassthroughBehavior,
  RequestValidator,
  RestApi,
  Stage,
} from "aws-cdk-lib/aws-apigateway";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Solution, SOLUTIONS_METRICS_ENDPOINT } from "../../bin/solution";
import { addCfnGuardSuppression } from "../common-resources/add-cfn-guard-suppression";

/**
 * @interface DLTAPIProps
 * DLTAPI props
 */
export interface DLTAPIProps {
  readonly cloudWatchLogsPolicy: Policy;
  // ECS CloudWatch Log Group
  readonly ecsCloudWatchLogGroup: LogGroup;
  // ECS Task Execution Role ARN
  readonly ecsTaskExecutionRoleArn: string;
  // History DynamoDB table policy
  readonly historyDynamoDbPolicy: Policy;
  // History DynamoDB table
  readonly historyTable: string;
  // Test scenarios S3 bucket
  readonly scenariosBucketName: string;
  // Scenarios DynamoDB table policy
  readonly scenariosDynamoDbPolicy: Policy;
  // Test scenarios S3 bucket policy
  readonly scenariosS3Policy: Policy;
  // Test scenarios DynamoDB table
  readonly scenariosTableName: string;
  // Task canceler ARN
  readonly taskCancelerArn: string;
  // Task Canceler Invoke Policy
  readonly taskCancelerInvokePolicy: Policy;
  // Task Runner state function
  readonly taskRunnerStepFunctionsArn: string;

  /**
   * Solution config properties.
   * the metric URL endpoint, send anonymized usage, solution ID, version, source code bucket, and source code prefix
   */
  readonly sendAnonymizedUsage: string;
  readonly solution: Solution;
  readonly uuid: string;
}

/**
 * Distributed Load Testing on AWS API construct
 */
export class DLTAPI extends Construct {
  apiId: string;
  apiEndpointPath: string;
  apiServicesLambdaRoleName: string;
  apiLambdaLogGroup: ILogGroup;

  constructor(scope: Construct, id: string, props: DLTAPIProps) {
    super(scope, id);

    Stack.of(this).formatArn({
      service: "ecs",
      resource: "task",
      resourceName: "*",
      region: "*",
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });
    Stack.of(this).formatArn({ service: "ecs", region: "*", resource: "task-definition/" });

    const dltApiServicesLambdaRole = new Role(this, "DLTAPIServicesLambdaRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        DLTAPIServicesLambdaPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "ecs:ListTasks",
                "ecs:RunTask",
                "ecs:DescribeTasks",
                "ecs:TagResource",
                "logs:DeleteMetricFilter",
              ],
              resources: ["*"],
              conditions: {
                StringEquals: {
                  "aws:ResourceTag/SolutionId": props.solution.id,
                },
              },
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["iam:PassRole"],
              resources: [props.ecsTaskExecutionRoleArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["states:StartExecution"],
              resources: [props.taskRunnerStepFunctionsArn],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["cloudwatch:DeleteDashboards"],
              resources: [
                Stack.of(this).formatArn({
                  service: "cloudwatch",
                  region: "",
                  resource: "dashboard",
                  resourceName: "EcsLoadTesting*",
                }),
              ],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["cloudformation:ListExports"],
              resources: ["*"],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "ecs:ListAccountSettings",
                "ecs:ListTasks",
                "ecs:ListClusters",
                "ecs:DescribeClusters",
                "ecs:DescribeTaskDefinition",
              ],
              resources: ["*"],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["servicequotas:GetServiceQuota"],
              resources: ["*"],
            }),
          ],
        }),
      },
    });
    this.apiServicesLambdaRoleName = dltApiServicesLambdaRole.roleName;
    dltApiServicesLambdaRole.attachInlinePolicy(props.cloudWatchLogsPolicy);
    dltApiServicesLambdaRole.attachInlinePolicy(props.historyDynamoDbPolicy);
    dltApiServicesLambdaRole.attachInlinePolicy(props.scenariosDynamoDbPolicy);
    dltApiServicesLambdaRole.attachInlinePolicy(props.scenariosS3Policy);
    dltApiServicesLambdaRole.attachInlinePolicy(props.taskCancelerInvokePolicy);

    const ruleSchedArn = Stack.of(this).formatArn({ service: "events", resource: "rule", resourceName: "*Scheduled" });
    const ruleCreateArn = Stack.of(this).formatArn({ service: "events", resource: "rule", resourceName: "*Create" });
    const ruleListArn = Stack.of(this).formatArn({ service: "events", resource: "rule", resourceName: "*" });

    const lambdaApiEventsPolicy = new Policy(this, "LambdaApiEventsPolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["events:PutTargets", "events:PutRule", "events:DeleteRule", "events:RemoveTargets"],
          resources: [ruleSchedArn, ruleCreateArn],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["events:ListRules"],
          resources: [ruleListArn],
        }),
      ],
    });
    dltApiServicesLambdaRole.attachInlinePolicy(lambdaApiEventsPolicy);

    const apiLambdaRoleResource = dltApiServicesLambdaRole.node.defaultChild as CfnResource;
    apiLambdaRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W11",
          reason: "ecs:ListTasks and cloudformation:ListExports do not support resource level permissions",
        },
        {
          id: "F10",
          reason: "requires in-line role permissions.",
        },
      ],
    });

    const dltApiServicesLambda = new NodejsFunction(this, "DLTAPIServicesLambdaNew", {
      description: "API microservices for creating, updating, listing and deleting test scenarios",
      entry: path.join(__dirname, "../../../api-services/index.js"),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(120),
      environment: {
        HISTORY_TABLE: props.historyTable,
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        SCENARIOS_BUCKET: props.scenariosBucketName,
        SCENARIOS_TABLE: props.scenariosTableName,
        SEND_METRIC: props.sendAnonymizedUsage,
        SOLUTION_ID: props.solution.id,
        STACK_ID: Aws.STACK_ID,
        STATE_MACHINE_ARN: props.taskRunnerStepFunctionsArn,
        TASK_CANCELER_ARN: props.taskCancelerArn,
        UUID: props.uuid,
        VERSION: props.solution.version,
      },
      role: dltApiServicesLambdaRole,
    });
    const apiLambdaResource = dltApiServicesLambda.node.defaultChild as CfnResource;
    apiLambdaResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W58",
          reason: "CloudWatchLogsPolicy covers a permission to write CloudWatch logs.",
        },
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

    const dltApiServicesLambdaLogGroup = new LogGroup(this, "dltApiServicesLambdaLogGroup", {
      logGroupName: `/aws/lambda/${dltApiServicesLambda.functionName}`,
    });
    this.apiLambdaLogGroup = dltApiServicesLambdaLogGroup;

    const lambdaApiPermissionPolicy = new Policy(this, "LambdaApiPermissionPolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["lambda:AddPermission", "lambda:RemovePermission"],
          resources: [dltApiServicesLambda.functionArn],
        }),
      ],
    });
    dltApiServicesLambdaRole.attachInlinePolicy(lambdaApiPermissionPolicy);

    const dltApiServicesLambdaLogGroupResource = dltApiServicesLambdaLogGroup.node.defaultChild as CfnResource;
    dltApiServicesLambdaLogGroupResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W84",
          reason: "KMS encryption unnecessary for log group",
        },
      ],
    });

    const apiLogs = new LogGroup(this, "APILogs", {
      retention: RetentionDays.ONE_YEAR,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const apiLogsResource = apiLogs.node.defaultChild as CfnResource;
    apiLogsResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W84",
          reason: "KMS encryption unnecessary for log group",
        },
      ],
    });

    const logsArn = Stack.of(this).formatArn({ service: "logs", resource: "*" });
    const apiLoggingRole = new Role(this, "APILoggingRole", {
      assumedBy: new ServicePrincipal("apigateway.amazonaws.com"),
      inlinePolicies: {
        apiLoggingPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams",
                "logs:PutLogEvents",
                "logs:GetLogEvents",
                "logs:FilterLogEvent",
              ],
              resources: [logsArn],
            }),
          ],
        }),
      },
    });

    const apiLoggingRoleResource = apiLoggingRole.node.defaultChild as CfnResource;
    apiLoggingRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "F10",
          reason: "Requires inline policy resources.",
        },
      ],
    });

    const api = new RestApi(this, "DLTApi", {
      defaultCorsPreflightOptions: {
        allowOrigins: ["*"],
        allowHeaders: ["Authorization", "Content-Type", "X-Amz-Date", "X-Amz-Security-Token", "X-Api-Key"],
        allowMethods: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
        statusCode: 200,
      },
      deploy: true,
      deployOptions: {
        accessLogDestination: new LogGroupLogDestination(apiLogs),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
        loggingLevel: MethodLoggingLevel.INFO,
        stageName: "prod",
        tracingEnabled: true,
      },
      description: `Distributed Load Testing API - version ${props.solution.version}`,
      endpointTypes: [EndpointType.EDGE],
    });

    this.apiId = api.restApiId;
    this.apiEndpointPath = api.url.slice(0, -1);

    const apiAccountConfig = new CfnAccount(this, "ApiAccountConfig", {
      cloudWatchRoleArn: apiLoggingRole.roleArn,
    });
    apiAccountConfig.addDependency(api.node.defaultChild as CfnResource);
    const apiAllRequestValidator = new RequestValidator(this, "APIAllRequestValidator", {
      restApi: api,
      validateRequestBody: true,
      validateRequestParameters: true,
    });

    const apiDeployment = api.node.findChild("Deployment") as Deployment;
    const apiDeploymentResource = apiDeployment.node.defaultChild as CfnResource;
    apiDeploymentResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W68",
          reason: "The solution does not require the usage plan.",
        },
      ],
    });

    const apiFindProdResource = api.node.findChild("DeploymentStage.prod") as Stage;

    addCfnGuardSuppression(apiFindProdResource, "API_GW_CACHE_ENABLED_AND_ENCRYPTED");

    const apiProdResource = apiFindProdResource.node.defaultChild as CfnResource;
    apiProdResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W64",
          reason: "The solution does not require the usage plan.",
        },
      ],
    });

    const allIntegration = new Integration({
      type: IntegrationType.AWS_PROXY,
      integrationHttpMethod: "POST",
      options: {
        contentHandling: ContentHandling.CONVERT_TO_TEXT,
        integrationResponses: [{ statusCode: "200" }],
        passthroughBehavior: PassthroughBehavior.WHEN_NO_MATCH,
      },
      uri: `arn:${Aws.PARTITION}:apigateway:${Aws.REGION}:lambda:path/2015-03-31/functions/${dltApiServicesLambda.functionArn}/invocations`,
    });
    const allMethodOptions: MethodOptions = {
      authorizationType: AuthorizationType.IAM,
      methodResponses: [
        {
          statusCode: "200",
          responseModels: {
            "application/json": { modelId: "Empty" },
          },
        },
      ],
      requestValidator: apiAllRequestValidator,
    };

    /**
     * Test scenario API
     * /regions
     * /scenarios
     * /scenarios/{testId}
     * /tasks
     * /vCPUDetails
     */

    const regionsResource = api.root.addResource("regions");
    regionsResource.addMethod("ANY", allIntegration, allMethodOptions);

    const scenariosResource = api.root.addResource("scenarios");
    scenariosResource.addMethod("ANY", allIntegration, allMethodOptions);

    const testIds = scenariosResource.addResource("{testId}");
    testIds.addMethod("ANY", allIntegration, allMethodOptions);

    const tasksResource = api.root.addResource("tasks");
    tasksResource.addMethod("ANY", allIntegration, allMethodOptions);

    const vCPUDetails = api.root.addResource("vCPUDetails");
    vCPUDetails.addMethod("ANY", allIntegration, allMethodOptions);

    const invokeSourceArn = Stack.of(this).formatArn({
      service: "execute-api",
      resource: api.restApiId,
      resourceName: "*",
    });
    dltApiServicesLambda.addPermission("DLTApiInvokePermission", {
      action: "lambda:InvokeFunction",
      principal: new ServicePrincipal("apigateway.amazonaws.com"),
      sourceArn: invokeSourceArn,
    });
  }
}
