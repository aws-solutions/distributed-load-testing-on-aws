// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * CDK-aware factory for building CloudFormation parameters from the shared
 * parameter spec. This is the only place that couples the parameter data to
 * aws-cdk-lib; the spec itself (`parameter-spec.ts`) stays dependency-free so
 * the Launch Wizard metadata generator can read it without loading CDK.
 */

import { CfnParameter } from "aws-cdk-lib";
import { Construct } from "constructs";
import { ParamSpec } from "./parameter-spec";

// Re-export the spec data so stacks import both `defineParam` and `PARAMETERS`
// from a single module.
export { PARAMETERS } from "./parameter-spec";

/**
 * Builds a CloudFormation parameter from a {@link ParamSpec}. Constraint values
 * come solely from the spec, so the enforced constraints share the single
 * source of truth with the Launch Wizard metadata.
 *
 * @param scope construct scope
 * @param spec parameter spec entry
 * @returns the created CfnParameter
 */
export function defineParam(scope: Construct, spec: ParamSpec): CfnParameter {
  let allowedPattern: string | undefined;
  if (spec.pattern) {
    // optionalEmpty allows "" in CloudFormation via a leading empty-string branch.
    allowedPattern = spec.optionalEmpty ? `^$|${spec.pattern}` : spec.pattern;
  }

  return new CfnParameter(scope, spec.name, {
    type: spec.type,
    ...(allowedPattern !== undefined && { allowedPattern }),
    ...(spec.allowedValues && { allowedValues: [...spec.allowedValues] }),
    ...(spec.minLength !== undefined && { minLength: spec.minLength }),
    ...(spec.maxLength !== undefined && { maxLength: spec.maxLength }),
    ...(spec.default !== undefined && { default: spec.default }),
    ...(spec.description !== undefined && { description: spec.description }),
    ...(spec.constraintDescription !== undefined && { constraintDescription: spec.constraintDescription }),
  });
}
