// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnResource, Fn, RemovalPolicy, Stack, Tags, CfnCondition } from "aws-cdk-lib";
import {
  BlockPublicAccess,
  Bucket,
  BucketAccessControl,
  BucketEncryption,
  IBucket,
  ObjectOwnership,
} from "aws-cdk-lib/aws-s3";
import { AnyPrincipal, Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import * as appreg from "@aws-cdk/aws-servicecatalogappregistry-alpha";
import { Construct } from "constructs";
import {
  CfnResourceAssociation,
  CfnApplication,
  CfnAttributeGroup,
  CfnAttributeGroupAssociation,
} from "aws-cdk-lib/aws-servicecatalogappregistry";

export interface CommonResourcesConstructProps {
  readonly sourceCodeBucket: string;
}

export interface AppRegistryApplicationProps {
  readonly description: string;
  readonly stackType: string;
  readonly solutionId: string;
  readonly applicationName: string;
  readonly solutionVersion: string;
}

/**
 * Distributed Load Testing on AWS common resources construct.
 * Creates a CloudWatch logs policy and an S3 bucket to store logs.
 */
export class CommonResourcesConstruct extends Construct {
  // CloudWatch logs Policy
  public cloudWatchLogsPolicy: Policy;
  // Code S3 Bucket
  public sourceBucket: IBucket;

  constructor(scope: Construct, id: string, props: CommonResourcesConstructProps) {
    super(scope, id);

    const logGroupResourceArn = Stack.of(this).formatArn({
      service: "logs",
      resource: "log-group:",
      resourceName: "aws/lambda/*",
    });
    this.cloudWatchLogsPolicy = new Policy(this, "CloudWatchLogsPolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
          resources: [logGroupResourceArn],
        }),
      ],
    });

    this.sourceBucket = Bucket.fromBucketName(this, "SourceCodeBucket", props.sourceCodeBucket);
  }

  public s3LogsBucket(): Bucket {
    const logsBucket = new Bucket(this, "LogsBucket", {
      accessControl: BucketAccessControl.LOG_DELIVERY_WRITE,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      enforceSSL: true,
      versioned: true,
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
    });

    logsBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ["s3:*"],
        conditions: {
          Bool: { "aws:SecureTransport": "false" },
        },
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        resources: [logsBucket.bucketArn, logsBucket.arnForObjects("*")],
      })
    );

    const s3LogsBucketResource = logsBucket.node.defaultChild as CfnResource;
    s3LogsBucketResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W35",
          reason: "This is the logging bucket, it does not require logging.",
        },
        {
          id: "W51",
          reason: "Since the bucket does not allow the public access, it does not require to have bucket policy.",
        },
      ],
    });
    return logsBucket;
  }

  public appRegistryApplication(props: AppRegistryApplicationProps) {
    const stack = Stack.of(this);
    const applicationType = "AWS-Solutions";
    const solutionName = "Distributed Load Testing";

    const application = new appreg.Application(stack, "AppRegistry", {
      applicationName: Fn.join("-", [props.applicationName, Aws.REGION, Aws.ACCOUNT_ID]),
      description: `Service Catalog application to track and manage all your resources for the solution ${solutionName}`,
    });
    application.associateApplicationWithStack(stack);

    Tags.of(application).add("Solutions:SolutionID", props.solutionId);
    Tags.of(application).add("Solutions:SolutionName", solutionName);
    Tags.of(application).add("Solutions:SolutionVersion", props.solutionVersion);
    Tags.of(application).add("Solutions:ApplicationType", applicationType);

    const attributeGroup = new appreg.AttributeGroup(stack, "DefaultApplicationAttributes", {
      attributeGroupName: Aws.STACK_NAME,
      description: "Attribute group for solution information",
      attributes: {
        applicationType,
        version: props.solutionVersion,
        solutionID: props.solutionId,
        solutionName,
      },
    });
    attributeGroup.associateWith(application);
    // Add hard-coded conditions to the AppRegistry resources
    // These can be later on changed by users if they failed to update the
    // Stack due to change of AppRegistry resources logical Id
    this.addConditions(stack, [
      CfnApplication,
      CfnAttributeGroup,
      CfnAttributeGroupAssociation,
      CfnResourceAssociation,
    ]);
  }

  private addConditions(stack: Stack, resourceTypes: Array<any>) {
    const createAppCondition = new CfnCondition(this, "AppRegistryCondition", {
      expression: Fn.conditionEquals("true", "true"),
    });

    const visit = (node: Construct) => {
      for (const resourceType of resourceTypes) {
        if (node instanceof resourceType) {
          (node as CfnResource).cfnOptions.condition = createAppCondition;
        }
      }
      for (const child of node.node.children) {
        visit(child as Construct);
      }
    };
    visit(stack);
  }
}
