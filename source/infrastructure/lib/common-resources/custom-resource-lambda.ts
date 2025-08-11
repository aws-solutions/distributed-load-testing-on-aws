// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Construct } from "constructs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Effect, Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { ArnFormat, CfnResource, Duration, Stack } from "aws-cdk-lib";
import { Solution, SOLUTIONS_METRICS_ENDPOINT } from "../../bin/solution";
import * as path from "path";
import { addCfnGuardSuppression } from "./add-cfn-guard-suppression";

interface ICustomResourceLambda {
  nodejsLambda: NodejsFunction;
  addEnvironmentVariables(environmentVariables: { [key: string]: string }): void;
  addPolicy(policy: Policy[]): void;
}

export class CustomResourceLambda extends Construct implements ICustomResourceLambda {
  public readonly nodejsLambda: NodejsFunction;

  constructor(scope: Construct, id: string, solution: Solution, stackType: string) {
    super(scope, id);

    const policyForCustomResource = new PolicyDocument({
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["iot:DescribeEndpoint", "iot:DetachPrincipalPolicy"],
          resources: ["*"],
        }),
        new PolicyStatement({
          actions: ["iot:ListTargetsForPolicy"],
          effect: Effect.ALLOW,
          resources: [
            Stack.of(this).formatArn({
              service: "iot",
              resource: "policy",
              resourceName: "*",
              arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
            }),
          ],
        }),
      ],
    });

    const customResourceRole = new Role(this, "CustomResourceLambdaRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      inlinePolicies: {
        CustomResourcePolicy: policyForCustomResource,
      },
    });

    const cfnCustomResourceRole = customResourceRole.node.defaultChild as CfnResource;
    cfnCustomResourceRole.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W11",
          reason: "iot:DescribeEndpoint and iot:DetachPrincipalPolicy cannot specify the resource.",
        },
      ],
    });

    addCfnGuardSuppression(customResourceRole, "IAM_NO_INLINE_POLICY_CHECK");

    this.nodejsLambda = new NodejsFunction(this, "CustomResourceLambda", {
      description: "CFN Lambda backed custom resource to deploy assets to s3",
      handler: "index.handler",
      role: customResourceRole,
      entry: path.join(__dirname, `../../../custom-resource/${stackType}-index.js`),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(120),
      environment: {
        METRIC_URL: SOLUTIONS_METRICS_ENDPOINT,
        SOLUTION_ID: solution.id,
        VERSION: solution.version,
      },
    });

    (this.nodejsLambda.node.defaultChild as CfnResource).overrideLogicalId(
      "DLTCustomResourceInfraCustomResourceLambdaA4053269"
    );
    (this.nodejsLambda.node.defaultChild as CfnResource).addMetadata("cfn_nag", {
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
  }

  public addEnvironmentVariables(environmentVariables: { [key: string]: string }) {
    for (const [key, value] of Object.entries(environmentVariables)) {
      this.nodejsLambda.addEnvironment(key, value);
    }
  }

  public addPolicy(policy: Policy[]) {
    for (const _policy of policy) {
      this.nodejsLambda.role?.attachInlinePolicy(_policy);
    }
  }
}
