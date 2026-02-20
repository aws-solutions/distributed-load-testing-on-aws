// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table, TableEncryption, ProjectionType } from "aws-cdk-lib/aws-dynamodb";
import { Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { addCfnGuardSuppression } from "../common-resources/add-cfn-guard-suppression";

export interface ScenarioTestRunnerStorageConstructProps {
  // S3 Logs Bucket
  readonly s3LogsBucket: Bucket;
  // CloudFront domain name
  readonly webAppURL: string;
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
  public readonly historyTableGSIName = "testId-startTime-index";

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
          allowedMethods: [HttpMethods.GET, HttpMethods.POST, HttpMethods.PUT, HttpMethods.HEAD],
          allowedOrigins: [props.webAppURL],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
        },
      ],
    });

    this.scenariosS3Policy = new Policy(this, "ScenariosS3Policy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["s3:HeadObject", "s3:PutObject", "s3:GetObject", "s3:ListBucket"],
          resources: [this.scenariosBucket.bucketArn, `${this.scenariosBucket.bucketArn}/*`],
        }),
      ],
    });

    this.scenariosTable = new Table(this, "DLTScenariosTable", {
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      partitionKey: { name: "testId", type: AttributeType.STRING },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    addCfnGuardSuppression(this.scenariosTable, "DYNAMODB_TABLE_ENCRYPTED_KMS");

    this.historyTable = new Table(this, "DLTHistoryTable", {
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      partitionKey: { name: "testId", type: AttributeType.STRING },
      sortKey: { name: "testRunId", type: AttributeType.STRING },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    this.historyTable.addGlobalSecondaryIndex({
      indexName: this.historyTableGSIName,
      partitionKey: { name: "testId", type: AttributeType.STRING },
      sortKey: { name: "startTime", type: AttributeType.STRING },
      projectionType: ProjectionType.INCLUDE,
      nonKeyAttributes: ["testRunId", "endTime", "status", "results"],
    });

    addCfnGuardSuppression(this.historyTable, "DYNAMODB_TABLE_ENCRYPTED_KMS");

    const historyDDBActions = ["dynamodb:BatchWriteItem", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"];
    this.historyDynamoDbPolicy = new Policy(this, "HistoryDynamoDbPolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: historyDDBActions,
          resources: [this.historyTable.tableArn, `${this.historyTable.tableArn}/index/*`],
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
