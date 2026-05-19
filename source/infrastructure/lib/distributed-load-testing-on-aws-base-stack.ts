// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Base stack containing all shared backend infrastructure for DLT.
 * Console-specific stacks extend this and provide their own console construct.
 */

import {
  ArnFormat,
  Aspects,
  Aws,
  CfnCondition,
  CfnMapping,
  CfnOutput,
  CfnParameter,
  CfnResource,
  CfnRule,
  Fn,
  IAspect,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaFunctionTarget } from "aws-cdk-lib/aws-events-targets";
import { Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Bucket, IBucket } from "aws-cdk-lib/aws-s3";
import { ContainerDefinition } from "aws-cdk-lib/aws-ecs";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct, IConstruct } from "constructs";
import * as path from "path";
import { SolutionsMetrics } from "../../metrics-utils";
import { Solution, SOLUTIONS_METRICS_ENDPOINT } from "../bin/solution";
import { SavedQueriesConstruct } from "./back-end/saved-queries";
import { ScenarioTestRunnerStorageConstruct } from "./back-end/scenarios-storage";
import { TaskRunnerStepFunctionConstruct } from "./back-end/step-functions";
import { TestRunnerLambdasConstruct } from "./back-end/test-task-lambdas";
import { CidrBlockCfnParameters } from "./common-resources/common-cfn-parameters";
import { CommonResources } from "./common-resources/common-resources";
import { CustomResourcesConstruct } from "./common-resources/custom-resources";
import { DLTAPI } from "./front-end/api";
import { CognitoAuthConstruct } from "./front-end/auth";
import { WebUIConfigConstruct, WebUIZipConstruct } from "./front-end/webui-assets";
import { MCPServer } from "./mcp/mcp-infra";
import { ECSResourcesConstruct } from "./testing-resources/ecs";
import { RealTimeDataConstruct } from "./testing-resources/real-time-data";
import { FargateVpcConstruct } from "./testing-resources/vpc";

/**
 * CDK Aspect implementation to set up conditions to the entire Construct resources
 */
export class ConditionAspect implements IAspect {
  private readonly condition: CfnCondition;

  constructor(condition: CfnCondition) {
    this.condition = condition;
  }

  /**
   * Implement IAspect.visit to set the condition to whole resources in Construct.
   * @param {IConstruct} node Construct node to visit
   */
  visit(node: IConstruct): void {
    const resource = node as CfnResource;
    if (resource.cfnOptions) {
      resource.cfnOptions.condition = this.condition;
    }
  }
}

/**
 * DLTStack props
 * @interface DLTStackProps
 */
export interface DLTBaseStackProps extends StackProps {
  readonly solution: Solution;
  readonly stackType: string;
  /**
   * Identifies which published CloudFormation template produced this stack.
   * Stamped as a `SolutionTemplate` stack tag so the console and operational
   * tooling can distinguish between the hub variants at runtime.
   */
  readonly solutionTemplate: "cloudfront" | "alb-ecs" | "headless";
}

/**
 * Console construct interface - all console implementations must provide these
 */
export interface IDLTConsole {
  readonly webAppURL: string;
  readonly consoleBucket: IBucket;
  readonly consoleBucketArn: string;
  /**
   * The ResponseHeadersPolicy ID for CloudFront CSP updates.
   * Only available for CloudFront-based console constructs.
   */
  readonly responseHeadersPolicyId?: string;
  /**
   * Flag indicating if this stack needs web console ZIP generation.
   * True for ALB+ECS and headless stacks, undefined/false for CloudFront.
   */
  readonly needsWebConsoleZip?: boolean;
  /**
   * Flag indicating if the web console is hosted externally (outside this stack).
   * When true, Cognito callback URLs exclude webAppURL since hosting URL is unknown at deploy time.
   */
  readonly isConsoleHostedExternally?: boolean;
  /**
   * The ECS container definition for the web console.
   * Used to inject the exact Cognito domain at deploy time for CSP tightening.
   * Only available for ALB+ECS console constructs.
   */
  readonly webConsoleContainer?: ContainerDefinition;
}

/**
 * Base stack with all shared backend infrastructure.
 * Subclasses must implement createConsoleConstruct() to provide the console.
 */
export abstract class DLTBaseStack extends Stack {
  // Common parameters exposed for subclasses
  protected adminName: CfnParameter;
  protected adminEmail: CfnParameter;
  protected solutionId: string;
  protected commonResources: CommonResources;
  protected shouldBuildFromSource: boolean;
  protected stableTagConditionLogicalId: string;

  constructor(scope: Construct, id: string, props: DLTBaseStackProps) {
    super(scope, id, props);

    // Load context variables
    this.shouldBuildFromSource = this.node.tryGetContext("buildFromSource") === "true";

    // CFN template format version
    this.templateOptions.templateFormatVersion = "2010-09-09";
    this.templateOptions.description = props.solution.description;

    // CFN Parameters
    // Admin name
    this.adminName = new CfnParameter(this, "AdminName", {
      type: "String",
      minLength: 4,
      maxLength: 20,
      allowedPattern: "[a-zA-Z0-9-]+",
      constraintDescription: "Admin username must be a minimum of 4 characters and cannot include spaces",
    });

    // Admin email
    this.adminEmail = new CfnParameter(this, "AdminEmail", {
      type: "String",
      allowedPattern: "^[_A-Za-z0-9-\\+]+(\\.[_A-Za-z0-9-]+)*@[A-Za-z0-9-]+(\\.[A-Za-z0-9]+)*(\\.[A-Za-z]{2,})$",
      constraintDescription: "Admin email must be a valid email address",
      minLength: 5,
    });

    // Existing VPC ID
    const existingVpcId = new CfnParameter(this, "ExistingVPCId", {
      type: "String",
      default: "",
      description: "Existing VPC ID",
      allowedPattern: "(?:^$|^vpc-[a-zA-Z0-9-]+)",
    });

    const existingSubnetA = new CfnParameter(this, "ExistingSubnetA", {
      type: "String",
      default: "",
      description: "First existing subnet",
      allowedPattern: "(?:^$|^subnet-[a-zA-Z0-9-]+)",
    });

    const existingSubnetB = new CfnParameter(this, "ExistingSubnetB", {
      type: "String",
      default: "",
      description: "Second existing subnet",
      allowedPattern: "(?:^$|^subnet-[a-zA-Z0-9-]+)",
    });

    const vpcCidrBlockCfnParameters = new CidrBlockCfnParameters(this, "DLTMain");

    // Egress CIDR Block
    const egressCidrBlock = new CfnParameter(this, "EgressCidr", {
      type: "String",
      default: "0.0.0.0/0",
      description: "CIDR Block to restrict the Amazon ECS container outbound access",
      minLength: 9,
      maxLength: 18,
      allowedPattern: "((\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2}))",
      constraintDescription: "The Egress CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
    });

    const stableTagging = new CfnParameter(this, "UseStableTagging", {
      description:
        "Automatically use the most up to date and secure image up until the next minor release. Selecting 'No' will pull the image as originally released, without any security updates.",
      type: "String",
      default: "No",
      allowedValues: ["Yes", "No"],
    });

    const deployMcpServer = new CfnParameter(this, "DeployMCPServer", {
      description:
        "Deploy a remote MCP server to connect AI applications to DLT. See the Implementation Guide for more details.",
      type: "String",
      default: "No",
      allowedValues: ["Yes", "No"],
    });

    // CloudFormation metadata
    this.templateOptions.metadata = {
      "AWS::CloudFormation::Interface": {
        ParameterGroups: [
          {
            Label: { default: "Console access" },
            Parameters: [this.adminName.logicalId, this.adminEmail.logicalId],
          },

          {
            Label: { default: "Network configurations for running distributed load test Fargate tasks" },
            Parameters: [
              existingVpcId.logicalId,
              existingSubnetA.logicalId,
              existingSubnetB.logicalId,
              vpcCidrBlockCfnParameters.vpcCidrBlock.logicalId,
              vpcCidrBlockCfnParameters.subnetACidrBlock.logicalId,
              vpcCidrBlockCfnParameters.subnetBCidrBlock.logicalId,
              egressCidrBlock.logicalId,
            ],
          },
        ],
        ParameterLabels: {
          [this.adminName.logicalId]: { default: "* Administrator Name" },
          [this.adminEmail.logicalId]: { default: "* Administrator Email" },
          [deployMcpServer.logicalId]: { default: "Deploy MCP Server" },
          [existingVpcId.logicalId]: { default: "Select an existing VPC in the region" },
          [existingSubnetA.logicalId]: { default: "Select first subnet from the existing VPC" },
          [existingSubnetB.logicalId]: { default: "Select second subnet from the existing VPC" },
          [vpcCidrBlockCfnParameters.vpcCidrBlock.logicalId]: {
            default: "Provide valid CIDR block for the solution to create VPC",
          },
          [vpcCidrBlockCfnParameters.subnetACidrBlock.logicalId]: {
            default: "Provide valid CIDR block for subnet A for the solution to create VPC",
          },
          [vpcCidrBlockCfnParameters.subnetBCidrBlock.logicalId]: {
            default: "Provide valid CIDR block for subnet B for the solution to create VPC",
          },
          [egressCidrBlock.logicalId]: {
            default: "Provide CIDR block for allowing outbound traffic of AWS Fargate tasks",
          },
          [stableTagging.logicalId]: { default: "Auto-update Container Image" },
        },
      },
    };

    // CFN Rules
    // If the user enters a value for an existing VPC,
    // require the customers to fill out values for subnets A and B
    new CfnRule(this, "ExistingVPCRule", {
      ruleCondition: Fn.conditionNot(Fn.conditionEquals(existingVpcId.value, "")),
      assertions: [
        {
          assert: Fn.conditionNot(Fn.conditionEquals(existingSubnetA.value, "")),
          assertDescription:
            "If an existing VPC Id is provided, 2 subnet ids need to be provided as well. You neglected to enter the first subnet id",
        },
        {
          assert: Fn.conditionNot(Fn.conditionEquals(existingSubnetB.value, "")),
          assertDescription:
            "If an existing VPC Id is provided, 2 subnet ids need to be provided as well. You neglected to enter the second subnet id",
        },
      ],
    });

    // CFN Mappings
    const solutionMapping = new CfnMapping(this, "Solution", {
      mapping: {
        Config: {
          CodeVersion: props.solution.version,
          SolutionId: props.solution.id,
        },
      },
    });

    this.solutionId = solutionMapping.findInMap("Config", "SolutionId");
    const solutionVersion = solutionMapping.findInMap("Config", "CodeVersion");
    const mainStackRegion = Aws.REGION;

    // CFN Conditions
    const createFargateVpcResourcesCondition = new CfnCondition(this, "CreateFargateVPCResources", {
      expression: Fn.conditionEquals(existingVpcId.valueAsString, ""),
    });

    const usingExistingVpc = new CfnCondition(this, "BoolExistingVPC", {
      expression: Fn.conditionNot(Fn.conditionEquals(existingVpcId.valueAsString, "")),
    });

    const stableTagCondition = new CfnCondition(this, "UseStableTagCondition", {
      expression: Fn.conditionEquals(stableTagging.valueAsString, "Yes"),
    });
    this.stableTagConditionLogicalId = stableTagCondition.logicalId;

    const deployMcpServerCondition = new CfnCondition(this, "DeployMCPServerCondition", {
      expression: Fn.conditionEquals(deployMcpServer.valueAsString, "Yes"),
    });

    // Fargate VPC resources
    const fargateVpc = new FargateVpcConstruct(this, "DLTVpc", {
      solutionId: this.solutionId,
      subnetACidrBlock: vpcCidrBlockCfnParameters.subnetACidrBlock.valueAsString,
      subnetBCidrBlock: vpcCidrBlockCfnParameters.subnetBCidrBlock.valueAsString,
      vpcCidrBlock: vpcCidrBlockCfnParameters.vpcCidrBlock.valueAsString,
    });

    Aspects.of(fargateVpc).add(new ConditionAspect(createFargateVpcResourcesCondition));

    const fargateVpcId = Fn.conditionIf(
      createFargateVpcResourcesCondition.logicalId,
      fargateVpc.vpcId,
      existingVpcId.valueAsString
    ).toString();

    const fargateSubnetA = Fn.conditionIf(
      createFargateVpcResourcesCondition.logicalId,
      fargateVpc.subnetA,
      existingSubnetA.valueAsString
    ).toString();

    const fargateSubnetB = Fn.conditionIf(
      createFargateVpcResourcesCondition.logicalId,
      fargateVpc.subnetB,
      existingSubnetB.valueAsString
    ).toString();

    const existingVpc = Fn.conditionIf(usingExistingVpc.logicalId, true, false).toString();

    this.commonResources = new CommonResources(this, "DLTCommonResources", props.solution, props.stackType);

    // Create console construct - implemented by subclasses
    const dltConsole = this.createConsoleConstruct();

    const dltStorage = new ScenarioTestRunnerStorageConstruct(this, "DLTTestRunnerStorage", {
      s3LogsBucket: this.commonResources.s3LogsBucket,
      webAppURL: dltConsole.webAppURL,
      solutionId: this.solutionId,
    });

    // Deploy JMeter bundle for local development
    if (this.shouldBuildFromSource) {
      const jmeterBundlePath = path.join(__dirname, "../../../deployment/jmeter-assets");

      new BucketDeployment(this, "JMeterBundleDeployment", {
        sources: [Source.asset(jmeterBundlePath)],
        destinationBucket: dltStorage.scenariosBucket,
        destinationKeyPrefix: "frameworks/jmeter",
        retainOnDelete: false,
        memoryLimit: 512,
      });
    }

    // add permission and environment variables on custom resource backed lambda function
    dltStorage.scenariosBucket.grantWrite(this.commonResources.customResourceLambda.nodejsLambda);
    dltStorage.scenariosTable.grantReadWriteData(this.commonResources.customResourceLambda.nodejsLambda);
    this.commonResources.customResourceLambda.addEnvironmentVariables({
      MAIN_REGION: Aws.REGION,
      S3_BUCKET: dltStorage.scenariosBucket.bucketName,
      DDB_TABLE: dltStorage.scenariosTable.tableName,
    });

    const customResources = new CustomResourcesConstruct(
      this,
      "DLTCustomResources",
      this.commonResources.customResourceLambda.nodejsLambda
    );

    const iotEndpoint = customResources.getIotEndpoint();
    const { uuid, suffix } = customResources.uuidGenerator();

    // Update tests configured in DLT v3 that do not work in DLT v4
    customResources.backwardsCompatibilityUpdates();

    const fargateResources = new ECSResourcesConstruct(this, "DLTEcs", {
      containerMode: "hub",
      fargateVpcId,
      scenariosS3Bucket: dltStorage.scenariosBucket.bucketName,
      securityGroupEgress: egressCidrBlock.valueAsString,
      solutionId: props.solution.id,
      stableTagCondition: stableTagCondition.logicalId,
      buildFromSource: this.shouldBuildFromSource,
    });

    const realTimeDataConstruct = new RealTimeDataConstruct(this, "RealTimeData", {
      cloudWatchLogsPolicy: this.commonResources.cloudWatchLogsPolicy,
      ecsCloudWatchLogGroup: fargateResources.ecsCloudWatchLogGroup,
      iotEndpoint,
      mainRegion: Aws.REGION,
      solution: props.solution,
    });

    const stepLambdaFunctions = new TestRunnerLambdasConstruct(this, "DLTLambdaFunction", {
      cloudWatchLogsPolicy: this.commonResources.cloudWatchLogsPolicy,
      scenariosDynamoDbPolicy: dltStorage.scenarioDynamoDbPolicy,
      ecsTaskExecutionRoleArn: fargateResources.taskExecutionRoleArn,
      ecsTaskRoleArn: fargateResources.taskRoleArn,
      ecsCluster: fargateResources.taskClusterName,
      ecsTaskSecurityGroup: fargateResources.ecsSecurityGroupId,
      historyTable: dltStorage.historyTable,
      historyDynamoDbPolicy: dltStorage.historyDynamoDbPolicy,
      scenariosS3Policy: dltStorage.scenariosS3Policy,
      subnetA: fargateSubnetA,
      subnetB: fargateSubnetB,
      solution: props.solution,
      scenariosBucket: dltStorage.scenariosBucket.bucketName,
      scenariosBucketArn: dltStorage.scenariosBucket.bucketArn,
      scenariosTable: dltStorage.scenariosTable,
      uuid,
      mainStackRegion,
      ecsCloudWatchLogGroup: fargateResources.ecsCloudWatchLogGroup.logGroupName,
    });

    const taskRunnerStepFunctions = new TaskRunnerStepFunctionConstruct(this, "DLTStepFunction", {
      taskStatusChecker: stepLambdaFunctions.taskStatusChecker,
      taskRunner: stepLambdaFunctions.taskRunner,
      resultsParser: stepLambdaFunctions.resultsParser,
      testCleanup: stepLambdaFunctions.testCleanup,
      stabilizationChecker: stepLambdaFunctions.stabilizationChecker,
      startCommand: stepLambdaFunctions.startCommand,
      regionalSync: stepLambdaFunctions.regionalSync,
      metricsEmitter: stepLambdaFunctions.metricsEmitter,
      statusUpdater: stepLambdaFunctions.testStatusUpdater,
      scenariosTable: dltStorage.scenariosTable,
      historyTable: dltStorage.historyTable,
      suffix,
      solution: props.solution,
      uuid,
    });

    // ── Saved Queries (CloudWatch Logs Insights) ──
    // Creates 4 QueryDefinition resources that appear as saved queries
    // in the customer's CloudWatch console.
    const allOrchestrationLogGroups = [
      stepLambdaFunctions.taskRunnerLambdaLogGroup,
      stepLambdaFunctions.stabilizationCheckerLambdaLogGroup,
      stepLambdaFunctions.taskStatusCheckerLambdaLogGroup,
      stepLambdaFunctions.startCommandLambdaLogGroup,
      stepLambdaFunctions.testCleanupLambdaLogGroup,
      stepLambdaFunctions.taskCancelerLambdaLogGroup,
      stepLambdaFunctions.taskFailureHandlerLambdaLogGroup,
      stepLambdaFunctions.regionalSyncLambdaLogGroup,
      stepLambdaFunctions.orphanCleanupLambdaLogGroup,
      stepLambdaFunctions.sfnFailureHandlerLambdaLogGroup,
      stepLambdaFunctions.metricsEmitterLambdaLogGroup,
    ];

    new SavedQueriesConstruct(this, "DLTSavedQueries", {
      allOrchestrationLogGroups,
      taskFailureHandlerLogGroup: stepLambdaFunctions.taskFailureHandlerLambdaLogGroup,
      orphanCleanupLogGroup: stepLambdaFunctions.orphanCleanupLambdaLogGroup,
      ecsTaskLogGroup: fargateResources.ecsCloudWatchLogGroup,
    });

    // Resolve circular dependency: Orphan Cleanup needs the SFN ARN,
    // but the SFN needs Lambda ARNs. Set env vars after SFN creation.
    stepLambdaFunctions.orphanCleanup.addEnvironment(
      "STATE_MACHINE_ARN",
      taskRunnerStepFunctions.taskRunnerStepFunctions.stateMachineArn
    );

    // Task Canceler: SFN permissions + env vars (avoiding circular dependency)
    const sfnArn = taskRunnerStepFunctions.taskRunnerStepFunctions.stateMachineArn;
    const executionArnPattern = Stack.of(this).formatArn({
      service: "states",
      resource: "execution",
      resourceName: `${taskRunnerStepFunctions.taskRunnerStepFunctions.stateMachineName}:*`,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });
    stepLambdaFunctions.taskCanceler.addEnvironment("STATE_MACHINE_ARN", sfnArn);
    stepLambdaFunctions.taskCanceler.addEnvironment("UUID", uuid);
    stepLambdaFunctions.taskCanceler.addEnvironment("METRIC_URL", SOLUTIONS_METRICS_ENDPOINT);
    stepLambdaFunctions.taskCanceler.addEnvironment("AWS_ACCOUNT_ID", Aws.ACCOUNT_ID);
    stepLambdaFunctions.taskCanceler.role?.attachInlinePolicy(
      new Policy(this, "TaskCancelerSfnPolicy", {
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["states:ListExecutions"],
            resources: [sfnArn],
          }),
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["states:DescribeExecution", "states:StopExecution"],
            resources: [executionArnPattern],
          }),
        ],
      })
    );

    // SFN Failure Handler: scoped DescribeExecution (avoiding circular dependency)
    stepLambdaFunctions.sfnFailureHandler.role?.attachInlinePolicy(
      new Policy(this, "SFNFailureHandlerSfnPolicy", {
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["states:DescribeExecution"],
            resources: [executionArnPattern],
          }),
        ],
      })
    );

    // Orphan Cleanup: scoped ListExecutions permission
    stepLambdaFunctions.orphanCleanup.role?.attachInlinePolicy(
      new Policy(this, "OrphanCleanupSfnPolicy", {
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["states:ListExecutions"],
            resources: [sfnArn],
          }),
        ],
      })
    );

    // EventBridge rule: SFN execution failure → SFN Failure Handler (Layer 2 safety)
    // Created here because it needs the state machine ARN from the SFN construct.
    //
    // Only match terminal failure statuses. The previous pattern
    // `{"anything-but": "SUCCEEDED"}` also matched RUNNING and
    // PENDING_REDRIVE, causing the handler to kill healthy ECS services
    // immediately after execution start.
    //
    // Valid EventBridge status values for Step Functions executions:
    //   RUNNING | SUCCEEDED | FAILED | TIMED_OUT | ABORTED | PENDING_REDRIVE
    // @see https://docs.aws.amazon.com/step-functions/latest/dg/eventbridge-integration.html
    new Rule(this, "SFNFailureRule", {
      description: "Routes Step Function execution failures to the SFN Failure Handler for ECS cleanup",
      eventPattern: {
        source: ["aws.states"],
        detailType: ["Step Functions Execution Status Change"],
        detail: {
          status: ["FAILED", "TIMED_OUT", "ABORTED"],
          stateMachineArn: [taskRunnerStepFunctions.taskRunnerStepFunctions.stateMachineArn],
        },
      },
      targets: [new LambdaFunctionTarget(stepLambdaFunctions.sfnFailureHandler)],
    });

    const dltApi = new DLTAPI(this, "DLTApi", {
      cloudWatchLogsPolicy: this.commonResources.cloudWatchLogsPolicy,
      ecsCloudWatchLogGroup: fargateResources.ecsCloudWatchLogGroup,
      ecsTaskExecutionRoleArn: fargateResources.taskExecutionRoleArn,
      ecsTaskRoleArn: fargateResources.taskRoleArn,
      historyDynamoDbPolicy: dltStorage.historyDynamoDbPolicy,
      historyTable: dltStorage.historyTable.tableName,
      historyTableGSIName: dltStorage.historyTableGSIName,
      scenariosBucketName: dltStorage.scenariosBucket.bucketName,
      scenariosDynamoDbPolicy: dltStorage.scenarioDynamoDbPolicy,
      scenariosS3Policy: dltStorage.scenariosS3Policy,
      scenariosTableName: dltStorage.scenariosTable.tableName,
      taskCancelerArn: stepLambdaFunctions.taskCanceler.functionArn,
      taskCancelerInvokePolicy: stepLambdaFunctions.taskCancelerInvokePolicy,
      taskRunnerStepFunctionsArn: taskRunnerStepFunctions.taskRunnerStepFunctions.stateMachineArn,
      solution: props.solution,
      uuid,
    });

    const cognitoResources = new CognitoAuthConstruct(this, "DLTCognitoAuth", {
      adminEmail: this.adminEmail.valueAsString,
      adminName: this.adminName.valueAsString,
      apiId: dltApi.apiId,
      uuid,
      webAppURL: dltConsole.webAppURL,
      scenariosBucketArn: dltStorage.scenariosBucket.bucketArn,
      isConsoleHostedExternally: dltConsole.isConsoleHostedExternally,
    });

    customResources.detachIotPrincipalPolicy({
      iotPolicyName: cognitoResources.iotPolicy.ref,
    });

    // Update CloudFront CSP with the exact Cognito domain at deploy time.
    // Only applies to CloudFront-based console stacks (not ALB).
    if (dltConsole.responseHeadersPolicyId) {
      customResources.updateCloudFrontCsp({
        responseHeadersPolicyId: dltConsole.responseHeadersPolicyId,
        cognitoDomain: cognitoResources.cognitoUserPoolDomain,
      });
    }

    // Cleans up resources created for test scenarios
    customResources.cleanUpTestScenarioResources();

    // Pass exact Cognito domain to ALB+ECS container for CSP tightening.
    // The entrypoint.sh replaces the nginx.conf placeholder with this value at container start.
    if (dltConsole.webConsoleContainer) {
      dltConsole.webConsoleContainer.addEnvironment("COGNITO_DOMAIN", cognitoResources.cognitoUserPoolDomain);
    }

    // Generate web console configuration
    const awsExportsConfig = {
      userPoolId: cognitoResources.cognitoUserPoolId,
      poolClientId: cognitoResources.cognitoUserPoolClientId,
      identityPoolId: cognitoResources.cognitoIdentityPoolId,
      userPoolDomain: cognitoResources.cognitoUserPoolDomain,
      apiEndpoint: dltApi.apiEndpointPath,
      userFilesBucket: dltStorage.scenariosBucket.bucketName,
      userFilesBucketRegion: Aws.REGION,
      iotEndpoint,
      iotPolicy: cognitoResources.iotPolicy.ref,
    };

    if (dltConsole.needsWebConsoleZip) {
      // ALB/ECS and headless: package web assets + config into ZIP
      new WebUIZipConstruct(this, "WebConsoleAssets", {
        ...awsExportsConfig,
        destinationBucket: dltConsole.consoleBucket,
        destinationKey: "dlt-web-console.zip",
        solutionVersion: props.solution.version,
      });
    } else {
      // CloudFront + S3: write aws-exports.json only (assets deployed via BucketDeployment)
      new WebUIConfigConstruct(this, "WebConsoleAssets", {
        ...awsExportsConfig,
        destinationBucket: dltConsole.consoleBucket,
      });
    }

    const mcpServer = new MCPServer(this, "MCPServer", {
      api: dltApi.restApi,
      cognitoUserPool: cognitoResources.cognitoUserPool,
      scenarioBucketName: dltStorage.scenariosBucket.bucketName,
      solution: props.solution,
      userPoolId: cognitoResources.cognitoUserPoolId,
      allowedClients: [cognitoResources.cognitoUserPoolClientId],
      uuid,
    });
    Aspects.of(mcpServer).add(new ConditionAspect(deployMcpServerCondition));

    const { DIST_OUTPUT_BUCKET, SOLUTION_NAME, VERSION, PUBLIC_ECR_REGISTRY, PUBLIC_ECR_TAG } = process.env;
    if (DIST_OUTPUT_BUCKET && SOLUTION_NAME && VERSION && PUBLIC_ECR_REGISTRY && PUBLIC_ECR_TAG) {
      const sourceBucketName = Fn.join("-", [DIST_OUTPUT_BUCKET, Aws.REGION]);
      const sourceBucket = Bucket.fromBucketName(this, "SourceCodeBucket", sourceBucketName.toString());
      sourceBucket.grantReadWrite(this.commonResources.customResourceLambda.nodejsLambda);
      customResources.putRegionalTemplate({
        sourceCodeBucketName: sourceBucketName,
        regionalTemplatePrefix: `${SOLUTION_NAME}/${VERSION}`,
        scenariosBucket: dltStorage.scenariosBucket.bucketName,
        scenariosTable: dltStorage.scenariosTable.tableName,
        lambdaTaskRoleArn: stepLambdaFunctions.lambdaTaskRole.roleArn,
        mainStackRegion,
        timestamp: Date.now().toString(),
      });
      customResources.copyJMeterBundle({
        sourceCodeBucketName: sourceBucketName,
        solutionName: `${SOLUTION_NAME}/${VERSION}`,
        scenariosBucket: dltStorage.scenariosBucket.bucketName,
        timestamp: Date.now().toString(),
      });
    }

    if (!fargateResources.taskDefinitionArn) {
      throw new Error("Hub stack must have a task definition ARN");
    }

    customResources.hubTestingResourcesConfigCR({
      taskCluster: fargateResources.taskClusterName,
      ecsCloudWatchLogGroup: fargateResources.ecsCloudWatchLogGroup.logGroupName,
      taskSecurityGroup: fargateResources.ecsSecurityGroupId,
      taskDefinition: fargateResources.taskDefinitionArn,
      subnetA: fargateSubnetA,
      subnetB: fargateSubnetB,
      version: props.solution.version,
      taskRoleArn: fargateResources.taskRoleArn,
      executionRoleArn: fargateResources.taskExecutionRoleArn,
    });

    customResources.sendMetricsCR({
      existingVpc,
      solutionId: this.solutionId,
      uuid,
      solutionVersion,
      autoUpdateContainerImage: stableTagging.valueAsString,
      deployMcpServer: deployMcpServer.valueAsString,
    });

    // Metrics
    const solutionsMetrics = new SolutionsMetrics(this, "SolutionMetricsNew", { uuid });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.taskRunner.functionName,
      identifier: "TaskRunner",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: realTimeDataConstruct.realTimeDataPublisher.functionName,
      identifier: "RealTimeDataPublisher",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.resultsParser.functionName,
      identifier: "ResultsParser",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.taskCanceler.functionName,
      identifier: "TaskCanceler",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.taskStatusChecker.functionName,
      identifier: "TaskStatusChecker",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.testCleanup.functionName,
      identifier: "TestCleanup",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: this.commonResources.customResourceLambda.nodejsLambda.functionName,
      identifier: "CustomResourceLambda",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.stabilizationChecker.functionName,
      identifier: "StabilizationChecker",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.startCommand.functionName,
      identifier: "StartCommand",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.regionalSync.functionName,
      identifier: "RegionalSync",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.taskFailureHandler.functionName,
      identifier: "TaskFailureHandler",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.orphanCleanup.functionName,
      identifier: "OrphanCleanup",
    });
    solutionsMetrics.addLambdaInvocationCount({
      functionName: stepLambdaFunctions.sfnFailureHandler.functionName,
      identifier: "SFNFailureHandler",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.taskRunnerLambdaLogGroup],
      identifier: "TaskRunner",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [realTimeDataConstruct.realTimeDataPublisherLogGroup],
      identifier: "RealTimeDataPublisher",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.resultsParserLambdaLogGroup],
      identifier: "ResultsParser",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.taskCancelerLambdaLogGroup],
      identifier: "TaskCanceler",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.taskStatusCheckerLambdaLogGroup],
      identifier: "TaskStatusChecker",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.testCleanupLambdaLogGroup],
      identifier: "TestCleanup",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [dltApi.apiLambdaLogGroup],
      identifier: "ApiLambda",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.stabilizationCheckerLambdaLogGroup],
      identifier: "StabilizationChecker",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.startCommandLambdaLogGroup],
      identifier: "StartCommand",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.regionalSyncLambdaLogGroup],
      identifier: "RegionalSync",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.taskFailureHandlerLambdaLogGroup],
      identifier: "TaskFailureHandler",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.orphanCleanupLambdaLogGroup],
      identifier: "OrphanCleanup",
    });
    solutionsMetrics.addLambdaBilledDurationMemorySize({
      logGroups: [stepLambdaFunctions.sfnFailureHandlerLambdaLogGroup],
      identifier: "SFNFailureHandler",
    });
    solutionsMetrics.addDynamoDBConsumedReadCapacityUnits({
      tableName: dltStorage.scenariosTable.tableName,
      identifier: "ScenariosTable",
    });
    solutionsMetrics.addDynamoDBConsumedReadCapacityUnits({
      tableName: dltStorage.historyTable.tableName,
      identifier: "HistoryTable",
    });
    solutionsMetrics.addDynamoDBConsumedWriteCapacityUnits({
      tableName: dltStorage.scenariosTable.tableName,
      identifier: "ScenariosTable",
    });
    solutionsMetrics.addDynamoDBConsumedWriteCapacityUnits({
      tableName: dltStorage.historyTable.tableName,
      identifier: "HistoryTable",
    });
    solutionsMetrics.addECSAverageCPUUtilization({
      clusterName: fargateResources.taskClusterName,
    });
    solutionsMetrics.addECSAverageMemoryUtilization({
      clusterName: fargateResources.taskClusterName,
    });

    // Outputs
    // Only show Console URL for stacks that host the console (not externally hosted)
    if (!dltConsole.isConsoleHostedExternally) {
      new CfnOutput(this, "Console URL", {
        description: "Web portal for DLT",
        value: dltConsole.webAppURL,
      });
      new CfnOutput(this, "ConsoleResourceBucket", {
        description: "Resource Bucket for Web Portal",
        value: dltConsole.consoleBucket.bucketName,
      });
    }
    new CfnOutput(this, "SolutionUUID", {
      description: "Unique ID for deployment",
      value: uuid,
    });
    new CfnOutput(this, "SolutionTemplate", {
      description:
        "Identifies which published DLT template produced the hub stack. Consumed by the DLT console and API to render upgrade guidance.",
      value: props.solutionTemplate,
    });
    new CfnOutput(this, "ScenariosBucket", {
      description: "Common storage bucket for test scenarios",
      value: dltStorage.scenariosBucket.bucketName,
    });
    new CfnOutput(this, "ScenariosTable", {
      description: "Common table for storing load test details",
      value: dltStorage.scenariosTable.tableName,
    });
    new CfnOutput(this, "LambdaTaskRoleArn", {
      description: "Lambda task role ARN for regional deployments",
      value: stepLambdaFunctions.lambdaTaskRole.roleArn,
    });
    new CfnOutput(this, "RegionalCFTemplate", {
      description: "S3 URL for regional CloudFormation template",
      value: dltStorage.scenariosBucket.urlForObject(
        "regional-template/distributed-load-testing-on-aws-regional.template"
      ),
      exportName: `${Aws.STACK_NAME}-RegionalCFTemplate`,
    });
    new CfnOutput(this, "CognitoUserPoolID", {
      description: "Cognito User Pool ID",
      value: cognitoResources.cognitoUserPoolId,
    });
    new CfnOutput(this, "CognitoAppClientID", {
      description: "Cognito App Client ID",
      value: cognitoResources.cognitoUserPoolClientId,
    });
    new CfnOutput(this, "CognitoIdentityPoolID", {
      description: "Cognito Identity Pool ID",
      value: cognitoResources.cognitoIdentityPoolId,
    });
    new CfnOutput(this, "McpEndpoint", {
      description: "MCP Server Endpoint",
      value: mcpServer.gatewayUrl,
      condition: deployMcpServerCondition,
    });

    // Allow subclasses to add additional outputs
    this.addAdditionalOutputs(dltConsole);
  }

  /**
   * Create the console construct. Must be implemented by subclasses.
   */
  protected abstract createConsoleConstruct(): IDLTConsole;

  /**
   * Override to add additional stack outputs.
   * @param {IDLTConsole} _console - The console construct instance
   */
  protected addAdditionalOutputs(_console: IDLTConsole): void {
    // Default: no additional outputs
  }
}
