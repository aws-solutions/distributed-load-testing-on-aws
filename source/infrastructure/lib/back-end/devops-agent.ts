// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Aws, CfnResource } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table, TableEncryption } from "aws-cdk-lib/aws-dynamodb";
import { Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { addCfnGuardSuppression } from "../common-resources/add-cfn-guard-suppression";

export class DevOpsAgentConstruct extends Construct {
  public readonly policy: Policy;
  public readonly agentSpacesTable: Table;
  public readonly agentSpacesDynamoDbPolicy: Policy;
  public readonly investigationsTable: Table;
  public readonly investigationsDynamoDbPolicy: Policy;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // --- IAM Policy for aidevops API actions ---
    // Split into two statements:
    // 1. GetAgentSpace WITH aws:ResourceTag condition — enforces dual-consent at IAM level.
    //    The test-connection handler calls GetAgentSpace before registration; if the Agent Space
    //    admin has not tagged it with dlt-integration=allowed, the call fails and registration
    //    is blocked. This ensures both DLT operator AND Agent Space admin consent.
    // 2. Remaining task-level actions WITHOUT tag condition — aws:ResourceTag is not supported
    //    on these actions per https://docs.aws.amazon.com/service-authorization/latest/reference/list_awsdevopsagentservice.html
    //    Scoping is enforced server-side via AgentSpacesTable resolution.
    this.policy = new Policy(this, "DevOpsAgentRolePolicy", {
      statements: [
        // Statement 1: GetAgentSpace with tag condition (dual-consent)
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["aidevops:GetAgentSpace"],
          resources: [`arn:${Aws.PARTITION}:aidevops:*:${Aws.ACCOUNT_ID}:agentspace/*`],
          conditions: {
            StringEquals: {
              "aws:ResourceTag/dlt-integration": "allowed",
            },
          },
        }),
        // Statement 2: Task-level actions without tag condition (not supported by service)
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "aidevops:CreateBacklogTask",
            "aidevops:GetBacklogTask",
            "aidevops:UpdateBacklogTask",
            "aidevops:ListExecutions",
            "aidevops:ListJournalRecords",
            "aidevops:CreateAsset",
            "aidevops:DeleteAsset",
          ],
          resources: [`arn:${Aws.PARTITION}:aidevops:*:${Aws.ACCOUNT_ID}:agentspace/*`],
        }),
      ],
    });

    const policyResource = this.policy.node.defaultChild as CfnResource;
    policyResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W12",
          reason:
            "aidevops actions require wildcard on agentspace/* because Agent Space ARNs are customer-supplied at runtime. Access is scoped to the deploying account and by aws:ResourceTag condition requiring dlt-integration=allowed.",
        },
      ],
    });
    addCfnGuardSuppression(this.policy, "IAM_POLICYDOCUMENT_NO_WILDCARD_RESOURCE");

    // --- AgentSpacesTable ---

    this.agentSpacesTable = new Table(this, "DLTAgentSpacesTable", {
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      partitionKey: { name: "id", type: AttributeType.STRING },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    addCfnGuardSuppression(this.agentSpacesTable, "DYNAMODB_TABLE_ENCRYPTED_KMS");

    this.agentSpacesDynamoDbPolicy = new Policy(this, "AgentSpacesDynamoDbPolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "dynamodb:GetItem",
            "dynamodb:BatchGetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Scan",
          ],
          resources: [this.agentSpacesTable.tableArn],
        }),
      ],
    });

    // --- InvestigationsTable ---

    this.investigationsTable = new Table(this, "DLTInvestigationsTable", {
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      partitionKey: { name: "testId", type: AttributeType.STRING },
      sortKey: { name: "testRunId#investigationId", type: AttributeType.STRING },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    addCfnGuardSuppression(this.investigationsTable, "DYNAMODB_TABLE_ENCRYPTED_KMS");

    this.investigationsDynamoDbPolicy = new Policy(this, "InvestigationsDynamoDbPolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query",
          ],
          resources: [this.investigationsTable.tableArn],
        }),
      ],
    });
  }
}
