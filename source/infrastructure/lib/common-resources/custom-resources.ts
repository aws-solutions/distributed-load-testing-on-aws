// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnMapping, CustomResource, Stack } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { IBucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { CONSOLE_DOMAIN_MAPPING } from "./console-domain-mapping";

export interface ConsoleConfigProps {
  readonly apiEndpoint: string;
  readonly cognitoIdentityPool: string;
  readonly cognitoUserPool: string;
  readonly cognitoUserPoolClient: string;
  readonly consoleBucket: IBucket;
  readonly scenariosBucket: string;
  readonly iotEndpoint: string;
  readonly iotPolicy: string;
}

export interface SendMetricsCRProps {
  readonly existingVpc: string;
  readonly solutionId: string;
  readonly solutionVersion: string;
  readonly uuid: string;
  readonly autoUpdateContainerImage: string;
  readonly deployMcpServer?: string;
}

export interface SendRegionalMetricsCRProps {
  readonly solutionId: string;
  readonly solutionVersion: string;
  readonly uuid: string;
}

interface TestingResourcesConfigCRBaseProps {
  readonly taskCluster: string;
  readonly ecsCloudWatchLogGroup: string;
  readonly taskSecurityGroup: string;
  readonly subnetA: string;
  readonly subnetB: string;
  readonly version: string;
  readonly taskRoleArn: string;
  readonly executionRoleArn: string;
}

export interface HubTestingResourcesConfigCRProps extends TestingResourcesConfigCRBaseProps {
  readonly taskDefinition: string;
}

export interface RegionalTestingResourcesConfigCRProps extends TestingResourcesConfigCRBaseProps {}

export interface PutRegionalTemplateProps {
  readonly sourceCodeBucketName: string;
  readonly regionalTemplatePrefix: string;
  readonly mainStackRegion: string;
  readonly scenariosTable: string;
  readonly lambdaTaskRoleArn: string;
  readonly scenariosBucket: string;
  readonly timestamp?: string;
}

export interface CopyJMeterBundleProps {
  readonly sourceCodeBucketName: string;
  readonly solutionName: string;
  readonly scenariosBucket: string;
  readonly timestamp?: string;
}

export interface DetachIotPrincipalPolicyProps {
  readonly iotPolicyName: string;
}

export interface UpdateCspProps {
  readonly responseHeadersPolicyId: string;
  readonly cognitoDomain: string;
}

/**
 * Distributed Load Testing on AWS Custom Resources Construct.
 * It creates a custom resource Lambda function, a solution UUID, and a custom resource to send operational metrics.
 */
export class CustomResourcesConstruct extends Construct {
  private readonly customResourceLambda: NodejsFunction;

  constructor(scope: Construct, id: string, customResourceLambda: NodejsFunction) {
    super(scope, id);
    this.customResourceLambda = customResourceLambda;
  }

  private createCustomResource(
    id: string,
    customResourceFunction: NodejsFunction,
    props?: Record<string, unknown>
  ): CustomResource {
    return new CustomResource(this, id, {
      serviceToken: customResourceFunction.functionArn,
      properties: props,
    });
  }

  public getIotEndpoint() {
    const iotEndpoint = this.createCustomResource("GetIotEndpoint", this.customResourceLambda, {
      Resource: "GetIotEndpoint",
    });
    return iotEndpoint.getAtt("IOT_ENDPOINT").toString();
  }

  public detachIotPrincipalPolicy(props: DetachIotPrincipalPolicyProps) {
    this.createCustomResource("DetachIotPrincipalPolicy", this.customResourceLambda, {
      Resource: "DetachIotPolicy",
      IotPolicyName: props.iotPolicyName,
    });
  }

  public putRegionalTemplate(props: PutRegionalTemplateProps) {
    this.createCustomResource("PutRegionalTemplate", this.customResourceLambda, {
      Resource: "PutRegionalTemplate",
      SrcBucket: props.sourceCodeBucketName,
      SrcPath: props.regionalTemplatePrefix,
      DestBucket: props.scenariosBucket,
      MainRegionLambdaTaskRoleArn: props.lambdaTaskRoleArn,
      ScenariosTable: props.scenariosTable,
      MainRegionStack: props.mainStackRegion,
      Timestamp: props.timestamp,
    });
  }

  public copyJMeterBundle(props: CopyJMeterBundleProps) {
    this.createCustomResource("CopyJMeterBundle", this.customResourceLambda, {
      Resource: "CopyJMeterBundle",
      SrcBucket: props.sourceCodeBucketName,
      SrcPath: props.solutionName,
      DestBucket: props.scenariosBucket,
      Timestamp: props.timestamp,
    });
  }

  public consoleConfig(props: ConsoleConfigProps) {
    const consoleDomainMap = new CfnMapping(this, "ConsoleDomainMap", {
      mapping: CONSOLE_DOMAIN_MAPPING,
    });
    const consoleDomain = consoleDomainMap.findInMap(Aws.PARTITION, "domain");
    const awsExports = `const awsConfig = {
      aws_iot_endpoint: '${props.iotEndpoint}',
      aws_iot_policy_name: '${props.iotPolicy}',
      cw_dashboard: 'https://${consoleDomain}/cloudwatch/home?region=${Aws.REGION}#dashboards:',
      ecs_dashboard: 'https://${Aws.REGION}.${consoleDomain}/ecs/home?region=${Aws.REGION}#/clusters/${Aws.STACK_NAME}/tasks',
      aws_project_region: '${Aws.REGION}',
      aws_cognito_region: '${Aws.REGION}',
      aws_cognito_identity_pool_id: '${props.cognitoIdentityPool}',
      aws_user_pools_id: '${props.cognitoUserPool}',
      aws_user_pools_web_client_id: '${props.cognitoUserPoolClient}',
      oauth: {},
      aws_cloud_logic_custom: [
          {
              name: 'dlts',
              endpoint: '${props.apiEndpoint}',
              region: '${Aws.REGION}'
          }
      ],
      aws_user_files_s3_bucket: '${props.scenariosBucket}',
      aws_user_files_s3_bucket_region: '${Aws.REGION}',
  }`;
    this.customResourceLambda.role?.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [`${props.consoleBucket.bucketArn}/*`],
        effect: Effect.ALLOW,
      })
    ); // need put permission to upload config with deployment specific values
    this.createCustomResource("ConsoleConfig", this.customResourceLambda, {
      AwsExports: awsExports,
      DestBucket: props.consoleBucket.bucketName,
      Resource: "ConfigFile",
    });
  }

  public uuidGenerator() {
    const uuid = this.createCustomResource("CustomResourceUuid", this.customResourceLambda, {
      Resource: "UUID",
    });
    return {
      uuid: uuid.getAttString("UUID").toString(),
      suffix: uuid.getAttString("SUFFIX").toString(),
    };
  }

  public sendMetricsCR(props: SendMetricsCRProps) {
    this.customResourceLambda.role?.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: [Aws.STACK_ID],
        effect: Effect.ALLOW,
      })
    );
    this.createCustomResource("Metric", this.customResourceLambda, {
      existingVPC: props.existingVpc,
      Region: Aws.REGION,
      Resource: "Metric",
      SolutionId: props.solutionId,
      UUID: props.uuid,
      Version: props.solutionVersion,
      AccountId: Aws.ACCOUNT_ID,
      AutoUpdateContainerImage: props.autoUpdateContainerImage,
      DeployMcpServer: props.deployMcpServer,
    });
  }

  public sendRegionalMetricsCR(props: SendRegionalMetricsCRProps) {
    this.createCustomResource("RegionalMetric", this.customResourceLambda, {
      Region: Aws.REGION,
      Resource: "Metric",
      SolutionId: props.solutionId,
      UUID: props.uuid,
      Version: props.solutionVersion,
      AccountId: Aws.ACCOUNT_ID,
      StackType: "regional",
    });
  }

  public hubTestingResourcesConfigCR(props: HubTestingResourcesConfigCRProps) {
    this.createCustomResource("TestingResourcesConfig", this.customResourceLambda, {
      TestingResourcesConfig: {
        region: Aws.REGION,
        subnetA: props.subnetA,
        subnetB: props.subnetB,
        ecsCloudWatchLogGroup: props.ecsCloudWatchLogGroup,
        taskSecurityGroup: props.taskSecurityGroup,
        taskDefinition: props.taskDefinition,
        taskCluster: props.taskCluster,
        version: props.version,
        stackId: Aws.STACK_ID,
        taskRoleArn: props.taskRoleArn,
        executionRoleArn: props.executionRoleArn,
      },
      Resource: "TestingResourcesConfigFile",
    });
  }

  public regionalTestingResourcesConfigCR(props: RegionalTestingResourcesConfigCRProps) {
    this.createCustomResource("TestingResourcesConfig", this.customResourceLambda, {
      TestingResourcesConfig: {
        region: Aws.REGION,
        subnetA: props.subnetA,
        subnetB: props.subnetB,
        ecsCloudWatchLogGroup: props.ecsCloudWatchLogGroup,
        taskSecurityGroup: props.taskSecurityGroup,
        taskCluster: props.taskCluster,
        version: props.version,
        stackId: Aws.STACK_ID,
        taskRoleArn: props.taskRoleArn,
        executionRoleArn: props.executionRoleArn,
      },
      Resource: "TestingResourcesConfigFile",
    });
  }

  /**
   * Executes Backwards compatibility updates in a CustomResource
   * This is to fix v3 -> v4 compatibility issues where configured tests are broken
   * The CustomResource will only update tests with invalid configurations
   */
  public backwardsCompatibilityUpdates() {
    // Grant permission to ListRules for all available rules
    this.customResourceLambda.role?.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["events:ListRules"],
        resources: [
          Stack.of(this).formatArn({
            service: "events",
            resource: "rule",
            // ListRules does not support resource-level permissions per AWS IAM docs
            // See: https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazoneventbridge.html
            resourceName: "*",
          }),
        ],
        effect: Effect.ALLOW,
      })
    );
    // Grant permission to PutTargets and ListTargetsByRule for rules created by DLT
    // specified by the suffix Create and Scheduled
    this.customResourceLambda.role?.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["events:PutTargets", "events:ListTargetsByRule"],
        resources: [
          Stack.of(this).formatArn({
            service: "events",
            resource: "rule",
            resourceName: "*Create",
          }),
          Stack.of(this).formatArn({
            service: "events",
            resource: "rule",
            resourceName: "*Scheduled",
          }),
        ],
        effect: Effect.ALLOW,
      })
    );
    this.createCustomResource("BackwardsCompatibilityUpdateV3toV4", this.customResourceLambda, {
      Resource: "V3toV4BackCompat",
    });
  }

  /**
   * Creates a custom resource that updates the CloudFront ResponseHeadersPolicy CSP
   * to add the exact Cognito domain at deploy time.
   */
  public updateCloudFrontCsp(props: UpdateCspProps) {
    // Grant CloudFront permissions scoped to the specific ResponseHeadersPolicy
    // CloudFront RHP ARNs are global (no region): arn:{partition}:cloudfront::{account}:response-headers-policy/{id}
    this.customResourceLambda.role?.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["cloudfront:GetResponseHeadersPolicy", "cloudfront:UpdateResponseHeadersPolicy"],
        resources: [
          `arn:${Aws.PARTITION}:cloudfront::${Aws.ACCOUNT_ID}:response-headers-policy/${props.responseHeadersPolicyId}`,
        ],
        effect: Effect.ALLOW,
      })
    );

    this.createCustomResource("UpdateCloudFrontCsp", this.customResourceLambda, {
      Resource: "UpdateCsp",
      ResponseHeadersPolicyId: props.responseHeadersPolicyId,
      CognitoDomain: props.cognitoDomain,
    });
  }

  /**
   * Creates a custom resource that cleans up resources that aren't directly owned
   * by the CloudFormation stack because they are created by test scenarios.
   */
  public cleanUpTestScenarioResources() {
    // Grant permission to DeleteSchedule on EventBridge scheduler for rules created
    // by DLT specified by the suffix Create and Scheduled
    this.customResourceLambda.role?.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["scheduler:DeleteSchedule"],
        resources: [
          Stack.of(this).formatArn({
            service: "scheduler",
            resource: "schedule",
            resourceName: "default/*Create",
          }),
          Stack.of(this).formatArn({
            service: "scheduler",
            resource: "schedule",
            resourceName: "default/*Scheduled",
          }),
        ],
        effect: Effect.ALLOW,
      })
    );

    this.createCustomResource("CleanUpTestScenarios", this.customResourceLambda, {
      Resource: "CleanUpTestScenarios",
    });
  }
}
