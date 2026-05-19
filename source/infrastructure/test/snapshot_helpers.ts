// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Template } from "aws-cdk-lib/assertions";
import { Stack } from "aws-cdk-lib";

export function createTemplateWithoutS3Key(stack: Stack): Template {
  const templateJson = Template.fromStack(stack).toJSON();

  Object.keys(templateJson.Resources).forEach((key) => {
    if (templateJson.Resources[key].Properties?.Code?.S3Key) {
      templateJson.Resources[key].Properties.Code.S3Key = "Omitted to remove snapshot dependency on hash";
    }
    if (templateJson.Resources[key].Properties?.Content?.S3Key) {
      templateJson.Resources[key].Properties.Content.S3Key = "Omitted to remove snapshot dependency on hash";
    }
    if (templateJson.Resources[key].Properties?.SourceObjectKeys) {
      templateJson.Resources[key].Properties.SourceObjectKeys = [
        "Omitted to remove snapshot dependency on demo ui module hash",
      ];
    }
    if (templateJson.Resources[key].Properties?.Environment?.Variables?.SOLUTION_VERSION) {
      templateJson.Resources[key].Properties.Environment.Variables.SOLUTION_VERSION =
        "Omitted to remove snapshot dependency on solution version";
    }
    if (templateJson.Resources[key].Properties?.Timestamp) {
      templateJson.Resources[key].Properties.Timestamp =
        "Omitted to remove snapshot dependency on timestamp";
    }
    // Sanitize Cognito Domain with token placeholders
    if (
      templateJson.Resources[key].Properties?.Domain &&
      typeof templateJson.Resources[key].Properties.Domain === "string" &&
      templateJson.Resources[key].Properties.Domain.includes("${token[")
    ) {
      templateJson.Resources[key].Properties.Domain = "Omitted to remove snapshot dependency on token IDs";
    }
    // Sanitize UserPoolDomain in Fn::Join arrays
    if (templateJson.Resources[key].Properties?.UserPoolDomain?.["Fn::Join"]) {
      const joinArray = templateJson.Resources[key].Properties.UserPoolDomain["Fn::Join"][1];
      if (Array.isArray(joinArray)) {
        for (let i = 0; i < joinArray.length; i++) {
          if (typeof joinArray[i] === "string" && joinArray[i].includes("${token[")) {
            joinArray[i] = "Omitted to remove snapshot dependency on token IDs";
          }
        }
      }
    }
  });

  // Create a new Template instance with the modified JSON
  return {
    ...Template.fromJSON(templateJson),
    toJSON: () => templateJson,
  } as Template;
}
