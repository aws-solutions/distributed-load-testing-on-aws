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
  });

  // Create a new Template instance with the modified JSON
  return {
    ...Template.fromJSON(templateJson),
    toJSON: () => templateJson,
  } as Template;
}
