// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table, TableEncryption } from "aws-cdk-lib/aws-dynamodb";
import { AnyPrincipal, Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface ScenarioTestRunnerStorageConstructProps {
  // S3 Logs Bucket
  readonly s3LogsBucket: Bucket;
  // CloudFront domain name
  readonly cloudFrontDomainName: string;
  // Solution Id
  readonly solutionId: string;
}

/**
 * Distributed Load Testing storage construct
 * Creates an S3 bucket to store test scenarios and
 * a Dynamodb table to store tests and test configuration
 */
export class ScenarioTestRunnerStorageConstruct extends Construct {
  public scenariosBucket: Bucket;
  public scenariosS3Policy: Policy;
  public scenariosTable: Table;
  public scenarioDynamoDbPolicy: Policy;
  public historyTable: Table;
  public historyDynamoDbPolicy: Policy;

  constructor(scope: Construct, id: string, props: ScenarioTestRunnerStorageConstructProps) {
    super(scope, id);

    this.scenariosBucket = new Bucket(this, "DLTScenariosBucket", {
      removalPolicy: RemovalPolicy.RETAIN,
      serverAccessLogsBucket: props.s3LogsBucket,
      serverAccessLogsPrefix: "scenarios-bucket-access/",
      encryption: BucketEncryption.KMS_MANAGED,
      enforceSSL: true,
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [HttpMethods.GET, HttpMethods.POST, HttpMethods.PUT],
          allowedOrigins: [`https://${props.cloudFrontDomainName}`],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
        },
      ],
    });

    this.scenariosBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ["s3:*"],
        resources: [this.scenariosBucket.bucketArn, `${this.scenariosBucket.bucketArn}/*`],
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        conditions: {
          Bool: {
            "aws:SecureTransport": false,
          },
        },
      })
    );

    this.scenariosS3Policy = new Policy(this, "ScenariosS3Policy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["s3:HeadObject", "s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
          resources: [this.scenariosBucket.bucketArn, `${this.scenariosBucket.bucketArn}/*`],
        }),
      ],
    });

    this.scenariosTable = new Table(this, "DLTScenariosTable", {
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      partitionKey: { name: "testId", type: AttributeType.STRING },
      pointInTimeRecovery: true,
    });

    this.historyTable = new Table(this, "DLTHistoryTable", {
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      partitionKey: { name: "testId", type: AttributeType.STRING },
      sortKey: { name: "testRunId", type: AttributeType.STRING },
      pointInTimeRecovery: true,
    });

    const historyDDBActions = ["dynamodb:BatchWriteItem", "dynamodb:PutItem", "dynamodb:Query"];
    this.historyDynamoDbPolicy = new Policy(this, "HistoryDynamoDbPolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: historyDDBActions,
          resources: [this.historyTable.tableArn],
        }),
      ],
    });

    const scenariosDDBActions = [
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Scan",
      "dynamodb:UpdateItem",
    ];
    this.scenarioDynamoDbPolicy = new Policy(this, "ScenarioDynamoDbPolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: scenariosDDBActions,
          resources: [this.scenariosTable.tableArn],
        }),
      ],
    });
  }
}
