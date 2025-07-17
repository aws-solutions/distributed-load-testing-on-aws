// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnCondition, CfnCustomResource, CustomResource } from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { IBucket } from "aws-cdk-lib/aws-s3";

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
}

export interface PutRegionalTemplateProps {
  readonly sourceCodeBucketName: string;
  readonly regionalTemplatePrefix: string;
  readonly mainStackRegion: string;
  readonly scenariosTable: string;
  readonly lambdaTaskRoleArn: string;
  readonly scenariosBucket: string;
}
export interface DetachIotPrincipalPolicyProps {
  readonly iotPolicyName: string;
}

/**
 * Distributed Load Testing on AWS Custom Resources Construct.
 * It creates a custom resource Lambda function, a solution UUID, and a custom resource to send anonymized usage.
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

  public sendAnonymizedMetricsCR(props: SendAnonymizedMetricsCRProps) {
    const sendAnonymizedMetrics = this.createCustomResource("AnonymizedMetric", this.customResourceLambda, {
      existingVPC: props.existingVpc,
      Region: Aws.REGION,
      Resource: "AnonymizedMetric",
      SolutionId: props.solutionId,
      UUID: props.uuid,
      Version: props.solutionVersion,
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
    this.createCustomResource("TestingResourcesConfig", this.customResourceLambda, {
      TestingResourcesConfig: testingResourcesConfig,
      Resource: "TestingResourcesConfigFile",
    });
  }
}
