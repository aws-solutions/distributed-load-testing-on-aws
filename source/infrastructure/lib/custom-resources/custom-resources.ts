// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnCondition, CfnCustomResource, CustomResource } from "aws-cdk-lib";
import { Construct } from "constructs";

export interface ConsoleConfigProps {
  readonly apiEndpoint: string;
  readonly cognitoIdentityPool: string;
  readonly cognitoUserPool: string;
  readonly cognitoUserPoolClient: string;
  readonly consoleBucketName: string;
  readonly scenariosBucket: string;
  readonly sourceCodeBucketName: string;
  readonly sourceCodePrefix: string;
  readonly iotEndpoint: string;
  readonly iotPolicy: string;
}

export interface CopyConsoleFilesProps {
  readonly consoleBucketName: string;
  readonly scenariosBucket: string;
  readonly sourceCodeBucketName: string;
  readonly sourceCodePrefix: string;
}

export interface SendAnonymizedMetricsCRProps {
  readonly existingVpc: string;
  readonly sendAnonymizedUsage: string;
  readonly sendAnonymizedUsageCondition: CfnCondition;
  readonly solutionId: string;
  readonly solutionVersion: string;
  readonly uuid: string;
}

export interface TestingResourcesConfigCRProps {
  readonly taskCluster: string;
  readonly ecsCloudWatchLogGroup: string;
  readonly taskSecurityGroup: string;
  readonly taskDefinition: string;
  readonly subnetA: string;
  readonly subnetB: string;
  readonly uuid: string;
}

export interface PutRegionalTemplateProps {
  readonly sourceCodeBucketName: string;
  readonly regionalTemplatePrefix: string;
  readonly mainStackRegion: string;
  readonly apiServicesLambdaRoleName: string;
  readonly resultsParserRoleName: string;
  readonly scenariosBucket: string;
  readonly scenariosTable: string;
  readonly taskRunnerRoleName: string;
  readonly taskCancelerRoleName: string;
  readonly taskStatusCheckerRoleName: string;
  readonly uuid: string;
}

export interface DetachIotPrincipalPolicyProps {
  readonly iotPolicyName: string;
}

export interface CustomResourcesConstructProps {
  readonly customResourceLambdaArn: string;
}

/**
 * Distributed Load Testing on AWS Custom Resources Construct.
 * It creates a custom resource Lambda function, a solution UUID, and a custom resource to send anonymized usage.
 */
export class CustomResourcesConstruct extends Construct {
  private customResourceLambdaArn: string;

  constructor(scope: Construct, id: string, props: CustomResourcesConstructProps) {
    super(scope, id);
    this.customResourceLambdaArn = props.customResourceLambdaArn;
  }

  private createCustomResource(
    id: string,
    customResourceFunctionArn: string,
    props?: Record<string, unknown>
  ): CustomResource {
    return new CustomResource(this, id, {
      serviceToken: customResourceFunctionArn,
      properties: props,
    });
  }

  public getIotEndpoint() {
    const iotEndpoint = this.createCustomResource("GetIotEndpoint", this.customResourceLambdaArn, {
      Resource: "GetIotEndpoint",
    });
    return iotEndpoint.getAtt("IOT_ENDPOINT").toString();
  }

  public detachIotPrincipalPolicy(props: DetachIotPrincipalPolicyProps) {
    this.createCustomResource("DetachIotPrincipalPolicy", this.customResourceLambdaArn, {
      Resource: "DetachIotPolicy",
      IotPolicyName: props.iotPolicyName,
    });
  }

  public putRegionalTemplate(props: PutRegionalTemplateProps) {
    this.createCustomResource("PutRegionalTemplate", this.customResourceLambdaArn, {
      Resource: "PutRegionalTemplate",
      SrcBucket: props.sourceCodeBucketName,
      SrcPath: props.regionalTemplatePrefix,
      DestBucket: props.scenariosBucket,
      APIServicesLambdaRoleName: props.apiServicesLambdaRoleName,
      MainStackRegion: props.mainStackRegion,
      ResultsParserRoleName: props.resultsParserRoleName,
      ScenariosTable: props.scenariosTable,
      TaskRunnerRoleName: props.taskRunnerRoleName,
      TaskCancelerRoleName: props.taskCancelerRoleName,
      TaskStatusCheckerRoleName: props.taskStatusCheckerRoleName,
      Uuid: props.uuid,
    });
  }

  public copyConsoleFiles(props: CopyConsoleFilesProps) {
    this.createCustomResource("CopyConsoleFiles", this.customResourceLambdaArn, {
      DestBucket: props.consoleBucketName,
      ManifestFile: "console-manifest.json",
      Resource: "CopyAssets",
      SrcBucket: props.sourceCodeBucketName,
      SrcPath: `${props.sourceCodePrefix}/console`,
    });
  }

  public consoleConfig(props: ConsoleConfigProps) {
    const awsExports = `const awsConfig = {
      aws_iot_endpoint: '${props.iotEndpoint}',
      aws_iot_policy_name: '${props.iotPolicy}',
      cw_dashboard: 'https://console.aws.amazon.com/cloudwatch/home?region=${Aws.REGION}#dashboards:',
      ecs_dashboard: 'https://${Aws.REGION}.console.aws.amazon.com/ecs/home?region=${Aws.REGION}#/clusters/${Aws.STACK_NAME}/tasks',
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
    this.createCustomResource("ConsoleConfig", this.customResourceLambdaArn, {
      AwsExports: awsExports,
      DestBucket: props.consoleBucketName,
      Resource: "ConfigFile",
    });
  }

  public uuidGenerator() {
    const uuid = this.createCustomResource("CustomResourceUuid", this.customResourceLambdaArn, {
      Resource: "UUID",
    });
    return {
      uuid: uuid.getAttString("UUID").toString(),
      suffix: uuid.getAttString("SUFFIX").toString(),
    };
  }

  public sendAnonymizedMetricsCR(props: SendAnonymizedMetricsCRProps) {
    const sendAnonymizedMetrics = this.createCustomResource("AnonymizedMetric", this.customResourceLambdaArn, {
      existingVPC: props.existingVpc,
      Region: Aws.REGION,
      Resource: "AnonymizedMetric",
      SolutionId: props.solutionId,
      UUID: props.uuid,
      VERSION: props.solutionVersion,
    });
    const cfnSendAnonymizedMetrics = sendAnonymizedMetrics.node.defaultChild as CfnCustomResource;
    cfnSendAnonymizedMetrics.cfnOptions.condition = props.sendAnonymizedUsageCondition;
  }

  public testingResourcesConfigCR(props: TestingResourcesConfigCRProps) {
    const testingResourcesConfig = {
      region: Aws.REGION,
      subnetA: props.subnetA,
      subnetB: props.subnetB,
      ecsCloudWatchLogGroup: props.ecsCloudWatchLogGroup,
      taskSecurityGroup: props.taskSecurityGroup,
      taskDefinition: props.taskDefinition,
      taskImage: `${Aws.STACK_NAME}-load-tester`,
      taskCluster: props.taskCluster,
    };
    this.createCustomResource("TestingResourcesConfig", this.customResourceLambdaArn, {
      TestingResourcesConfig: testingResourcesConfig,
      Resource: "TestingResourcesConfigFile",
      Uuid: props.uuid,
    });
  }
}
