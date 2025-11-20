// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CustomResource, Duration, Aspects, IAspect } from "aws-cdk-lib";
import { Runtime, CfnFunction } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct, IConstruct } from "constructs";
import { IBucket } from "aws-cdk-lib/aws-s3";

class LambdaSuppressionAspect implements IAspect {
  visit(node: IConstruct): void {
    if (node instanceof CfnFunction) {
      node.addMetadata("cfn_nag", {
        rules_to_suppress: [
          {
            id: "W89",
            reason:
              "Lambda function created by BucketDeployment does not need to be in a VPC as it only copies files to S3",
          },
          {
            id: "W92",
            reason: "Lambda function created by BucketDeployment is temporary and does not need reserved concurrency",
          },
        ],
      });
    }
  }
}

export interface WebUIConfigConstructProps {
  userPoolId: string;
  poolClientId: string;
  identityPoolId: string;
  apiEndpoint: string;
  deploymentBucket: IBucket;
  userFilesBucket: string;
  userFilesBucketRegion: string;
  IoTEndpoint: string;
  IoTPolicy: string;
}

export class WebUIConfigConstruct extends Construct {
  constructor(scope: Construct, id: string, props: WebUIConfigConstructProps) {
    super(scope, id);

    const awsExportsLambda = new NodejsFunction(this, "AwsExportsLambda", {
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      timeout: Duration.minutes(5),
      entry: "lambda/aws-exports-handler/index.ts",
    });

    props.deploymentBucket.grantWrite(awsExportsLambda);

    const provider = new Provider(this, "AwsExportsProvider", {
      onEventHandler: awsExportsLambda,
    });

    new CustomResource(this, "AwsExportsCustomResource", {
      serviceToken: provider.serviceToken,
      properties: {
        UserPoolId: props.userPoolId,
        PoolClientId: props.poolClientId,
        IdentityPoolId: props.identityPoolId,
        ApiEndpoint: props.apiEndpoint,
        BucketName: props.deploymentBucket.bucketName,
        ObjectKey: "aws-exports.json",
        UserFilesBucket: props.userFilesBucket,
        UserFilesBucketRegion: props.userFilesBucketRegion,
        IoTEndpoint: props.IoTEndpoint,
        IoTPolicy: props.IoTPolicy,
      },
    });

    // Apply aspect to suppress CFN NAG rules for all Lambda functions
    Aspects.of(this).add(new LambdaSuppressionAspect());
  }
}
