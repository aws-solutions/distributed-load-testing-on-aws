// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Aspects,
  Aws,
  CfnCondition,
  CfnMapping,
  CfnParameter,
  CfnResource,
  Construct,
  Fn,
  IAspect,
  IConstruct,
  StackProps,
  Stack,
  CfnOutput
} from '@aws-cdk/core';
import { CognitoAuthConstruct } from './auth';
import { CommonResourcesContruct } from './common-resources';
import { FargateECSTestRunnerContruct } from './ecs';
import { FargateVpcContruct } from './vpc';
import { ScenarioTestRunnerStorageContruct } from './scenarios-storage';
import { DLTConsoleContruct } from './console';
import { CustomResourcesConstruct } from './custom-resources';
import { DLTAPI } from './api';
import { TestRunnerLambdasConstruct } from './test-task-lambdas';
import { TaskRunnerStepFunctionConstruct } from './step-functions';

/**
 * CDK Aspect implementation to set up conditions to the entire Construct resources
 */
class ConditionAspect implements IAspect {
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
 * Distributed Load Testing on AWS main CDK Stack
 * @class
 */
export class DLTStack extends Stack {
  // VPC ID
  private fargateVpcId: string;
  // Subnets for Fargate tasks
  private fargateSubnetA: string;
  private fargateSubnetB: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // CFN template format version
    this.templateOptions.templateFormatVersion = '2010-09-09';

    // CFN Parameters
    // Admin name
    const adminName = new CfnParameter(this, 'AdminName', {
      type: 'String',
      description: 'Admin user name to access the Distributed Load Testing console',
      minLength: 4,
      maxLength: 20,
      allowedPattern: '[a-zA-Z0-9-]+',
      constraintDescription: "Admin username must be a minimum of 4 characters and cannot include spaces"
    });

    // Admin email
    const adminEmail = new CfnParameter(this, 'AdminEmail', {
      type: 'String',
      description: 'Admin user email address to access the Distributed Load Testing Console',
      allowedPattern: '^[_A-Za-z0-9-\\+]+(\\.[_A-Za-z0-9-]+)*@[A-Za-z0-9-]+(\\.[A-Za-z0-9]+)*(\\.[A-Za-z]{2,})$',
      constraintDescription: 'Admin email must be a valid email address',
      minLength: 5
    });

    // Existing VPC ID
    const existingVpcId = new CfnParameter(this, 'ExistingVPCId', {
      type: 'String',
      description: 'Existing VPC ID',
      allowedPattern: '(?:^$|^vpc-[a-zA-Z0-9-]+)',
    });

    const existingSubnetA = new CfnParameter(this, 'ExistingSubnetA', {
      type: 'String',
      description: 'First existing subnet',
      allowedPattern: '(?:^$|^subnet-[a-zA-Z0-9-]+)'
    });

    const existingSubnetB = new CfnParameter(this, 'ExistingSubnetB', {
      type: 'String',
      description: 'Second existing subnet',
      allowedPattern: '(?:^$|^subnet-[a-zA-Z0-9-]+)'
    });

    // VPC CIDR Block
    const vpcCidrBlock = new CfnParameter(this, 'VpcCidrBlock', {
      type: 'String',
      default: '192.168.0.0/16',
      description: 'CIDR block of the new VPC where AWS Fargate will be placed',
      allowedPattern: '(?:^$|(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2}))',
      constraintDescription: 'The VPC CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.',
      minLength: 9,
      maxLength: 18
    });

    // Subnet A CIDR Block
    const subnetACidrBlock = new CfnParameter(this, 'SubnetACidrBlock', {
      type: 'String',
      default: '192.168.0.0/20',
      description: 'CIDR block for subnet A of the AWS Fargate VPC',
      allowedPattern: '(?:^$|(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2}))',
      constraintDescription: 'The subnet CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.',
      minLength: 9,
      maxLength: 18
    });

    // Subnet B CIDR Block
    const subnetBCidrBlock = new CfnParameter(this, 'SubnetBCidrBlock', {
      type: 'String',
      default: '192.168.16.0/20',
      description: 'CIDR block for subnet B of the AWS Fargate VPC',
      allowedPattern: '(?:^$|(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2}))',
      constraintDescription: 'The subnet CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.'
    });

    // Egress CIDR Block
    const egressCidrBlock = new CfnParameter(this, 'EgressCidr', {
      type: 'String',
      default: '0.0.0.0/0',
      description: 'CIDR Block to restrict the ECS container outbound access',
      minLength: 9,
      maxLength: 18,
      allowedPattern: '(?:^$|(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})/(\\d{1,2}))',
      constraintDescription: 'The Egress CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.'
    });

    // CloudFormation metadata
    this.templateOptions.metadata = {
      'AWS::CloudFormation::Interface': {
        ParameterGroups: [
          {
            Label: { default: 'Console access' },
            Parameters: [adminName.logicalId, adminEmail.logicalId]
          },
          {
            Label: { default: 'Enter values here to use your own existing VPC' },
            Parameters: [existingVpcId.logicalId, existingSubnetA.logicalId, existingSubnetB.logicalId]
          },
          {
            Label: { default: 'Or have the solution create a new AWS Fargate VPC' },
            Parameters: [vpcCidrBlock.logicalId, subnetACidrBlock.logicalId, subnetBCidrBlock.logicalId, egressCidrBlock.logicalId]
          }
        ],
        ParameterLabels: {
          [adminName.logicalId]: { default: '* Console Administrator Name' },
          [adminEmail.logicalId]: { default: '* Console Administrator Email' },
          [existingVpcId.logicalId]: { default: 'The ID of an existing VPC in this region. Ex: `vpc-1a2b3c4d5e6f`' },
          [existingSubnetA.logicalId]: { default: 'The ID of a subnet within the existing VPC. Ex: `subnet-7h8i9j0k`' },
          [existingSubnetB.logicalId]: { default: 'The ID of a subnet within the existing VPC. Ex: `subnet-1x2y3z`' },
          [vpcCidrBlock.logicalId]: { default: 'AWS Fargate VPC CIDR Block' },
          [subnetACidrBlock.logicalId]: { default: 'AWS Fargate Subnet A CIDR Block' },
          [subnetBCidrBlock.logicalId]: { default: 'AWS Fargate Subnet A CIDR Block' },
          [egressCidrBlock.logicalId]: { default: 'AWS Fargate SecurityGroup CIDR Block' }
        }
      }
    };

    // CFN Mappings
    const solutionMapping = new CfnMapping(this, 'Solution', {
      mapping: {
        Config: {
          CodeVersion: 'CODE_VERSION',
          KeyPrefix: 'SOLUTION_NAME/CODE_VERSION',
          S3Bucket: 'CODE_BUCKET',
          SendAnonymousUsage: 'Yes',
          SolutionId: 'SO0062',
          URL: 'https://metrics.awssolutionsbuilder.com/generic'
        }
      }
    });
    const sendAnonymousUsage = solutionMapping.findInMap('Config', 'SendAnonymousUsage');
    const solutionId = solutionMapping.findInMap('Config', 'SolutionId');
    const solutionVersion = solutionMapping.findInMap('Config', 'CodeVersion');
    const sourceCodeBucket = Fn.join('-', [solutionMapping.findInMap('Config', 'S3Bucket'), Aws.REGION]);
    const sourceCodePrefix = solutionMapping.findInMap('Config', 'KeyPrefix');
    const metricsUrl = solutionMapping.findInMap('Config', 'URL');

    // CFN Conditions
    const sendAnonymousUsageCondition = new CfnCondition(this, 'SendAnonymousUsage', {
      expression: Fn.conditionEquals(sendAnonymousUsage, 'Yes')
    });

    const createFargateVpcResourcesCondition = new CfnCondition(this, 'CreateFargateVPCResources', {
      expression: Fn.conditionEquals(existingVpcId.valueAsString, '')
    });

    const usingExistingVpc = new CfnCondition(this, 'BoolExistingVPC', {
      expression: Fn.conditionNot(Fn.conditionEquals(existingVpcId.valueAsString, ''))
    });

    // Fargate VPC resources  
    const fargate = new FargateVpcContruct(this, 'DLTVpc', {
      solutionId: solutionId,
      subnetACidrBlock: subnetACidrBlock.valueAsString,
      subnetBCidrBlock: subnetBCidrBlock.valueAsString,
      vpcCidrBlock: vpcCidrBlock.valueAsString,
    });
    Aspects.of(fargate).add(new ConditionAspect(createFargateVpcResourcesCondition));
    this.fargateVpcId = Fn.conditionIf(createFargateVpcResourcesCondition.logicalId,
      fargate.DLTfargateVpcId,
      existingVpcId.valueAsString
    ).toString();

    this.fargateSubnetA = Fn.conditionIf(createFargateVpcResourcesCondition.logicalId,
      fargate.subnetA,
      existingSubnetA.valueAsString
    ).toString();

    this.fargateSubnetB = Fn.conditionIf(createFargateVpcResourcesCondition.logicalId,
      fargate.subnetB,
      existingSubnetB.valueAsString
    ).toString();

    // Fargate ECS resources
    const fargateECSResources = new FargateECSTestRunnerContruct(this, 'DLTEcs', {
      DLTfargateVpcId: this.fargateVpcId,
      securityGroupEgress: egressCidrBlock.valueAsString,
      solutionId: solutionId,
    });
    const existingVpc = Fn.conditionIf(usingExistingVpc.logicalId, true, false).toString();
    const commonResources = new CommonResourcesContruct(this, 'DLTCommonResources', {
      dltEcsTaskExecutionRole: fargateECSResources.dltTaskExecutionRole,
      solutionId: solutionId,
      sourceCodeBucket,
      sourceCodePrefix,
      solutionVersion,
      sendAnonymousUsageCondition,
      existingVpc,
      metricsUrl
    });

    const dltConsole = new DLTConsoleContruct(this, 'DLTConsoleResources', {
      customResource: commonResources.customResourceLambda,
      s3LogsBucket: commonResources.s3LogsBucket,
      solutionId: solutionId
    });

    const dltStorage = new ScenarioTestRunnerStorageContruct(this, 'DLTTestRunnerStorage', {
      ecsTaskExecutionRole: fargateECSResources.dltTaskExecutionRole,
      s3LogsBucket: commonResources.s3LogsBucket,
      cloudFrontDomainName: dltConsole.cloudFrontDomainName,
      solutionId,
    });

    const stepLambdaFunctions = new TestRunnerLambdasConstruct(this, 'DLTLambdaFunction', {
      cloudWatchLogsPolicy: commonResources.cloudWatchLogsPolicy,
      dynamoDbPolicy: dltStorage.dynamoDbPolicy,
      ecsTaskExecutionRoleArn: fargateECSResources.dltTaskExecutionRole.roleArn,
      ecsCloudWatchLogGroup: fargateECSResources.dltCloudWatchLogGroup,
      ecsCluster: fargateECSResources.dltEcsClusterName,
      ecsTaskDefinition: fargateECSResources.dltTaskDefinitionArn,
      ecsTaskSecurityGroup: fargateECSResources.dltSecurityGroupId,
      scenariosS3Policy: dltStorage.scenariosS3Policy,
      subnetA: this.fargateSubnetA,
      subnetB: this.fargateSubnetB,
      metricsUrl,
      sendAnonymousUsage,
      solutionId,
      solutionVersion,
      sourceCodeBucket: commonResources.sourceBucket,
      sourceCodePrefix,
      testScenariosBucket: dltStorage.scenariosBucket.bucketName,
      testScenariosTable: dltStorage.scenariosTable,
      uuid: commonResources.uuid,
    })

    const taskRunnerStepFunctions = new TaskRunnerStepFunctionConstruct(this, 'DLTStepFunction', {
      taskStatusChecker: stepLambdaFunctions.taskStatusChecker,
      taskRunner: stepLambdaFunctions.taskRunner,
      resultsParser: stepLambdaFunctions.resultsParser,
      taskCanceler: stepLambdaFunctions.taskCanceler,
      solutionId
    });

    const dltApi = new DLTAPI(this, 'DLTApi', {
      ecsCloudWatchLogGroup: fargateECSResources.dltCloudWatchLogGroup,
      cloudWatchLogsPolicy: commonResources.cloudWatchLogsPolicy,
      dynamoDbPolicy: dltStorage.dynamoDbPolicy,
      taskCancelerInvokePolicy: stepLambdaFunctions.taskCancelerInvokePolicy,
      scenariosBucketName: dltStorage.scenariosBucket.bucketName,
      scenariosS3Policy: dltStorage.scenariosS3Policy,
      scenariosTableName: dltStorage.scenariosTable.tableName,
      ecsCuster: fargateECSResources.dltEcsClusterName,
      ecsTaskExecutionRoleArn: fargateECSResources.dltTaskExecutionRole.roleArn,
      taskRunnerStepFunctionsArn: taskRunnerStepFunctions.taskRunnerStepFunctions.stateMachineArn,
      tastCancelerArn: stepLambdaFunctions.taskCanceler.functionArn,
      metricsUrl,
      sendAnonymousUsage,
      solutionId,
      solutionVersion,
      sourceCodeBucket: commonResources.sourceBucket,
      sourceCodePrefix,
      uuid: commonResources.uuid
    });

    const cognitoResources = new CognitoAuthConstruct(this, 'DLTCognitoAuth', {
      adminEmail: adminEmail.valueAsString,
      adminName: adminName.valueAsString,
      apiId: dltApi.apiId,
      cloudFrontDomainName: dltConsole.cloudFrontDomainName,
      scenariosBucketArn: dltStorage.scenariosBucket.bucketArn,
    });

    new CustomResourcesConstruct(this, 'DLTCustomResources', {
      apiEndpoint: dltApi.apiEndpointPath,
      customResourceLambda: commonResources.customResourceLambda.functionArn,
      cognitoIdentityPool: cognitoResources.cognitoIdentityPoolId,
      cognitoUserPool: cognitoResources.cognitoUserPoolId,
      cognitoUserPoolClient: cognitoResources.cognitoUserPoolClientId,
      consoleBucketName: dltConsole.consoleBucket.bucketName,
      scenariosBucket: dltStorage.scenariosBucket.bucketName,
      sourceCodeBucketName: commonResources.sourceBucket.bucketName,
      sourceCodePrefix
    });

    //Outputs
    new CfnOutput(this, 'Console', {
      description: 'Console URL',
      value: dltConsole.cloudFrontDomainName
    });
    new CfnOutput(this, 'SolutionUUID', {
      description: 'Solution UUID',
      value: commonResources.uuid
    })
  }
}
