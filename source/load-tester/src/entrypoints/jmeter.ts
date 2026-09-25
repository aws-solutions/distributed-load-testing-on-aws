// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Container entrypoint for the native JMeter image. Bundled by
// deployment/ecr/distributed-load-testing-on-aws-load-tester-jmeter/pre-build.sh.

import { LogEvent } from "@amzn/dlt-common";

import { fetchEcsTaskMetadata } from "../ecs-metadata.js";
import { parseEnv } from "../env.js";
import { runLifecycle } from "../lifecycle/run.js";
import { createLiveDataEmitter } from "../live-data/emitter.js";
import { createLogger } from "../logger.js";
import { JMeterRunner } from "../runners/jmeter.js";

const SERVICE_NAME = "dlt-load-tester-jmeter";

let logger = createLogger({ serviceName: SERVICE_NAME }).child({ framework: "jmeter" });

async function main(): Promise<void> {
  const env = parseEnv();
  logger = logger.child({ testId: env.testId, testRunId: env.testRunId, region: env.awsRegion });

  const taskMetadata = await fetchEcsTaskMetadata(env.ecsMetadataUri);
  logger = logger.child({ taskId: taskMetadata.taskId });

  const liveDataEmitter = createLiveDataEmitter({
    enabled: env.liveDataEnabled,
    testId: env.testId,
    region: env.awsRegion,
  });

  await runLifecycle({
    env,
    taskMetadata,
    runner: new JMeterRunner(logger),
    liveDataEmitter,
    logger,
  });
}

try {
  await main();
} catch (err: unknown) {
  logger.error({ err, logEvent: LogEvent.TASK_FAILED }, "fatal error");
  process.exit(1);
}
