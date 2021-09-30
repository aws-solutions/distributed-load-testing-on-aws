// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { Aws, Construct, CustomResource } from '@aws-cdk/core';


/**
 * CustomResourcesConstruct props
 * @interface CustomResourcesConstructProps
 */
export interface CustomResourcesConstructProps {
    readonly apiEndpoint: string;
    //Custom Resource lambda
    readonly customResourceLambda: string;
    // Cognito Resources
    readonly cognitoIdentityPool: string;
    readonly cognitoUserPool: string;
    readonly cognitoUserPoolClient: string;
    // UI Console S3 bucket
    readonly consoleBucketName: string;
    // Test scenarios storage
    readonly scenariosBucket: string;
    // Source code details
    readonly sourceCodeBucketName: string;
    readonly sourceCodePrefix: string;
}

/**
 * @class
 * Distributed Load Testing on AWS Custom Resources Construct.
 * It creates a custom resource Lambda function, a solution UUID, and a custom resource to send anonymous usage.
 */
export class CustomResourcesConstruct extends Construct {

    constructor(scope: Construct, id: string, props: CustomResourcesConstructProps) {
        super(scope, id);

        new CustomResource(this, 'CopyConsoleFiles', {
            serviceToken: props.customResourceLambda,
            resourceType: 'Custom::CopyConsoleFiles',
            properties: {
                Resource: 'CopyAssets',
                SrcBucket: props.sourceCodeBucketName,
                SrcPath: `${props.sourceCodePrefix}/console`,
                ManifestFile: 'console-manifest.json',
                DestBucket: props.consoleBucketName
            }
        });

        const awsExports = `const awsConfig = {
            cw_dashboard: 'https://console.aws.amazon.com/cloudwatch/home?region=${Aws.REGION}#dashboards:name=',
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
            aws_user_files_s3_bucket_region: '${Aws.REGION}'
        }`;

        new CustomResource(this, 'ConsoleConfig', {
            serviceToken: props.customResourceLambda,
            resourceType: 'Custom::CopyConfigFiles',
            properties: {
                Resource: 'ConfigFile',
                DestBucket: props.consoleBucketName,
                AwsExports: awsExports
            }
        });
    }
}