// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// eslint-disable-next-line import/no-unresolved
import { CognitoIdentityProviderClient, SetUICustomizationCommand } from "@aws-sdk/client-cognito-identity-provider";

const cognitoClient = new CognitoIdentityProviderClient();

interface CloudFormationEvent {
  RequestType: string;
  ResourceProperties: {
    UserPoolId: string;
    CSS: string;
    ImageFileBase64: string;
  };
  PhysicalResourceId?: string;
}

interface CloudFormationResponse {
  Status: "SUCCESS" | "FAILED";
  PhysicalResourceId: string;
  Data: Record<string, unknown>;
  Reason?: string;
}

export const handler = async (event: CloudFormationEvent): Promise<CloudFormationResponse> => {
  console.log(
    "Event:",
    JSON.stringify(
      { ...event, ResourceProperties: { ...event.ResourceProperties, ImageFileBase64: "[REDACTED]" } },
      null,
      2
    )
  );

  const { RequestType, ResourceProperties, PhysicalResourceId } = event;
  const { UserPoolId, CSS, ImageFileBase64 } = ResourceProperties;

  try {
    if (RequestType === "Create" || RequestType === "Update") {
      const imageFileBuffer = Buffer.from(ImageFileBase64, "base64");

      await cognitoClient.send(
        new SetUICustomizationCommand({
          UserPoolId,
          CSS,
          ImageFile: new Uint8Array(imageFileBuffer),
        })
      );

      console.log("Cognito Hosted UI customization applied successfully");
    }

    // On Delete, no action needed — UI customization is removed with the user pool

    return {
      Status: "SUCCESS",
      PhysicalResourceId: PhysicalResourceId || `cognito-ui-customization-${Date.now()}`,
      Data: {},
    };
  } catch (error: unknown) {
    console.error("Error:", error);
    return {
      Status: "FAILED",
      Reason: error instanceof Error ? error.message : String(error),
      PhysicalResourceId: PhysicalResourceId || `cognito-ui-customization-${Date.now()}`,
      Data: {},
    };
  }
};
