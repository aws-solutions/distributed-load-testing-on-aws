// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { Stack } from "aws-cdk-lib";

export function createTemplateWithoutS3Key(stack: Stack): Template {
  const templateJson = Template.fromStack(stack).toJSON();

  Object.values(templateJson.Resources).forEach((res: any) => {
    if (res.Properties?.Code?.S3Key) {
      res.Properties.Code.S3Key = "Omitted to remove snapshot dependency on hash";
    }
    if (res.Properties?.Content?.S3Key) {
      res.Properties.Content.S3Key = "Omitted to remove snapshot dependency on hash";
    }
    if (res.Properties?.SourceObjectKeys) {
      res.Properties.SourceObjectKeys = ["Omitted to remove snapshot dependency on demo ui module hash"];
    }
    if (res.Properties?.Environment?.Variables?.SOLUTION_VERSION) {
      res.Properties.Environment.Variables.SOLUTION_VERSION =
        "Omitted to remove snapshot dependency on solution version";
    }
    if (res.Properties?.Timestamp) {
      res.Properties.Timestamp = "Omitted to remove snapshot dependency on timestamp";
    }
    // Sanitize Cognito Domain with token placeholders
    if (
      res.Properties?.Domain &&
      typeof res.Properties.Domain === "string" &&
      res.Properties.Domain.includes("${token[")
    ) {
      res.Properties.Domain = "Omitted to remove snapshot dependency on token IDs";
    }
    // Sanitize UserPoolDomain in Fn::Join arrays
    if (res.Properties?.UserPoolDomain?.["Fn::Join"]) {
      const joinArray = res.Properties.UserPoolDomain["Fn::Join"][1];
      if (Array.isArray(joinArray)) {
        for (let i = 0; i < joinArray.length; i++) {
          if (typeof joinArray[i] === "string" && joinArray[i].includes("${token[")) {
            joinArray[i] = "Omitted to remove snapshot dependency on token IDs";
          }
        }
      }
    }
    // Sanitize docker image hash
    if (res.Properties?.ContainerDefinitions) {
      res.Properties.ContainerDefinitions.forEach((def: any) => {
        const regex = /:[a-f0-9]{64}/;
        if (regex.test(def.Image?.["Fn::Sub"] ?? "")) {
          def.Image["Fn::Sub"] = def.Image["Fn::Sub"].replace(regex, ":[Omitted HASH]");
        }
      });
    }
  });

  // Create a new Template instance with the modified JSON
  return {
    ...Template.fromJSON(templateJson),
    toJSON: () => templateJson,
  } as Template;
}
