// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// lib/parser constructs SDK clients at import time; lib/native imports it for acceptedCodes.
jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDB: jest.fn(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocument: {
    from: jest.fn(() => ({ update: jest.fn(), put: jest.fn() })),
  },
}));

jest.mock("@aws-sdk/client-s3", () => ({
  S3: jest.fn(() => ({ putObject: jest.fn() })),
}));

process.env.SOLUTION_ID = "SO0062";
process.env.VERSION = "3.0.0";

const locustResultFixture = require("../../../load-tester/test/fixtures/locust-result.json");
const k6ResultFixture = require("../../../load-tester/test/fixtures/k6-result.json");
const jmeterResultFixture = require("../../../load-tester/test/fixtures/jmeter-result.json");
const { ResultAccumulator, finalizeResultState } = require("@amzn/dlt-common/streaming-statistics");
const native = require("./index.js");
const parser = require("../parser/index.js");

describe("#NATIVE MAPPER::", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("mergeable artifacts", () => {
    it.each([
      ["Locust", locustResultFixture],
      ["k6", k6ResultFixture],
      ["JMeter", jmeterResultFixture],
    ])("consumes the checked-in %s fixture", (_framework, fixture) => {
      const task = native.validateArtifact(structuredClone(fixture), {
        testId: fixture.testId,
        region: fixture.region,
        taskId: fixture.taskId,
      });
      const aggregate = native.createAggregate();
      const merge = jest.spyOn(ResultAccumulator.prototype, "merge");

      expect(native.addTask(aggregate, task)).toBe(fixture.statistics.summary.requests.total);

      expect(merge).toHaveBeenCalledTimes(1);
      expect(native.toMergedTaskResult(aggregate).stats.throughput).toBe(fixture.statistics.summary.requests.total);
    });

    it("merges uneven tasks before formatting the regional or total result", async () => {
      const first = taskArtifact({
        taskId: "task-1",
        duration: 40,
        concurrency: 2,
        labelConcurrency: { "/first": 8, "/shared": 2 },
        observations: [
          {
            label: "/first",
            latencyUs: 100_000,
            waitingTimeUs: 10_000,
            connectTimeUs: 1_000,
            bytes: 100,
            success: true,
            responseCode: "200",
          },
          {
            label: "/shared",
            latencyUs: 200_000,
            waitingTimeUs: 20_000,
            connectTimeUs: 2_000,
            bytes: 200,
            success: true,
            responseCode: "200",
          },
        ],
      });
      const second = taskArtifact({
        taskId: "task-2",
        duration: 80,
        concurrency: 6,
        labelConcurrency: { "/shared": 6 },
        observations: [
          {
            label: "/shared",
            latencyUs: 300_000,
            waitingTimeUs: 30_000,
            connectTimeUs: 3_000,
            bytes: 300,
            success: false,
            responseCode: "500",
          },
          {
            label: "/shared",
            latencyUs: 500_000,
            waitingTimeUs: 50_000,
            connectTimeUs: 5_000,
            bytes: 400,
            success: true,
            responseCode: "200",
          },
          {
            label: "/shared",
            latencyUs: 700_000,
            waitingTimeUs: 70_000,
            connectTimeUs: 7_000,
            bytes: 500,
            success: true,
            responseCode: "200",
          },
        ],
      });
      const tasks = [first, second].map((task) =>
        native.validateArtifact(task, {
          testId: task.testId,
          region: task.region,
          taskId: task.taskId,
        })
      );
      const aggregate = native.createAggregate();
      for (const task of tasks) native.addTask(aggregate, task);

      const merged = native.toMergedTaskResult(aggregate);

      expect(merged.stats).toMatchObject({
        avg_ct: 0.0036,
        avg_lt: 0.036,
        avg_rt: 0.36,
        bytes: 1500,
        concurrency: 4,
        fail: 1,
        p0_0: 0.1,
        p50_0: 0.300431,
        p90_0: 0.7,
        p95_0: 0.7,
        p99_0: 0.7,
        p99_9: 0.7,
        p100_0: 0.7,
        stdev_rt: 0.21540659228538017,
        succ: 4,
        testDuration: 60,
        throughput: 5,
        rc: [{ code: "500", count: 1 }],
      });
      expect(merged.labels.map(({ label, concurrency }) => ({ label, concurrency }))).toEqual([
        { label: "/first", concurrency: 8 },
        { label: "/shared", concurrency: 4 },
      ]);
      expect(merged.labels).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "/first",
            bytes: 100,
            fail: 0,
            succ: 1,
            throughput: 1,
            rc: [],
          }),
          expect.objectContaining({
            label: "/shared",
            bytes: 1400,
            fail: 1,
            succ: 3,
            throughput: 4,
            rc: [{ code: "500", count: 1 }],
          }),
        ])
      );

      const formatted = await parser.finalResults("test", [merged]);
      expect(formatted).toMatchObject({
        avg_ct: "0.00360",
        avg_lt: "0.03600",
        avg_rt: "0.36000",
        bytes: "1500",
        concurrency: "4",
        fail: 1,
        p50_0: "0.300",
        stdev_rt: "0.215",
        succ: 4,
        testDuration: "60",
        throughput: 5,
        rc: [{ code: "500", count: 1 }],
      });

      const secondRegion = native.createAggregate();
      native.addTask(secondRegion, tasks[1]);
      const groupedTotal = native.createAggregate();
      native.addAggregate(groupedTotal, aggregate);
      native.addAggregate(groupedTotal, secondRegion);
      const flatTotal = native.createAggregate();
      for (const task of [...tasks, tasks[1]]) native.addTask(flatTotal, task);

      await expect(parser.finalResults("test", [native.toMergedTaskResult(groupedTotal)])).resolves.toEqual(
        await parser.finalResults("test", [native.toMergedTaskResult(flatTotal)])
      );
    });

    it("rejects display-only artifacts, invalid statistics, and label mismatches without mutation", () => {
      const displayOnly = structuredClone(locustResultFixture);
      delete displayOnly.statistics;
      expect(() =>
        native.validateArtifact(displayOnly, {
          testId: displayOnly.testId,
          region: displayOnly.region,
          taskId: displayOnly.taskId,
        })
      ).toThrow();

      const invalidStatistics = structuredClone(locustResultFixture);
      invalidStatistics.statistics.summary.latency.histogram.bins[0][1] += 1;
      const invalidTask = native.validateArtifact(invalidStatistics, {
        testId: invalidStatistics.testId,
        region: invalidStatistics.region,
        taskId: invalidStatistics.taskId,
      });
      const aggregate = native.createAggregate();
      const validTask = native.validateArtifact(structuredClone(locustResultFixture), {
        testId: locustResultFixture.testId,
        region: locustResultFixture.region,
        taskId: locustResultFixture.taskId,
      });
      native.addTask(aggregate, validTask);
      const before = native.toMergedTaskResult(aggregate);
      expect(() => native.addTask(aggregate, invalidTask)).toThrow(/histogram count/i);
      expect(native.toMergedTaskResult(aggregate)).toEqual(before);

      const missingLabel = structuredClone(locustResultFixture);
      missingLabel.labels.pop();
      expect(() =>
        native.validateArtifact(missingLabel, {
          testId: missingLabel.testId,
          region: missingLabel.region,
          taskId: missingLabel.taskId,
        })
      ).toThrow(/labels must match/i);
    });

    it("validates a zero-request task once without adding it to the aggregate", () => {
      const artifact = taskArtifact({
        taskId: "empty",
        duration: 60,
        concurrency: 0,
        observations: [],
      });
      const task = native.validateArtifact(artifact, {
        testId: artifact.testId,
        region: artifact.region,
        taskId: artifact.taskId,
      });
      const aggregate = native.createAggregate();
      const merge = jest.spyOn(ResultAccumulator.prototype, "merge");

      expect(native.addTask(aggregate, task)).toBe(0);

      expect(merge).toHaveBeenCalledTimes(1);
      expect(aggregate.taskCount).toBe(0);
      expect(aggregate.accumulator.snapshot().summary.requests.total).toBe(0);
    });

    it.each(["testId", "region", "taskId"])("rejects a mismatched %s", (field) => {
      expect(() =>
        native.validateArtifact(structuredClone(locustResultFixture), {
          testId: locustResultFixture.testId,
          region: locustResultFixture.region,
          taskId: locustResultFixture.taskId,
          [field]: "wrong",
        })
      ).toThrow(new RegExp(`${field} must match`));
    });

    it("validates consumed task metadata and concurrency", () => {
      const invalidMetadata = structuredClone(locustResultFixture);
      invalidMetadata.task.vcpus = 0;
      expect(() =>
        native.validateArtifact(invalidMetadata, {
          testId: invalidMetadata.testId,
          region: invalidMetadata.region,
          taskId: invalidMetadata.taskId,
        })
      ).toThrow(/task.vcpus/);

      const invalidConcurrency = structuredClone(locustResultFixture);
      invalidConcurrency.labels[0].concurrency = -1;
      expect(() =>
        native.validateArtifact(invalidConcurrency, {
          testId: invalidConcurrency.testId,
          region: invalidConcurrency.region,
          taskId: invalidConcurrency.taskId,
        })
      ).toThrow(/concurrency/);
    });

    it("ignores producer display statistics other than concurrency and label names", () => {
      const artifact = structuredClone(locustResultFixture);
      artifact.summary.averageResponseTimeMilliseconds = 999_999;
      artifact.labels[0].failureCount = 999_999;

      const task = native.validateArtifact(artifact, {
        testId: artifact.testId,
        region: artifact.region,
        taskId: artifact.taskId,
      });
      const aggregate = native.createAggregate();
      native.addTask(aggregate, task);

      expect(native.toMergedTaskResult(aggregate).stats.avg_rt).toBeCloseTo(0.1166666667);
    });
  });
});

function taskArtifact({ taskId, duration, concurrency, labelConcurrency, observations }) {
  const accumulator = new ResultAccumulator();
  for (const observation of observations) accumulator.recordCompletedRequest(observation);
  const statistics = accumulator.snapshot();
  const display = finalizeResultState(statistics, {
    summaryConcurrency: concurrency,
    labelConcurrency: new Map(statistics.labels.map(({ label }) => [label, labelConcurrency?.[label] ?? concurrency])),
  });

  return {
    schema: "dlt.result.v1",
    testId: "test",
    taskId,
    region: "us-east-1",
    startTime: "2026-08-28T00:00:00.000Z",
    endTime: "2026-08-28T00:01:00.000Z",
    testDurationSeconds: duration,
    task: { vcpus: 1, memoryMiB: 2048, ecsDurationSeconds: duration + 5 },
    ...display,
    statistics,
  };
}
