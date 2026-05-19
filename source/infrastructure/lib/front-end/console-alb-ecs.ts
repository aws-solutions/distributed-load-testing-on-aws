// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * ALB + ECS Fargate Web Console Construct
 *
 * Hosts the DLT web console using Application Load Balancer with ECS Fargate.
 */
import * as path from "path";
import { Aws, CfnCondition, CfnResource, Fn, RemovalPolicy, Tags, Duration } from "aws-cdk-lib";
import { CfnLoggingConfiguration, CfnWebACL, CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import { Bucket, IBucket, BlockPublicAccess, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import {
  Cluster,
  ContainerDefinition,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  LogDriver,
  Protocol,
} from "aws-cdk-lib/aws-ecs";
import {
  Vpc,
  SubnetType,
  SecurityGroup,
  Port,
  GatewayVpcEndpointAwsService,
  InterfaceVpcEndpointAwsService,
  Peer,
  CfnSubnet,
} from "aws-cdk-lib/aws-ec2";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
  TargetType,
  ListenerAction,
  SslPolicy,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Effect, Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { CfnPullThroughCacheRule } from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";

export interface DLTConsoleAlbEcsConstructProps {
  readonly s3LogsBucket: Bucket;
  readonly solutionId: string;
  readonly buildFromSource: boolean;
  readonly consoleDomainName: string; // Custom domain for web console
  readonly certificateArn: string; // ACM certificate for HTTPS
  readonly webConsoleImageUri: string; // User-provided mirrored image (empty string if not provided)
  readonly webConsoleZipKey: string; // S3 key for web console assets ZIP
  readonly deployWaf: string; // "Yes" or "No" - whether to deploy WAF WebACL on the ALB
}

export class DLTConsoleAlbEcsConstruct extends Construct {
  public webAppURL: string;
  public consoleBucketArn: string;
  public consoleBucket: IBucket;
  public webConsoleImageAsset: DockerImageAsset | undefined;
  public albDnsName: string;
  public readonly webConsoleContainer: ContainerDefinition;

  // Flag to indicate this stack needs web console ZIP generation
  public readonly needsWebConsoleZip = true;

  constructor(scope: Construct, id: string, props: DLTConsoleAlbEcsConstructProps) {
    super(scope, id);

    // S3 bucket for web console assets
    const consoleBucket = new Bucket(this, "ConsoleBucket", {
      removalPolicy: RemovalPolicy.RETAIN,
      serverAccessLogsBucket: props.s3LogsBucket,
      serverAccessLogsPrefix: "console-bucket-access/",
      encryption: BucketEncryption.KMS_MANAGED,
      enforceSSL: true,
      versioned: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });
    this.consoleBucket = consoleBucket;
    this.consoleBucketArn = consoleBucket.bucketArn;

    const dockerRepoName = "distributed-load-testing-on-aws-web-console";

    if (props.buildFromSource) {
      this.webConsoleImageAsset = new DockerImageAsset(this, "WebConsoleImage", {
        directory: path.join(__dirname, `../../../../deployment/ecr/${dockerRepoName}`),
        platform: Platform.LINUX_AMD64,
      });
    }

    const vpc = new Vpc(this, "WebConsoleVpc", {
      maxAzs: 2,
      natGateways: 0, // No NAT Gateway - uses VPC endpoints
      enableDnsHostnames: true,
      enableDnsSupport: true,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: false, // Disable auto-assign public IP for security compliance
        },
        {
          name: "Private",
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Add cfn-guard suppressions for public subnets (ALB requires public subnets but we disable auto-assign)
    vpc.publicSubnets.forEach((subnet) => {
      const cfnSubnet = subnet.node.defaultChild as CfnSubnet;
      cfnSubnet.addMetadata("guard", {
        SuppressedRules: ["SUBNET_AUTO_ASSIGN_PUBLIC_IP_DISABLED"],
      });
      cfnSubnet.addMetadata("cfn_nag", {
        rules_to_suppress: [
          { id: "W33", reason: "Public subnets required for internet-facing ALB, auto-assign disabled" },
        ],
      });
    });

    // ALB Security Group - inbound 443 from internet
    const albSg = new SecurityGroup(this, "AlbSg", {
      vpc,
      description: "ALB security group - HTTPS from internet",
      allowAllOutbound: false,
    });
    albSg.addIngressRule(Peer.anyIpv4(), Port.tcp(443), "Allow HTTPS from internet");
    albSg.addIngressRule(Peer.anyIpv4(), Port.tcp(80), "Allow HTTP for redirect to HTTPS");

    // Add cfn-guard suppressions for ALB security group (internet-facing ALB requires open ingress)
    const albSgResource = albSg.node.defaultChild as CfnResource;
    albSgResource.addMetadata("guard", {
      SuppressedRules: [
        "SECURITY_GROUP_MISSING_EGRESS_RULE",
        "EC2_SECURITY_GROUP_INGRESS_OPEN_TO_WORLD_RULE",
        "SECURITY_GROUP_INGRESS_CIDR_NON_32_RULE",
      ],
    });
    albSgResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "W2", reason: "Internet-facing ALB requires ingress from 0.0.0.0/0 for HTTPS traffic" },
        { id: "W5", reason: "Egress restricted to ECS tasks only via explicit rule" },
        { id: "W9", reason: "Internet-facing ALB requires ingress from 0.0.0.0/0" },
        { id: "F1000", reason: "Egress rule added explicitly to ECS security group" },
      ],
    });

    // ECS Security Group - inbound 8080 from ALB only, outbound to VPC endpoints and S3
    const ecsSg = new SecurityGroup(this, "EcsSg", {
      vpc,
      description: "ECS tasks security group",
      // S3 Gateway endpoint uses prefix lists (not SGs), so we can't restrict outbound to S3 via SG rules.
      // This VPC has no NAT/internet access, so outbound traffic is limited to VPC endpoints only.
      allowAllOutbound: true,
    });
    ecsSg.addIngressRule(albSg, Port.tcp(8080), "Allow HTTP from ALB");

    // Add cfn-guard suppressions for ECS security group
    const ecsSgResource = ecsSg.node.defaultChild as CfnResource;
    ecsSgResource.addMetadata("guard", {
      SuppressedRules: ["EC2_SECURITY_GROUP_EGRESS_OPEN_TO_WORLD_RULE", "SECURITY_GROUP_EGRESS_ALL_PROTOCOLS_RULE"],
    });
    ecsSgResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W5",
          reason:
            "ECS tasks require outbound access to S3 Gateway endpoint (prefix list) and VPC interface endpoints. VPC has no NAT/internet gateway.",
        },
        {
          id: "W40",
          reason: "Egress to S3 Gateway endpoint requires all protocols as it uses prefix lists, not security groups",
        },
      ],
    });

    // ALB outbound to ECS
    albSg.addEgressRule(ecsSg, Port.tcp(8080), "Allow HTTP to ECS tasks");

    // VPC Endpoints Security Group - inbound 443 from ECS
    const vpcEndpointSg = new SecurityGroup(this, "VpcEndpointSg", {
      vpc,
      description: "VPC endpoints security group",
      allowAllOutbound: false,
    });
    vpcEndpointSg.addIngressRule(ecsSg, Port.tcp(443), "Allow HTTPS from ECS tasks");
    // Add explicit egress rule to satisfy cfn-guard
    vpcEndpointSg.addEgressRule(ecsSg, Port.tcp(443), "Allow HTTPS response to ECS tasks");

    // Add cfn-guard suppressions for VPC endpoint security group
    const vpcEndpointSgResource = vpcEndpointSg.node.defaultChild as CfnResource;
    vpcEndpointSgResource.addMetadata("guard", {
      SuppressedRules: ["SECURITY_GROUP_EGRESS_PORT_RANGE_RULE", "SECURITY_GROUP_MISSING_EGRESS_RULE"],
    });
    vpcEndpointSgResource.addMetadata("cfn_nag", {
      rules_to_suppress: [{ id: "W5", reason: "VPC endpoint security group egress restricted to ECS tasks only" }],
    });

    // S3 Gateway Endpoint - attached to private route tables
    // Note: S3 Gateway endpoints use route tables, not security groups
    // ECR stores image layers in S3, so this endpoint is required for docker pull
    vpc.addGatewayEndpoint("S3Endpoint", {
      service: GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: SubnetType.PRIVATE_ISOLATED }],
    });

    vpc.addInterfaceEndpoint("EcrApiEndpoint", {
      service: InterfaceVpcEndpointAwsService.ECR,
      subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [vpcEndpointSg],
      privateDnsEnabled: true,
    });

    // ECR DKR Endpoint (for docker pull)
    vpc.addInterfaceEndpoint("EcrDkrEndpoint", {
      service: InterfaceVpcEndpointAwsService.ECR_DOCKER,
      subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [vpcEndpointSg],
      privateDnsEnabled: true,
    });

    vpc.addInterfaceEndpoint("LogsEndpoint", {
      service: InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [vpcEndpointSg],
      privateDnsEnabled: true,
    });

    // Variables for pull-through cache (only used when buildFromSource=false)
    let usePullThroughCache: CfnCondition | undefined;
    let pullThroughPrefix: string | undefined;
    let pullThroughImageUri: string | undefined;

    // Extract path from PUBLIC_ECR_REGISTRY (e.g., "public.ecr.aws/aws-solutions" -> "aws-solutions")
    const publicEcrRegistry = process.env.PUBLIC_ECR_REGISTRY || "public.ecr.aws/aws-solutions";
    const publicEcrPath = publicEcrRegistry.replace("public.ecr.aws/", "");

    // Pull-through cache resources
    if (!props.buildFromSource) {
      // Condition: use pull-through cache when WebConsoleImageUri is not provided
      usePullThroughCache = new CfnCondition(this, "UsePullThroughCache", {
        expression: Fn.conditionEquals(props.webConsoleImageUri, ""),
      });

      // Pull-through cache rule with unique prefix per stack instance
      // Uses fixed "dlt" prefix + stack ID suffix for uniqueness (max 16 chars, under 20 limit)
      // Stack ID format: arn:aws:cloudformation:region:account:stack/stack-name/uuid
      const stackIdSuffix = Fn.select(4, Fn.split("-", Fn.select(2, Fn.split("/", Aws.STACK_ID))));
      pullThroughPrefix = Fn.join("-", ["dlt", stackIdSuffix]); // e.g., "dlt-a1b2c3d4e5f6"

      const pullThroughCacheRule = new CfnPullThroughCacheRule(this, "EcrPullThroughCache", {
        ecrRepositoryPrefix: pullThroughPrefix,
        upstreamRegistryUrl: "public.ecr.aws",
      });
      pullThroughCacheRule.cfnOptions.condition = usePullThroughCache;

      // Pull-through cache image URI
      pullThroughImageUri = Fn.join("", [
        Aws.ACCOUNT_ID,
        ".dkr.ecr.",
        Aws.REGION,
        ".amazonaws.com/",
        pullThroughPrefix,
        "/",
        publicEcrPath,
        "/",
        dockerRepoName,
        ":",
        process.env.PUBLIC_ECR_TAG || "",
      ]);
    }

    const cluster = new Cluster(this, "WebConsoleCluster", {
      vpc,
      containerInsights: true,
    });
    Tags.of(cluster).add("SolutionId", props.solutionId);

    const logGroup = new LogGroup(this, "WebConsoleLogGroup", {
      retention: RetentionDays.ONE_YEAR,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    Tags.of(logGroup).add("SolutionId", props.solutionId);

    // Add cfn-guard suppression for log group encryption (using default CloudWatch encryption)
    const logGroupResource = logGroup.node.defaultChild as CfnResource;
    logGroupResource.addMetadata("guard", {
      SuppressedRules: ["CLOUDWATCH_LOG_GROUP_ENCRYPTED"],
    });
    logGroupResource.addMetadata("cfn_nag", {
      rules_to_suppress: [{ id: "W84", reason: "CloudWatch Logs are encrypted by default with AWS managed keys" }],
    });

    // Build ECR policy statements based on deployment mode
    const ecrPolicyStatements: PolicyStatement[] = [];
    let pullThroughRepoArn: string | undefined;

    if (props.buildFromSource) {
      // buildFromSource: only need read-only access to CDK assets repository
      ecrPolicyStatements.push(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"],
          resources: [`arn:${Aws.PARTITION}:ecr:${Aws.REGION}:${Aws.ACCOUNT_ID}:repository/cdk-*`],
        })
      );
    } else if (usePullThroughCache && pullThroughPrefix) {
      // Pull-through cache repository ARN
      pullThroughRepoArn = Fn.join("", [
        `arn:${Aws.PARTITION}:ecr:${Aws.REGION}:${Aws.ACCOUNT_ID}:repository/`,
        pullThroughPrefix,
        "/",
        publicEcrPath,
        "/",
        dockerRepoName,
      ]);

      // Custom image repository ARN (extract repo path from URI: account.dkr.ecr.region.amazonaws.com/repo/path:tag)
      // Step 1: Remove tag by splitting on ":" and taking first part
      // Step 2: Extract repo path by splitting on ".amazonaws.com/" and taking second part
      const uriWithoutTag = Fn.select(0, Fn.split(":", props.webConsoleImageUri));
      const repoPath = Fn.select(1, Fn.split(".amazonaws.com/", uriWithoutTag));
      const customImageRepoArn = Fn.join("", [
        `arn:${Aws.PARTITION}:ecr:${Aws.REGION}:${Aws.ACCOUNT_ID}:repository/`,
        repoPath,
      ]);

      // Read-only ECR actions - repo ARN selected at deploy time via CloudFormation condition
      const targetRepoArn = Fn.conditionIf(
        usePullThroughCache.logicalId,
        pullThroughRepoArn,
        customImageRepoArn
      ).toString();

      ecrPolicyStatements.push(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"],
          resources: [targetRepoArn],
        })
      );
    }

    // Task Execution Role - pull images and write logs
    const taskExecutionRole = new Role(this, "TaskExecutionRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      inlinePolicies: {
        ECSTaskExecutionPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
              resources: [logGroup.logGroupArn, `${logGroup.logGroupArn}:*`],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["ecr:GetAuthorizationToken"],
              resources: ["*"],
            }),
            ...ecrPolicyStatements,
          ],
        }),
      },
    });

    // Add cfn-guard suppressions for task execution role
    const taskExecutionRoleResource = taskExecutionRole.node.defaultChild as CfnResource;
    taskExecutionRoleResource.addMetadata("guard", {
      SuppressedRules: ["IAM_NO_INLINE_POLICY_CHECK", "IAM_POLICYDOCUMENT_NO_WILDCARD_RESOURCE"],
    });
    taskExecutionRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "F10", reason: "Inline policy required for ECS task execution role with specific permissions" },
        {
          id: "W11",
          reason: "ecr:GetAuthorizationToken requires wildcard resource as it is an account-level action",
        },
      ],
    });

    // Pull-through cache write policy - only when using pull-through cache (not custom image)
    if (!props.buildFromSource && usePullThroughCache && pullThroughRepoArn) {
      const pullThroughPolicy = new Policy(this, "PullThroughCacheWritePolicy", {
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ["ecr:CreateRepository", "ecr:BatchImportUpstreamImage"],
            resources: [pullThroughRepoArn],
          }),
        ],
      });
      pullThroughPolicy.attachToRole(taskExecutionRole);
      (pullThroughPolicy.node.defaultChild as import("aws-cdk-lib").CfnResource).cfnOptions.condition =
        usePullThroughCache;
    }

    // Task Role - container access to S3
    const taskRole = new Role(this, "TaskRole", {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      inlinePolicies: {
        S3AccessPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ["s3:GetObject"],
              resources: [`${consoleBucket.bucketArn}/${props.webConsoleZipKey}`],
            }),
          ],
        }),
      },
    });

    // Add cfn-guard suppressions for task role
    const taskRoleResource = taskRole.node.defaultChild as CfnResource;
    taskRoleResource.addMetadata("guard", {
      SuppressedRules: ["IAM_NO_INLINE_POLICY_CHECK"],
    });
    taskRoleResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "F10", reason: "Inline policy required for ECS task role with specific S3 permissions" },
      ],
    });

    const taskDefinition = new FargateTaskDefinition(this, "WebConsoleTaskDef", {
      cpu: 256,
      memoryLimitMiB: 512,
      executionRole: taskExecutionRole,
      taskRole,
    });
    Tags.of(taskDefinition).add("SolutionId", props.solutionId);

    // Determine container image URI (runtime selection via CloudFormation)
    let containerImage: ContainerImage;
    if (props.buildFromSource && this.webConsoleImageAsset) {
      containerImage = ContainerImage.fromDockerImageAsset(this.webConsoleImageAsset);
    } else {
      // Use WebConsoleImageUri if provided, otherwise use pull-through cache
      const imageUri = Fn.conditionIf(
        usePullThroughCache!.logicalId,
        pullThroughImageUri!,
        props.webConsoleImageUri
      ).toString();
      containerImage = ContainerImage.fromRegistry(imageUri);
    }

    this.webConsoleContainer = taskDefinition.addContainer("WebConsoleContainer", {
      containerName: "web-console",
      image: containerImage,
      essential: true,
      portMappings: [{ containerPort: 8080, protocol: Protocol.TCP }],
      environment: {
        S3_BUCKET: consoleBucket.bucketName,
        S3_KEY: props.webConsoleZipKey,
      },
      logging: LogDriver.awsLogs({
        streamPrefix: "web-console",
        logGroup,
      }),
    });

    const alb = new ApplicationLoadBalancer(this, "WebConsoleAlb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
    });
    this.albDnsName = alb.loadBalancerDnsName;

    const albAccessLogsPrefix = "alb-access-logs";

    // ALB access logs bucket policy per AWS docs:
    // https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html
    props.s3LogsBucket.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal("logdelivery.elasticloadbalancing.amazonaws.com")],
        actions: ["s3:PutObject"],
        resources: [props.s3LogsBucket.arnForObjects(`${albAccessLogsPrefix}/AWSLogs/${Aws.ACCOUNT_ID}/*`)],
        conditions: {
          ArnLike: {
            "aws:SourceArn": `arn:${Aws.PARTITION}:elasticloadbalancing:*:${Aws.ACCOUNT_ID}:loadbalancer/*`,
          },
        },
      })
    );

    // Configure ALB access logging via L2 setAttribute (preserves default attributes like deletion_protection)
    alb.setAttribute("access_logs.s3.enabled", "true");
    alb.setAttribute("access_logs.s3.bucket", props.s3LogsBucket.bucketName);
    alb.setAttribute("access_logs.s3.prefix", albAccessLogsPrefix);

    // The ALB validates access log permissions at creation time, so the bucket
    // policy must be deployed first.
    alb.node.addDependency(props.s3LogsBucket.policy!);

    const albResource = alb.node.defaultChild as CfnResource;
    albResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        {
          id: "W52",
          reason: "ALB access logging is enabled to the S3 logs bucket.",
        },
      ],
    });

    // WAF WebACL - deployed by default, can be disabled via DeployWAF parameter
    const deployWafCondition = new CfnCondition(this, "DeployWAFCondition", {
      expression: Fn.conditionEquals(props.deployWaf, "Yes"),
    });

    // Helper to build an AWS managed rule group entry for the WebACL
    const managedRule = (name: string, priority: number): CfnWebACL.RuleProperty => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: { managedRuleGroupStatement: { vendorName: "AWS", name } },
      visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: name, sampledRequestsEnabled: true },
    });

    // WAF WebACL with AWS Managed Rules for the ALB.
    // Default action: Allow. All rule groups use overrideAction: none (block mode).
    // Reference: https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-list.html
    //
    //   1. CRS — Baseline. Blocks XSS, LFI/RFI, SSRF, bad bots, oversized requests. OWASP Top 10.
    //      AWS docs: "consider using this rule group for any AWS WAF use case."
    //      https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html
    //
    //   2. AmazonIpReputationList — IP reputation. Blocks IPs flagged by Amazon threat intel (MadPot).
    //      Low cost (25 WCU) and no false-positive risk for legitimate users.
    //      https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-ip-rep.html
    //
    //   3. AnonymousIpList — IP reputation. Blocks TOR, VPNs, proxies, hosting providers.
    //      Appropriate for an admin console where operators should not be anonymized.
    //      Note: HostingProviderIPList may block users in cloud-hosted environments (Cloud9,
    //      WorkSpaces). Set it to Count via rule action override if this causes false positives.
    //      https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-ip-rep.html
    const webAcl = new CfnWebACL(this, "AlbWebAcl", {
      defaultAction: { allow: {} },
      scope: "REGIONAL",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "DLTConsoleAlbWebAcl",
        sampledRequestsEnabled: true,
      },
      rules: [
        managedRule("AWSManagedRulesCommonRuleSet", 1),
        managedRule("AWSManagedRulesAmazonIpReputationList", 2),
        managedRule("AWSManagedRulesAnonymousIpList", 3),
      ],
    });
    webAcl.cfnOptions.condition = deployWafCondition;
    Tags.of(webAcl).add("SolutionId", props.solutionId);

    const webAclAssociation = new CfnWebACLAssociation(this, "AlbWebAclAssociation", {
      resourceArn: alb.loadBalancerArn,
      webAclArn: webAcl.attrArn,
    });
    webAclAssociation.cfnOptions.condition = deployWafCondition;

    // WAF logging to CloudWatch Logs for audit, investigation, and rule tuning.
    // Log group name must start with "aws-waf-logs-" per WAF requirements.
    const wafLogGroup = new LogGroup(this, "WafLogGroup", {
      logGroupName: Fn.join("", ["aws-waf-logs-", Aws.STACK_NAME]),
      retention: RetentionDays.ONE_YEAR,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const wafLogGroupResource = wafLogGroup.node.defaultChild as CfnResource;
    wafLogGroupResource.cfnOptions.condition = deployWafCondition;
    wafLogGroupResource.addMetadata("guard", {
      SuppressedRules: ["CLOUDWATCH_LOG_GROUP_ENCRYPTED"],
    });
    wafLogGroupResource.addMetadata("cfn_nag", {
      rules_to_suppress: [{ id: "W84", reason: "CloudWatch Logs are encrypted by default with AWS managed keys" }],
    });

    const wafLoggingConfig = new CfnLoggingConfiguration(this, "WafLoggingConfig", {
      resourceArn: webAcl.attrArn,
      logDestinationConfigs: [wafLogGroup.logGroupArn],
    });
    wafLoggingConfig.cfnOptions.condition = deployWafCondition;

    // Target Group - IP type, HTTP on 8080 (non-root container), health check on /healthz
    const targetGroup = new ApplicationTargetGroup(this, "WebConsoleTg", {
      vpc,
      port: 8080,
      protocol: ApplicationProtocol.HTTP,
      targetType: TargetType.IP,
      healthCheck: {
        path: "/healthz",
        interval: Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // HTTPS Listener with ACM certificate and TLS 1.2 policy
    const certificate = Certificate.fromCertificateArn(this, "Certificate", props.certificateArn);
    const httpsListener = alb.addListener("HttpsListener", {
      port: 443,
      protocol: ApplicationProtocol.HTTPS,
      certificates: [certificate],
      defaultTargetGroups: [targetGroup],
      sslPolicy: SslPolicy.TLS12,
    });

    // Add cfn-guard suppression for HTTPS listener (TLS 1.2 policy is set)
    const httpsListenerResource = httpsListener.node.defaultChild as CfnResource;
    httpsListenerResource.addMetadata("guard", {
      SuppressedRules: ["ELBV2_LISTENER_SSL_POLICY_RULE"],
    });

    // HTTP to HTTPS redirect listener
    const httpListener = alb.addListener("HttpRedirectListener", {
      port: 80,
      protocol: ApplicationProtocol.HTTP, // NOSONAR - S5332: HTTP listener used solely for 301 redirect to HTTPS, no content served over plain HTTP
      defaultAction: ListenerAction.redirect({
        protocol: "HTTPS",
        port: "443",
        permanent: true,
      }),
    });

    // Add cfn-guard suppressions for HTTP redirect listener (intentionally HTTP for redirect)
    const httpListenerResource = httpListener.node.defaultChild as CfnResource;
    httpListenerResource.addMetadata("guard", {
      SuppressedRules: ["ELBV2_LISTENER_SSL_POLICY_RULE", "ELBV2_LISTENER_PROTOCOL_RULE"],
    });
    httpListenerResource.addMetadata("cfn_nag", {
      rules_to_suppress: [
        { id: "W55", reason: "HTTP listener is used solely for redirecting to HTTPS" },
        { id: "W56", reason: "HTTP listener is used solely for redirecting to HTTPS, not serving content" },
      ],
    });

    this.webAppURL = `https://${props.consoleDomainName}`;

    const service = new FargateService(this, "WebConsoleService", {
      cluster,
      taskDefinition,
      desiredCount: 2,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      healthCheckGracePeriod: Duration.seconds(120),
      circuitBreaker: { rollback: true },
    });

    service.attachToApplicationTargetGroup(targetGroup);
  }
}
