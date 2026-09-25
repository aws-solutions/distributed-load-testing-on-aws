// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { maxTestDurationSecondsSchema } from "../api/create-test.ts";
import { TestStatus } from "../test-execution.ts";

const testTaskConfigSchema = z
  .object({
    region: z.string(),
    // legacy code may use strings, attempt coercing to number for safety
    taskCount: z.coerce.number(),
    // legacy code may use strings, attempt coercing to number for safety
    concurrency: z.coerce.number(),
    taskCluster: z.string().optional(),
    taskDefinition: z.string().optional(),
    subnetA: z.string().optional(),
    subnetB: z.string().optional(),
    taskSecurityGroup: z.string().optional(),
    ecsCloudWatchLogGroup: z.string().optional(),
    taskImage: z.string().optional(),
    taskRoleArn: z.string().optional(),
    executionRoleArn: z.string().optional(),
  })
  .passthrough();

export const scenarioRecordSchema = z
  .object({
    testId: z.string(),
    testName: z.string(),
    testType: z.string(),
    status: z.enum(TestStatus),
    testTaskConfigs: z.array(testTaskConfigSchema),
    // Stored as a JSON string in DDB; callers use JSON.parse when they need the object.
    testScenario: z.string(),
    desiredTaskCount: z.number().default(0),
    taskFailureCount: z.number().default(0),
    testDescription: z.string().optional(),
    fileType: z.string().optional(),
    showLive: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    cronValue: z.string().optional(),
    cronExpiryDate: z.string().optional(),
    scheduleRecurrence: z.string().optional(),
    scheduleTimezone: z.string().optional(),
    nextRun: z.string().optional(),
    eventBridge: z.string().optional(),
    testRunId: z.string().optional(),
    errorReason: z.string().optional(),
    totalTestRuns: z.number().optional(),
    healthyThreshold: z.number().optional(),
    baselineId: z.string().optional(),

    // Native Mode configuration. Read path is intentionally lenient: legacy
    // records may still carry a `loadOverrides` field, which is stripped here
    // (a non-strict object drops unknown keys) so existing scenarios keep
    // reading. Native mode now runs the load the uploaded script defines.
    nativeRunMode: z.object({ maxTestDurationSeconds: maxTestDurationSecondsSchema }).optional(),
  })
  .passthrough();

export type ScenarioRecord = z.infer<typeof scenarioRecordSchema>;
export type TestTaskConfig = z.infer<typeof testTaskConfigSchema>;
