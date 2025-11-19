// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { fetchAuthSession } from "aws-amplify/auth";

export const attachIoTPolicy = async (policyName: string): Promise<void> => {
  try {
    let session;
    let retries = 0;
    const maxRetries = 5;

    // Retry with exponential backoff to handle the case where
    // the identity provider hasn't yet issued an identity
    // ID immediately after login.
    while (retries < maxRetries) {
      session = await fetchAuthSession({ forceRefresh: retries > 0 });
      console.log(`IoT policy retry ${retries + 1}/${maxRetries}: identityId=${session.identityId ? 'found' : 'not found'}`);


      if (session.identityId) {
        break;
      }

      retries++;
      if (retries < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** retries)));
      }
    }

    if (!session || !session.identityId) {
      throw new Error("No identity ID found after retries");
    }

    const response = await fetch("/aws-exports.json");
    const config = await response.json();

    const iotClient = await import("@aws-sdk/client-iot");
    const { IoTClient, AttachPolicyCommand } = iotClient;

    const client = new IoTClient({
      region: config.UserFilesBucketRegion,
      credentials: session.credentials,
    });

    await client.send(
      new AttachPolicyCommand({
        policyName,
        target: session.identityId,
      })
    );
  } catch (error) {
    console.error("Failed to attach IoT policy:", error);
    throw error;
  }
};
