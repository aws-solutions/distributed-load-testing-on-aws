// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client();

interface CloudFormationEvent {
  RequestType: string;
  ResourceProperties: {
    UserPoolId: string;
    PoolClientId: string;
    IdentityPoolId: string;
    ApiEndpoint: string;
    BucketName: string;
    ObjectKey: string;
    UserFilesBucket: string;
    UserFilesBucketRegion: string;
    IoTEndpoint: string;
    IoTPolicy: string;
  };
  PhysicalResourceId?: string;
}

interface CloudFormationResponse {
  Status: "SUCCESS" | "FAILED";
  PhysicalResourceId: string;
  Data: Record<string, any>;
  Reason?: string;
}

export const handler = async (event: CloudFormationEvent): Promise<CloudFormationResponse> => {
  console.log("Event:", JSON.stringify(event, null, 2));

  const { RequestType, ResourceProperties, PhysicalResourceId } = event;
  const {
    UserPoolId,
    PoolClientId,
    IdentityPoolId,
    ApiEndpoint,
    BucketName,
    ObjectKey,
    UserFilesBucket,
    UserFilesBucketRegion,
    IoTEndpoint,
    IoTPolicy,
  } = ResourceProperties;

  try {
    if (RequestType === "Create" || RequestType === "Update") {
      const awsExports = {
        UserPoolId,
        PoolClientId,
        IdentityPoolId,
        ApiEndpoint,
        UserFilesBucket,
        UserFilesBucketRegion,
        IoTEndpoint,
        IoTPolicy,
      };

      await s3Client.send(
        new PutObjectCommand({
          Bucket: BucketName,
          Key: ObjectKey,
          Body: JSON.stringify(awsExports, null, 2),
          ContentType: "application/json",
        })
      );

      console.log("aws-exports.json generated successfully");
    }

    return {
      Status: "SUCCESS",
      PhysicalResourceId: PhysicalResourceId || `aws-exports-${Date.now()}`,
      Data: {},
    };
  } catch (error: any) {
    console.error("Error:", error);
    return {
      Status: "FAILED",
      Reason: error.message,
      PhysicalResourceId: PhysicalResourceId || `aws-exports-${Date.now()}`,
      Data: {},
    };
  }
};
