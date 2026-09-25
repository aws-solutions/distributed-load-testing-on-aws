// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Base stack containing all shared backend infrastructure for DLT.
 * Console-specific stacks extend this and provide their own console construct.
 */

import { CfnCondition, CfnResource, Fn, IAspect } from "aws-cdk-lib";
import { IConstruct } from "constructs";

/**
 * CDK Aspect implementation to set up conditions to the entire Construct resources
 */
export class ConditionAspect implements IAspect {
  private readonly condition: CfnCondition;
  private readonly mergeConditions: { [key: string]: CfnCondition };

  constructor(condition: CfnCondition) {
    this.condition = condition;
    this.mergeConditions = {};
  }

  /**
   * Implement IAspect.visit to set the condition to whole resources in Construct.
   * @param {IConstruct} node Construct node to visit
   */
  visit(node: IConstruct): void {
    const resource = node as CfnResource;
    const cfnOptions = resource.cfnOptions;
    if (!cfnOptions) return;

    // If the resource already has a condition, we need to merge the conditions
    let condition = cfnOptions.condition || this.condition;
    if (condition !== this.condition) {
      const conditionId = `${condition.node.id.replace("Condition", "")}And${this.condition.node.id}`;
      if (this.mergeConditions[conditionId]) {
        condition = this.mergeConditions[conditionId];
      } else {
        condition = new CfnCondition(this.condition.stack, conditionId, {
          expression: Fn.conditionAnd(condition, this.condition),
        });
      }
      this.mergeConditions[conditionId] = condition;
    }

    cfnOptions.condition = condition;
  }
}
