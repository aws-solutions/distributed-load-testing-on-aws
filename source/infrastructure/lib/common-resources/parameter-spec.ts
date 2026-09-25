// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Single source of truth for deployment-time parameter constraints.
 *
 * Both consumers import this module directly at the code level:
 *   1. The CDK stacks build their `CfnParameter`s via {@link defineParam}.
 *   2. The Launch Wizard metadata generator injects these constraints into the
 *      `metadata.json` skeletons.
 *
 * Because both derive from the same objects, the Launch Wizard `customRegex`
 * and the CloudFormation `AllowedPattern` are the same string by construction,
 * so the two layers cannot drift. Launch Wizard forwards parameters to
 * CloudFormation, so the only correct state is LW constraints identical to CFN
 * constraints.
 */

// This module is intentionally dependency-free (no aws-cdk-lib import). It is the
// shared data source consumed by two callers: the CDK stacks (via defineParam in
// cfn-parameter-factory.ts) and the Launch Wizard metadata generator. Keeping it
// CDK-free lets the generator and any validation tooling read the parameter data
// without loading aws-cdk-lib.

// ============================================================================
// Shared regex primitives
// ============================================================================

// These building-block patterns are used only within this module (in PARAMETERS
// below), so they are not exported. ECR_IMAGE_URI_PATTERN is the exception: it is
// re-exported by base-stack.ts and used by tests.

/** A single IPv4 octet bounded to 0-255. */
const IP_OCTET = String.raw`(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;

/** IPv4 CIDR body (no anchors): four bounded octets + a /0-32 prefix. */
const CIDR_CORE = String.raw`${IP_OCTET}(\.${IP_OCTET}){3}/(3[0-2]|[12]?\d)`;

/** Fully anchored IPv4 CIDR pattern. Octets 0-255, prefix 0-32. */
const CIDR_PATTERN = `^${CIDR_CORE}$`;

/** Existing VPC id. */
const VPC_ID_PATTERN = "^vpc-[a-zA-Z0-9-]+$";

/** Existing subnet id. */
const SUBNET_ID_PATTERN = "^subnet-[a-zA-Z0-9-]+$";

/** Administrator console/API username. */
const ADMIN_NAME_PATTERN = "^[a-zA-Z0-9-]+$";

/** Administrator email address. */
const EMAIL_PATTERN = String.raw`^[_A-Za-z0-9-\+]+(\.[_A-Za-z0-9-]+)*@[A-Za-z0-9-]+(\.[A-Za-z0-9]+)*(\.[A-Za-z]{2,})$`;

/** Fully qualified domain name (ALB-ECS console). */
const FQDN_PATTERN = String.raw`^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$`;

/** ACM certificate ARN (ALB-ECS console). */
const ACM_ARN_PATTERN = String.raw`^arn:aws[a-z-]*:acm:[a-z0-9-]+:\d{12}:certificate/[a-f0-9-]+$`;

/**
 * ECR image URI, or empty to use the default public image. This pattern embeds
 * its own empty-string branch, so it is used verbatim (not via `optionalEmpty`).
 */
export const ECR_IMAGE_URI_PATTERN = String.raw`^$|^\d{12}\.dkr\.ecr\.[a-z]{2}(-gov)?-(central|north|south|east|west|northeast|southeast|northwest|southwest)-\d\.amazonaws\.com\/[a-z0-9._\/-]+(:[a-zA-Z0-9._-]+|@sha256:[a-fA-F0-9]{64})?$`;

const ECR_CONSTRAINT_DESCRIPTION =
  "Must be empty or a valid ECR image URI (e.g., 123456789012.dkr.ecr.us-east-1.amazonaws.com/my-repo:tag or .../my-repo@sha256:<64-hex-chars>).";

// ============================================================================
// Spec model
// ============================================================================

/**
 * A single deployment parameter's constraint facts. These fields
 * (pattern/min/max/allowedValues/default) are the single source of truth for
 * both the CloudFormation parameter and the Launch Wizard validation; nothing
 * else may restate them.
 *
 * Note: which patterns surface a parameter is NOT declared here. It is
 * determined by which stack defines the parameter (and thus which template it
 * lands in), and the LW field set is enforced against the synthesized templates
 * by the launch-wizard parameter conformance test.
 */
export interface ParamSpec {
  /** CfnParameter logical id AND Launch Wizard metadata fieldId (the join key). */
  readonly name: string;
  readonly type: "String";
  /**
   * Canonical, fully anchored (^...$) pattern with no empty-string branch.
   * Combine with {@link optionalEmpty} to allow "".
   */
  readonly pattern?: string;
  /**
   * When true, CloudFormation emits `^$|<pattern>` (empty allowed) and Launch
   * Wizard keeps the non-empty `<pattern>` because the field is display-gated
   * and never shown when empty is valid. This is the one legitimate asymmetry.
   */
  readonly optionalEmpty?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly allowedValues?: readonly string[];
  readonly default?: string;
  readonly description?: string;
  readonly constraintDescription?: string;
}

// ============================================================================
// Parameter definitions (single source of truth)
// ============================================================================

export const PARAMETERS = {
  AdminName: {
    name: "AdminName",
    type: "String",
    pattern: ADMIN_NAME_PATTERN,
    minLength: 4,
    maxLength: 20,
    constraintDescription: "Admin username must be a minimum of 4 characters and cannot include spaces",
  },

  AdminEmail: {
    name: "AdminEmail",
    type: "String",
    // No minLength: the email pattern already implies >= 6 characters.
    pattern: EMAIL_PATTERN,
    constraintDescription: "Admin email must be a valid email address",
  },

  ExistingVPCId: {
    name: "ExistingVPCId",
    type: "String",
    pattern: VPC_ID_PATTERN,
    optionalEmpty: true,
    default: "",
    description: "Existing VPC ID",
  },

  ExistingSubnetA: {
    name: "ExistingSubnetA",
    type: "String",
    pattern: SUBNET_ID_PATTERN,
    optionalEmpty: true,
    default: "",
    description: "First existing subnet",
  },

  ExistingSubnetB: {
    name: "ExistingSubnetB",
    type: "String",
    pattern: SUBNET_ID_PATTERN,
    optionalEmpty: true,
    default: "",
    description: "Second existing subnet",
  },

  VpcCidrBlock: {
    name: "VpcCidrBlock",
    type: "String",
    pattern: CIDR_PATTERN,
    optionalEmpty: true,
    default: "192.168.0.0/16",
    description: "You may leave this parameter blank if you are using existing VPC",
    constraintDescription: "The VPC CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
  },

  SubnetACidrBlock: {
    name: "SubnetACidrBlock",
    type: "String",
    pattern: CIDR_PATTERN,
    optionalEmpty: true,
    default: "192.168.0.0/20",
    description: "CIDR block for subnet A of the AWS Fargate VPC",
    constraintDescription: "The subnet CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
  },

  SubnetBCidrBlock: {
    name: "SubnetBCidrBlock",
    type: "String",
    pattern: CIDR_PATTERN,
    optionalEmpty: true,
    default: "192.168.16.0/20",
    description: "CIDR block for subnet B of the AWS Fargate VPC",
    constraintDescription: "The subnet CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
  },

  EgressCidr: {
    name: "EgressCidr",
    type: "String",
    // No min/maxLength: the CIDR pattern already only matches 9-18 char strings.
    pattern: CIDR_PATTERN,
    default: "0.0.0.0/0",
    description: "CIDR Block to restrict the Amazon ECS container outbound access",
    constraintDescription: "The Egress CIDR block must be a valid IP CIDR range of the form x.x.x.x/x.",
  },

  UseStableTagging: {
    name: "UseStableTagging",
    type: "String",
    allowedValues: ["Yes", "No"],
    default: "No",
    description:
      "Automatically use the most up to date and secure image up until the next minor release. Selecting 'No' will pull the image as originally released, without any security updates.",
  },

  LoadTesterImageUri: {
    name: "LoadTesterImageUri",
    type: "String",
    pattern: ECR_IMAGE_URI_PATTERN,
    default: "",
    description: "URI of load tester container image. If empty, the default public image is used.",
    constraintDescription: ECR_CONSTRAINT_DESCRIPTION,
  },

  LocustLoadTesterImageUri: {
    name: "LocustLoadTesterImageUri",
    type: "String",
    pattern: ECR_IMAGE_URI_PATTERN,
    default: "",
    description: "URI of Locust load tester container image. If empty, the default public image is used.",
    constraintDescription: ECR_CONSTRAINT_DESCRIPTION,
  },

  K6LoadTesterImageUri: {
    name: "K6LoadTesterImageUri",
    type: "String",
    pattern: ECR_IMAGE_URI_PATTERN,
    default: "",
    description: "URI of k6 load tester container image. If empty, the default public image is used.",
    constraintDescription: ECR_CONSTRAINT_DESCRIPTION,
  },

  JMeterLoadTesterImageUri: {
    name: "JMeterLoadTesterImageUri",
    type: "String",
    pattern: ECR_IMAGE_URI_PATTERN,
    default: "",
    description: "URI of JMeter load tester container image. If empty, the default public image is used.",
    constraintDescription: ECR_CONSTRAINT_DESCRIPTION,
  },

  DeployMCPServer: {
    name: "DeployMCPServer",
    type: "String",
    allowedValues: ["Yes", "No"],
    default: "No",
    description:
      "Deploy a remote MCP server to connect AI applications to DLT. See the Implementation Guide for more details.",
  },

  MCPServerAccessMode: {
    name: "MCPServerAccessMode",
    type: "String",
    // Order matters for the Launch Wizard toggle: the generator maps
    // allowedValues[0] -> onValue. Framed as "Allow write operations", so ON =
    // ReadWrite and the default (ReadOnly) is the safe OFF state. The set is
    // unchanged; only the array order differs from the CloudFormation-natural
    // ["ReadOnly","ReadWrite"].
    allowedValues: ["ReadWrite", "ReadOnly"],
    default: "ReadOnly",
    description:
      "Controls whether the MCP server can perform mutating operations (create, update, delete tests). Only applies when Deploy MCP Server is Yes.",
  },

  // --- ALB-ECS console parameters ---

  ConsoleDomainName: {
    name: "ConsoleDomainName",
    type: "String",
    // No minLength: the FQDN pattern already implies >= 4 characters.
    pattern: FQDN_PATTERN,
    description: "Custom domain name for the web console (e.g., dlt.example.com). Must match the ACM certificate.",
    constraintDescription: "Must be a valid fully qualified domain name (e.g., dlt.example.com)",
  },

  ACMCertificateArn: {
    name: "ACMCertificateArn",
    type: "String",
    pattern: ACM_ARN_PATTERN,
    description: "ARN of the ACM certificate for HTTPS. Must be in the same region as the stack.",
    constraintDescription: "Must be a valid ACM certificate ARN",
  },

  WebConsoleImageUri: {
    name: "WebConsoleImageUri",
    type: "String",
    pattern: ECR_IMAGE_URI_PATTERN,
    default: "",
    description: "URI of web console container image. If empty, the default public image is used.",
    constraintDescription: ECR_CONSTRAINT_DESCRIPTION,
  },

  DeployWAF: {
    name: "DeployWAF",
    type: "String",
    allowedValues: ["Yes", "No"],
    default: "Yes",
    description:
      "Deploy AWS WAF WebACL on the Application Load Balancer with AWS managed rule groups for common threats, known bad inputs, and IP reputation. Select No to skip WAF deployment.",
  },
} as const;

// Each entry's conformance to ParamSpec is enforced at its `defineParam(this,
// PARAMETERS.X)` call site (the argument is typed as ParamSpec). `as const` is
// used instead of `as const satisfies` so the older source prettier can parse
// this file.
