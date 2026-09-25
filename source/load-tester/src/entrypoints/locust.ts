// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Container entrypoint for the Locust image. Bundled by
// deployment/ecr/distributed-load-testing-on-aws-load-tester-locust/pre-build.sh.

import { LogEvent } from "@amzn/dlt-common";

import { fetchEcsTaskMetadata } from "../ecs-metadata.js";
import { parseEnv } from "../env.js";
import { runLifecycle } from "../lifecycle/run.js";
import { createLiveDataEmitter } from "../live-data/emitter.js";
import { createLogger } from "../logger.js";
import { LocustRunner } from "../runners/locust.js";

let logger = createLogger({ serviceName: "dlt-load-tester-locust" }).child({ framework: "locust" });

async function main(): Promise<void> {
  const env = parseEnv();
  logger = logger.child({ testId: env.testId, testRunId: env.testRunId, region: env.awsRegion });

  const taskMetadata = await fetchEcsTaskMetadata(env.ecsMetadataUri);
  logger = logger.child({ taskId: taskMetadata.taskId });

  // Locust's live data comes from the Python sidecar writing to stdout, so this
  // emitter goes unused. The lifecycle requires one, and JMeter and k6 will.
  const liveDataEmitter = createLiveDataEmitter({
    enabled: env.liveDataEnabled,
    testId: env.testId,
    region: env.awsRegion,
  });

  await runLifecycle({
    env,
    taskMetadata,
    runner: new LocustRunner(logger),
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
