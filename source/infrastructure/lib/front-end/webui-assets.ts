// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Web UI Assets Constructs
 *
 * Two constructs for generating web console configuration:
 * - WebUIConfigConstruct: Writes aws-exports.json to S3 (CloudFront + S3 deployment)
 * - WebUIZipConstruct: Packages web assets + config into ZIP (ALB/ECS and headless deployments)
 */

import { Aspects, CustomResource, Duration, IAspect } from "aws-cdk-lib";
import { Architecture, CfnFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { IBucket } from "aws-cdk-lib/aws-s3";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct, IConstruct } from "constructs";
import * as path from "path";

/** Suppresses cfn_nag warnings for Lambda functions in these constructs */
class LambdaSuppressionAspect implements IAspect {
  visit(node: IConstruct): void {
    if (node instanceof CfnFunction) {
      node.addMetadata("cfn_nag", {
        rules_to_suppress: [
          { id: "W89", reason: "Lambda does not need VPC - only writes to S3" },
          { id: "W92", reason: "Temporary custom resource - no reserved concurrency needed" },
        ],
      });
    }
  }
}

/** AWS configuration for aws-exports.json */
export interface AwsExportsConfig {
  readonly userPoolId: string;
  readonly poolClientId: string;
  readonly identityPoolId: string;
  readonly userPoolDomain: string;
  readonly apiEndpoint: string;
  readonly userFilesBucket: string;
  readonly userFilesBucketRegion: string;
  readonly iotEndpoint: string;
  readonly iotPolicy: string;
}

// ============================================================================
// WebUIConfigConstruct - writes aws-exports.json to S3
// ============================================================================

export interface WebUIConfigConstructProps extends AwsExportsConfig {
  readonly destinationBucket: IBucket;
  readonly objectKey?: string;
}

/**
 * Writes aws-exports.json configuration file to S3.
 * Used by CloudFront + S3 deployment where web assets are deployed separately.
 */
export class WebUIConfigConstruct extends Construct {
  constructor(scope: Construct, id: string, props: WebUIConfigConstructProps) {
    super(scope, id);

    const handler = new NodejsFunction(this, "Handler", {
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      handler: "handler",
      timeout: Duration.minutes(5),
      entry: "lambda/aws-exports-handler/index.ts",
    });

    props.destinationBucket.grantWrite(handler);

    const provider = new Provider(this, "Provider", { onEventHandler: handler });

    new CustomResource(this, "Resource", {
      serviceToken: provider.serviceToken,
      properties: {
        UserPoolId: props.userPoolId,
        PoolClientId: props.poolClientId,
        IdentityPoolId: props.identityPoolId,
        UserPoolDomain: props.userPoolDomain,
        ApiEndpoint: props.apiEndpoint,
        UserFilesBucket: props.userFilesBucket,
        UserFilesBucketRegion: props.userFilesBucketRegion,
        IoTEndpoint: props.iotEndpoint,
        IoTPolicy: props.iotPolicy,
        BucketName: props.destinationBucket.bucketName,
        ObjectKey: props.objectKey ?? "aws-exports.json",
      },
    });

    Aspects.of(this).add(new LambdaSuppressionAspect());
  }
}

// ============================================================================
// WebUIZipConstruct - packages web assets + config into ZIP
// ============================================================================

export interface WebUIZipConstructProps extends AwsExportsConfig {
  readonly destinationBucket: IBucket;
  readonly destinationKey: string;
  readonly solutionVersion: string;
}

/**
 * Packages web console assets with aws-exports.json into a ZIP file.
 * Used by ALB/ECS and headless deployments where the ZIP is extracted at runtime.
 */
export class WebUIZipConstruct extends Construct {
  /** S3 URI of the generated ZIP file (s3://bucket/key) */
  public readonly zipLocation: string;

  constructor(scope: Construct, id: string, props: WebUIZipConstructProps) {
    super(scope, id);

    const handler = new NodejsFunction(this, "Handler", {
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      handler: "handler",
      timeout: Duration.minutes(5),
      memorySize: 512,
      entry: "lambda/webui-zip-handler/index.ts",
      bundling: {
        externalModules: [],
        nodeModules: ["archiver"],
        commandHooks: {
          beforeBundling: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            `cp -r ${path.join(inputDir, "../webui/dist")} ${path.join(outputDir, "web-assets")}`,
          ],
          beforeInstall: () => [],
        },
      },
    });

    props.destinationBucket.grantWrite(handler);

    const provider = new Provider(this, "Provider", { onEventHandler: handler });

    const resource = new CustomResource(this, "Resource", {
      serviceToken: provider.serviceToken,
      properties: {
        UserPoolId: props.userPoolId,
        PoolClientId: props.poolClientId,
        IdentityPoolId: props.identityPoolId,
        UserPoolDomain: props.userPoolDomain,
        ApiEndpoint: props.apiEndpoint,
        UserFilesBucket: props.userFilesBucket,
        UserFilesBucketRegion: props.userFilesBucketRegion,
        IoTEndpoint: props.iotEndpoint,
        IoTPolicy: props.iotPolicy,
        DestinationBucket: props.destinationBucket.bucketName,
        DestinationKey: props.destinationKey,
        SolutionVersion: props.solutionVersion,
      },
    });

    this.zipLocation = resource.getAttString("ZipLocation");

    Aspects.of(this).add(new LambdaSuppressionAspect());
  }
}
