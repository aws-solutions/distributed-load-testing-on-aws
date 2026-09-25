// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Parameter-set conformance between the main CloudFormation templates and the
 * Launch Wizard metadata.
 *
 * Launch Wizard forwards deployment parameters to CloudFormation, so the set of
 * parameters offered by a Launch Wizard form must equal the set of parameters in
 * the corresponding main template. Adding a CloudFormation parameter to a main
 * template involves Launch Wizard UX work (control type, labels, help text,
 * dependencies) that cannot be auto-generated, so this test fails the build on
 * any drift, forcing that field to be authored (or explicitly excluded).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { DLTBaseStack } from "../lib/distributed-load-testing-on-aws-base-stack";
import { DLTStack } from "../lib/distributed-load-testing-on-aws-stack";
import { DLTAlbEcsStack } from "../lib/distributed-load-testing-on-aws-alb-ecs-stack";
import { DLTHeadlessStack } from "../lib/distributed-load-testing-on-aws-headless-stack";
import { Solution } from "../bin/solution";

/**
 * CloudFormation parameters that intentionally exist in a main template but are
 * NOT surfaced in Launch Wizard. Keep this empty unless there is a deliberate,
 * documented reason; every entry is a parameter a Launch Wizard user cannot set.
 */
const LW_EXCLUDED_PARAMETERS: Record<string, ReadonlySet<string>> = {
  Default: new Set(),
  "ALB-ECS": new Set(),
  Headless: new Set(),
};

const REPO_ROOT = resolve(__dirname, "../../..");

// The Launch Wizard assets are an internal-only concern and are stripped from
// the open-source distribution. This conformance test synthesizes the CDK
// templates (always available) but also reads the LW skeletons, so skip it when
// those assets are absent (e.g. an open-source checkout) rather than failing.
const HAS_LW_ASSETS = existsSync(resolve(REPO_ROOT, "deployment/launch-wizard-assets"));

type Pattern = "Default" | "ALB-ECS" | "Headless";
type StackCtor = new (...args: ConstructorParameters<typeof DLTStack>) => DLTBaseStack;

const STACKS: Record<Pattern, { ctor: StackCtor; solutionTemplate: "cloudfront" | "alb-ecs" | "headless" }> = {
  Default: { ctor: DLTStack, solutionTemplate: "cloudfront" },
  "ALB-ECS": { ctor: DLTAlbEcsStack, solutionTemplate: "alb-ecs" },
  Headless: { ctor: DLTHeadlessStack, solutionTemplate: "headless" },
};

function templateParameterNames(pattern: Pattern): Set<string> {
  process.env.PUBLIC_ECR_REGISTRY = "registry";
  process.env.PUBLIC_ECR_TAG = "tag";
  process.env.DIST_OUTPUT_BUCKET = "codeBucket";
  process.env.SOLUTION_NAME = "DLT";
  process.env.VERSION = "Version";

  const app = new App({ context: { "aws:cdk:bundling-stacks": [] } });
  const solution = new Solution("testId", "DLT", "testVersion", `${pattern}StackDescription`);
  const { ctor, solutionTemplate } = STACKS[pattern];
  const stack = new ctor(app, `Test-${pattern}-Stack`, {
    synthesizer: new DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
      imageAssetsRepositoryName: process.env.PUBLIC_ECR_REGISTRY,
      dockerTagPrefix: process.env.PUBLIC_ECR_TAG,
    }),
    solution,
    stackType: "main",
    solutionTemplate,
  });
  return new Set(Object.keys(Template.fromStack(stack).findParameters("*")));
}

function metadata(pattern: Pattern): { provisioningParameters: string[]; fieldIds: Set<string> } {
  const path = resolve(REPO_ROOT, "deployment/launch-wizard-assets", pattern, "metadata.json");
  const meta = JSON.parse(readFileSync(path, "utf-8"));
  const fieldIds = new Set<string>();
  for (const page of meta.pages) {
    for (const section of page.sections) {
      for (const field of section.fields) fieldIds.add(field.fieldId);
    }
  }
  return { provisioningParameters: meta.provisioningParameters, fieldIds };
}

(HAS_LW_ASSETS ? describe.each : describe.skip.each)(Object.keys(STACKS) as Pattern[])(
  "Launch Wizard parameters — %s",
  (pattern) => {
    // All filesystem reads (metadata) and CDK synthesis (templateParameterNames)
    // happen INSIDE the it callbacks, not in this factory body. The factory body
    // runs at collection time even under describe.skip.each, so reading the LW
    // skeletons here would throw when launch-wizard-assets is absent (the
    // open-source build) and defeat the skip.
    it("Launch Wizard provisioningParameters exactly match the template's CloudFormation parameters", () => {
      const cfnParams = templateParameterNames(pattern);
      const { provisioningParameters } = metadata(pattern);
      const excluded = LW_EXCLUDED_PARAMETERS[pattern]!;
      const actual = [...provisioningParameters].sort();
      const expected = [...cfnParams].filter((p) => !excluded.has(p)).sort();
      // A mismatch means either a CFN parameter was added without a Launch Wizard
      // field, or Launch Wizard lists a parameter the template does not define.
      expect(actual).toEqual(expected);
    });

    it("every provisioningParameter has a corresponding metadata field", () => {
      const { provisioningParameters, fieldIds } = metadata(pattern);
      for (const param of provisioningParameters) {
        expect(fieldIds.has(param)).toBe(true);
      }
    });

    it("no excluded parameter is surfaced in Launch Wizard", () => {
      const { provisioningParameters } = metadata(pattern);
      const excluded = LW_EXCLUDED_PARAMETERS[pattern]!;
      for (const param of excluded) {
        expect(provisioningParameters).not.toContain(param);
      }
    });
  }
);
