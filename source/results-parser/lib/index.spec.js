// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const {
  mockS3,
  mockDDBDocumentClient,
  mockResultParserEvent,
  mockS3ListObjectResponse,
  mockParser,
  mockSolutionUtils,
  mockNativeArtifact,
  nativeResultKey,
} = require("./mock.js");

process.env = {
  RUNNING_UNIT_TESTS: "True",
  SCENARIOS_BUCKET: "MyBucket",
  SCENARIOS_TABLE: "MyTable",
  AWS_REGION: "none",
};

const { handler, _getFilesByRegion } = require("../index.js");
const { ResultAccumulator, finalizeResultState } = require("@amzn/dlt-common/streaming-statistics");
const k6ResultFixture = require("../../load-tester/test/fixtures/k6-result.json");
const actualParser = jest.requireActual("./parser");
const actualNative = jest.requireActual("./native");

describe("Test getFilesByRegion()", () => {
  beforeEach(() => {
    mockS3.getObject.mockReset();
  });

  it("test regex for aws region matches correctly in bucket object key", async () => {
    // Arrange
    const validRegion = "us-east-2";
    const validBucketObjectKey = `114.44:25:71T20-20-4202-a3677174-a062-4a50-bbe2-50b995a536b5-${validRegion}.xml`;
    const invalidBucketObjectKey = "114.44:25:71T20-20-4202-a3677174-a062-4a50-bbe2-50b995a536b5-my-test-region.xml";
    mockS3.getObject.mockImplementation(() => Promise.resolve(""));

    // Act & Assert
    const successResult = await _getFilesByRegion([{ Key: validBucketObjectKey }]);
    expect(successResult).toHaveProperty(validRegion);

    const failureResult = await _getFilesByRegion([{ Key: invalidBucketObjectKey }]);
    expect(failureResult).toEqual({}); // no matched region
  });
});

describe("Handler", () => {
  beforeEach(() => {
    mockDDBDocumentClient.update.mockReset();
    mockS3.listObjectsV2.mockReset();
    mockS3.getObject.mockReset();
    mockS3.putObject.mockReset();
    mockSolutionUtils.sendMetric.mockReset();
    mockParser.results.mockReset();
    mockParser.finalResults.mockReset();
    mockParser.updateTable.mockReset();
    mockParser.updateTestHistoryResults.mockReset();
    mockParser.updateFrameworkExitSummary.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  const successfulMocks = () => {
    mockDDBDocumentClient.update.mockImplementation(() => Promise.resolve(""));
    mockS3.listObjectsV2.mockImplementation(() => Promise.resolve(mockS3ListObjectResponse));
    mockS3.putObject.mockResolvedValue({});
    mockS3.getObject.mockImplementation(() =>
      Promise.resolve({
        Body: {
          transformToString: () => Promise.resolve("STREAMING_BLOB_VALUE"),
        },
      })
    );
    mockParser.results.mockReturnValue({});
    mockParser.finalResults.mockReturnValue({ metricLocation: "" });
  };

  it("test handler for successful invocation", async () => {
    // Arrange
    successfulMocks();

    // Act
    const response = await handler(mockResultParserEvent);

    // Assert
    expect(response).toEqual("success");
  });

  // --- Native mode (dlt.result.v1 artifacts) ---

  describe("native mode", () => {
    // A non-null nativeRunMode object on the execution input selects the native path.
    const nativeEvent = {
      ...mockResultParserEvent,
      testType: "locust",
      testTaskConfig: mockResultParserEvent.testTaskConfig.map((config) => ({ ...config, taskCount: 1 })),
      nativeRunMode: { maxTestDurationSeconds: 3600 },
    };
    const nativeEventForTasks = (taskCount, event = nativeEvent) => ({
      ...event,
      testTaskConfig: event.testTaskConfig.map((config) => ({ ...config, taskCount })),
    });

    // Bodies keyed by S3 key, so a test can make one artifact unreadable and leave the rest intact.
    const givenNativeObjects = (bodiesByKey) => {
      mockDDBDocumentClient.update.mockImplementation(() => Promise.resolve(""));
      mockS3.listObjectsV2.mockImplementation(() =>
        Promise.resolve({
          Contents: Object.entries(bodiesByKey).map(([Key, objectBody]) => ({
            Key,
            Size: Buffer.byteLength(objectBody),
          })),
        })
      );
      mockS3.getObject.mockImplementation(({ Key }) =>
        Promise.resolve({ Body: { transformToString: () => Promise.resolve(bodiesByKey[Key]) } })
      );
      mockS3.putObject.mockResolvedValue({});
      mockParser.finalResults.mockReturnValue({ metricLocation: "" });
    };

    const frameworkExitKey = (region = "my-region-1", taskId = "task-1") =>
      `results/Q9Isyy5DIK/2024-01-15T14-30-25_abc1234567/${region}/${taskId}/framework-exit.json`;
    const frameworkExitArtifact = (overrides = {}) => ({
      schema: "dlt.framework-exit.v1",
      timestamp: "2024-01-15T14:31:25.000Z",
      testId: "Q9Isyy5DIK",
      testRunId: "abc1234567",
      taskId: "task-1",
      region: "my-region-1",
      framework: "locust",
      exitCode: 1,
      message: "Framework exited non-zero",
      stopReason: "natural",
      ...overrides,
    });

    const metricOfType = (type) => mockSolutionUtils.sendMetric.mock.calls.find((call) => call[0].Type === type)[0];
    const testCompletionResult = () => metricOfType("TestCompletion").TestResult;

    // A task that issued no request at all still uploads a result.json.
    const noRequestArtifact = (taskId) => {
      const artifact = mockNativeArtifact({ taskId });
      const statistics = new ResultAccumulator().snapshot();
      return {
        ...artifact,
        ...finalizeResultState(statistics, { summaryConcurrency: artifact.summary.concurrency }),
        statistics,
      };
    };

    it("parses a native artifact without going through the XML parser", async () => {
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
      });

      const response = await handler(nativeEvent);

      expect(response).toEqual("success");
      expect(mockParser.results).not.toHaveBeenCalled();
      expect(mockParser.finalResults).toHaveBeenCalled();
      expect(mockS3.putObject).not.toHaveBeenCalled();
      expect(mockParser.updateFrameworkExitSummary).not.toHaveBeenCalled();
      expect(metricOfType("TestCompletion")).toMatchObject({
        TestRunId: "abc1234567",
        RunMode: "native",
      });
      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-1": 1 } })
      );
    });

    it("does not emit a framework summary when no exit artifacts exist", async () => {
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
      });

      await handler(nativeEvent);

      expect(mockSolutionUtils.sendMetric).not.toHaveBeenCalledWith(
        expect.objectContaining({ Type: "NativeFrameworkRunSummary" })
      );
      expect(mockParser.updateFrameworkExitSummary).not.toHaveBeenCalled();
    });

    it("aggregates exit codes across configured regions using the trusted framework", async () => {
      const event = {
        ...nativeEvent,
        executionFailed: true,
        testTaskConfig: [
          { ...nativeEvent.testTaskConfig[0], taskCount: 2 },
          { ...nativeEvent.testTaskConfig[0], region: "my-region-2", taskCount: 3 },
        ],
      };
      givenNativeObjects({
        [frameworkExitKey("my-region-1", "task-1")]: JSON.stringify(frameworkExitArtifact()),
        [frameworkExitKey("my-region-2", "task-2")]: JSON.stringify(
          frameworkExitArtifact({ region: "my-region-2", taskId: "task-2", exitCode: 2 })
        ),
        [frameworkExitKey("my-region-2", "task-3")]: JSON.stringify(
          frameworkExitArtifact({ region: "my-region-2", taskId: "task-3", exitCode: 1 })
        ),
      });

      await handler(event);

      expect(metricOfType("NativeFrameworkRunSummary")).toEqual({
        Type: "NativeFrameworkRunSummary",
        TestId: "Q9Isyy5DIK",
        TestRunId: "abc1234567",
        Framework: "locust",
        FrameworkExitTaskCount: 3,
        ExitCodeCounts: [
          { ExitCode: 1, TaskCount: 2 },
          { ExitCode: 2, TaskCount: 1 },
        ],
        InvalidExitArtifactCount: 0,
      });
    });

    it("uploads the framework-exit report before results and writes its summary afterward", async () => {
      const exit = frameworkExitArtifact();
      givenNativeObjects({
        [frameworkExitKey()]: JSON.stringify(exit),
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
      });

      await handler(nativeEvent);

      expect(mockS3.putObject).toHaveBeenCalledWith({
        Bucket: "MyBucket",
        Key: "results/Q9Isyy5DIK/2024-01-15T14-30-25_abc1234567/framework-exits/framework-exits.jsonl",
        Body: `${JSON.stringify(exit)}\n`,
        ContentType: "application/x-ndjson",
      });
      expect(mockParser.updateFrameworkExitSummary).toHaveBeenCalledWith({
        testId: "Q9Isyy5DIK",
        testRunId: "abc1234567",
        summary: {
          totalCount: 1,
          artifactKey: "results/Q9Isyy5DIK/2024-01-15T14-30-25_abc1234567/framework-exits/framework-exits.jsonl",
          top: [{ framework: "locust", exitCode: 1, message: exit.message, count: 1 }],
        },
      });
      expect(mockS3.putObject.mock.invocationCallOrder[0]).toBeLessThan(
        mockParser.updateTestHistoryResults.mock.invocationCallOrder[0]
      );
      expect(mockParser.updateTestHistoryResults.mock.invocationCallOrder[0]).toBeLessThan(
        mockParser.updateFrameworkExitSummary.mock.invocationCallOrder[0]
      );
    });

    it("persists framework-exit evidence and summary before rethrowing an existing result error", async () => {
      givenNativeObjects({
        [frameworkExitKey()]: JSON.stringify(frameworkExitArtifact()),
      });

      await expect(handler(nativeEvent)).rejects.toThrow(
        "Failed to parse results: Native result collection was incomplete"
      );

      expect(mockS3.putObject).toHaveBeenCalledTimes(1);
      expect(mockParser.updateFrameworkExitSummary).toHaveBeenCalledTimes(1);
      expect(mockParser.updateTable).not.toHaveBeenCalled();
      expect(mockSolutionUtils.sendMetric.mock.invocationCallOrder[0]).toBeLessThan(
        mockDDBDocumentClient.update.mock.invocationCallOrder[0]
      );
    });

    it("keeps normal result parsing successful when the aggregate upload fails", async () => {
      const secret = "CUSTOMER SECRET REPORT CONTENT";
      givenNativeObjects({
        [frameworkExitKey()]: JSON.stringify(frameworkExitArtifact()),
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
      });
      mockS3.putObject.mockRejectedValue(new Error(secret));
      const errorLog = jest.spyOn(console, "error");

      await expect(handler(nativeEvent)).resolves.toEqual("success");

      expect(mockParser.updateTable).toHaveBeenCalled();
      expect(mockParser.updateFrameworkExitSummary).not.toHaveBeenCalled();
      expect(metricOfType("NativeFrameworkRunSummary")).toMatchObject({
        FrameworkExitTaskCount: 1,
        ExitCodeCounts: [{ ExitCode: 1, TaskCount: 1 }],
      });
      expect(errorLog).toHaveBeenCalledWith("Framework-exit report upload failed");
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
      expect(JSON.stringify(mockSolutionUtils.sendMetric.mock.calls)).not.toContain(frameworkExitArtifact().message);
    });

    it("keeps normal result parsing successful when the summary update fails", async () => {
      givenNativeObjects({
        [frameworkExitKey()]: JSON.stringify(frameworkExitArtifact()),
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
      });
      mockParser.updateFrameworkExitSummary.mockRejectedValue(new Error("Item too large"));

      await expect(handler(nativeEvent)).resolves.toEqual("success");

      expect(mockS3.putObject).toHaveBeenCalledTimes(1);
      expect(mockParser.updateTable).toHaveBeenCalled();
      expect(metricOfType("NativeFrameworkRunSummary")).toMatchObject({ FrameworkExitTaskCount: 1 });
    });

    it("includes framework-exit artifacts from later listing pages", async () => {
      const resultKey = nativeResultKey("my-region-1", "task-1");
      const exitKey = frameworkExitKey();
      const bodiesByKey = {
        [resultKey]: JSON.stringify(mockNativeArtifact()),
        [exitKey]: JSON.stringify(frameworkExitArtifact()),
      };
      givenNativeObjects(bodiesByKey);
      mockS3.listObjectsV2
        .mockResolvedValueOnce({
          Contents: [{ Key: resultKey, Size: Buffer.byteLength(bodiesByKey[resultKey]) }],
          IsTruncated: true,
          NextContinuationToken: "page-2",
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: exitKey, Size: Buffer.byteLength(bodiesByKey[exitKey]) }],
          IsTruncated: false,
        });

      await handler(nativeEvent);

      expect(mockS3.listObjectsV2).toHaveBeenNthCalledWith(2, expect.objectContaining({ ContinuationToken: "page-2" }));
      expect(mockS3.putObject).toHaveBeenCalledTimes(1);
    });

    it("persists distinct regional results and their merged total through the legacy formatter", async () => {
      const twoRegionEvent = {
        ...nativeEvent,
        testTaskConfig: [
          { ...nativeEvent.testTaskConfig[0] },
          { ...nativeEvent.testTaskConfig[0], region: "my-region-2" },
        ],
      };
      const secondArtifact = {
        ...structuredClone(k6ResultFixture),
        testId: nativeEvent.testId,
        taskId: "task-2",
        region: "my-region-2",
      };
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
        [nativeResultKey("my-region-2", "task-2")]: JSON.stringify(secondArtifact),
      });
      mockParser.finalResults.mockImplementation(actualParser.finalResults);
      const addAggregate = jest.spyOn(actualNative, "addAggregate");

      await handler(twoRegionEvent);

      expect(addAggregate).toHaveBeenCalledTimes(2);
      const update = mockParser.updateTable.mock.calls[0][0];
      expect(update.completeTasks).toEqual({ "my-region-1": 1, "my-region-2": 1 });
      expect(update.finalResults["my-region-1"]).toMatchObject({
        avg_rt: "0.11667",
        bytes: "2560",
        concurrency: "10",
        fail: 1,
        succ: 2,
        throughput: 3,
        rc: [{ code: "500", count: 1 }],
      });
      expect(update.finalResults["my-region-2"]).toMatchObject({
        avg_ct: "0.00500",
        avg_lt: "0.06000",
        avg_rt: "0.07500",
        bytes: "100",
        concurrency: "1",
        fail: 0,
        succ: 1,
        throughput: 1,
        rc: [],
      });
      expect(update.finalResults.total).toMatchObject({
        avg_ct: "0.00125",
        avg_lt: "0.01500",
        avg_rt: "0.10625",
        bytes: "2660",
        concurrency: "6",
        fail: 1,
        succ: 3,
        testDuration: "60",
        throughput: 4,
        rc: [{ code: "500", count: 1 }],
      });
      expect(
        update.finalResults.total.labels.map(({ label, bytes, concurrency, fail, throughput }) => ({
          label,
          bytes,
          concurrency,
          fail,
          throughput,
        }))
      ).toEqual([
        { label: "/api", bytes: "2048", concurrency: "6", fail: 0, throughput: 3 },
        { label: "/other", bytes: "512", concurrency: "10", fail: 1, throughput: 1 },
      ]);
      expect(mockParser.updateTestHistoryResults.mock.calls[0][0]).toMatchObject({
        completeTasks: update.completeTasks,
        results: update.finalResults,
      });
    });

    it("reports execution failure after preserving available native results", async () => {
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
      });
      mockSolutionUtils.sendMetric.mockResolvedValue("metric sent");

      await handler({ ...nativeEventForTasks(2), executionFailed: true });

      expect(mockParser.updateTestHistoryResults).toHaveBeenCalled();
      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-1": 1 } })
      );
      expect(testCompletionResult()).toBe("failed");
    });

    it("skips a completely absent region when preserving failed execution results", async () => {
      const twoRegionEvent = {
        ...nativeEvent,
        executionFailed: true,
        testTaskConfig: [
          { ...nativeEvent.testTaskConfig[0] },
          { ...nativeEvent.testTaskConfig[0], region: "my-region-2" },
        ],
      };
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
      });

      await handler(twoRegionEvent);

      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-1": 1 } })
      );
      expect(testCompletionResult()).toBe("failed");
    });

    it("does not write empty results when a failed execution has no result artifact", async () => {
      const otherKey = "results/Q9Isyy5DIK/2024-01-15T14-30-25_abc1234567/my-region-1/task-1/run.log";
      givenNativeObjects({ [otherKey]: "task failed before producing results" });
      mockSolutionUtils.sendMetric.mockResolvedValue("metric sent");

      await handler({ ...nativeEvent, executionFailed: true });

      expect(mockS3.getObject).not.toHaveBeenCalled();
      expect(mockParser.updateTestHistoryResults).not.toHaveBeenCalled();
      expect(mockParser.updateTable).not.toHaveBeenCalled();
      expect(testCompletionResult()).toBe("failed");
    });

    it("maps the task metadata onto the TaskCompletion metric", async () => {
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
      });
      mockSolutionUtils.sendMetric.mockResolvedValue("metric sent");

      await handler(nativeEvent);

      expect(metricOfType("TaskCompletion")).toMatchObject({
        Type: "TaskCompletion",
        TaskVCPU: 2,
        TaskMemory: 4096,
        ECSCalculatedDuration: 70,
        TaskId: "task-1",
      });
    });

    it("ignores other JSON artifacts a task uploads alongside result.json", async () => {
      const otherKey = "results/Q9Isyy5DIK/2024-01-15T14-30-25_abc1234567/my-region-1/task-1/locust-final.json";
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
        [otherKey]: JSON.stringify({ not: "a result artifact" }),
      });

      await handler(nativeEvent);

      expect(mockS3.getObject).toHaveBeenCalledTimes(1);
      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-1": 1 } })
      );
    });

    it("bounds sorted native reads and task metrics at ten", async () => {
      const taskIds = Array.from({ length: 12 }, (_, index) => `task-${String(index + 1).padStart(2, "0")}`);
      const bodiesByKey = Object.fromEntries(
        taskIds
          .toReversed()
          .map((taskId) => [nativeResultKey("my-region-1", taskId), JSON.stringify(mockNativeArtifact({ taskId }))])
      );
      givenNativeObjects(bodiesByKey);
      let activeReads = 0;
      let maximumActiveReads = 0;
      mockS3.getObject.mockImplementation(({ Key }) => {
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        return Promise.resolve({
          Body: {
            transformToString: async () => {
              await new Promise((resolve) => setTimeout(resolve, 1));
              activeReads -= 1;
              return bodiesByKey[Key];
            },
          },
        });
      });
      let activeMetrics = 0;
      let maximumActiveMetrics = 0;
      mockSolutionUtils.sendMetric.mockImplementation(async ({ Type, TaskId }) => {
        if (Type !== "TaskCompletion") return;
        activeMetrics += 1;
        maximumActiveMetrics = Math.max(maximumActiveMetrics, activeMetrics);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeMetrics -= 1;
        if (TaskId === taskIds[0]) throw new Error("Metric unavailable");
      });

      await handler(nativeEventForTasks(12));

      expect(maximumActiveReads).toBe(10);
      expect(maximumActiveMetrics).toBe(10);
      expect(mockS3.getObject.mock.calls.map(([{ Key }]) => Key)).toEqual(
        taskIds.map((taskId) => nativeResultKey("my-region-1", taskId))
      );
    });

    it("merges a batch in sorted key order after reads finish out of order", async () => {
      const bodiesByKey = {
        [nativeResultKey("my-region-1", "task-3")]: JSON.stringify(mockNativeArtifact({ taskId: "task-3" })),
        [nativeResultKey("my-region-1", "task-2")]: JSON.stringify(mockNativeArtifact({ taskId: "task-2" })),
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
      };
      givenNativeObjects(bodiesByKey);
      const completionOrder = [];
      mockS3.getObject.mockImplementation(({ Key }) =>
        Promise.resolve({
          Body: {
            transformToString: async () => {
              await new Promise((resolve) => setTimeout(resolve, (4 - Number(Key.match(/task-(\d)/)[1])) * 10));
              completionOrder.push(Key);
              return bodiesByKey[Key];
            },
          },
        })
      );
      const addTask = jest.spyOn(actualNative, "addTask");

      await handler(nativeEventForTasks(3));

      expect(completionOrder).toEqual([
        nativeResultKey("my-region-1", "task-3"),
        nativeResultKey("my-region-1", "task-2"),
        nativeResultKey("my-region-1", "task-1"),
      ]);
      expect(addTask.mock.calls.map(([, task]) => task.taskId)).toEqual(["task-1", "task-2", "task-3"]);
    });

    it("logs a malformed artifact and persists its valid sibling before failing", async () => {
      const malformedKey = nativeResultKey("my-region-1", "task-1");
      givenNativeObjects({
        [malformedKey]: "{ truncated",
        [nativeResultKey("my-region-1", "task-2")]: JSON.stringify(mockNativeArtifact({ taskId: "task-2" })),
      });
      const errorLog = jest.spyOn(console, "error");

      await expect(handler(nativeEventForTasks(2))).rejects.toThrow(
        "Failed to parse results: Native result collection was incomplete"
      );

      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-1": 1 } })
      );
      expect(mockParser.updateTestHistoryResults).toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith(
        "Native result issue:",
        expect.objectContaining({
          key: malformedKey,
          region: "my-region-1",
          error: expect.any(String),
        })
      );
      expect(mockSolutionUtils.sendMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          Type: "ResultsParsingFailed",
          TestId: "Q9Isyy5DIK",
          TestRunId: "abc1234567",
          TestType: "none",
          Framework: "locust",
          RunMode: "native",
        })
      );
    });

    it.each([
      [
        "unrecognized schema",
        (artifact) => {
          artifact.schema = "dlt.result.v2";
        },
      ],
      [
        "display-only artifact",
        (artifact) => {
          delete artifact.statistics;
        },
      ],
      [
        "invalid statistics",
        (artifact) => {
          artifact.statistics.summary.latency.histogram.bins[0][1] += 1;
        },
      ],
      [
        "wrong test identity",
        (artifact) => {
          artifact.testId = "wrong";
        },
      ],
      [
        "wrong region identity",
        (artifact) => {
          artifact.region = "wrong";
        },
      ],
      [
        "wrong task identity",
        (artifact) => {
          artifact.taskId = "wrong";
        },
      ],
    ])("persists valid data before failing for a %s", async (_name, mutate) => {
      const artifact = mockNativeArtifact();
      mutate(artifact);
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(artifact),
        [nativeResultKey("my-region-1", "task-2")]: JSON.stringify(mockNativeArtifact({ taskId: "task-2" })),
      });

      await expect(handler(nativeEventForTasks(2))).rejects.toThrow("Failed to parse results:");

      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-1": 1 } })
      );
    });

    it("preserves valid data and the original route when execution already failed", async () => {
      const artifact = mockNativeArtifact();
      delete artifact.statistics;
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(artifact),
        [nativeResultKey("my-region-1", "task-2")]: JSON.stringify(mockNativeArtifact({ taskId: "task-2" })),
      });

      await handler({ ...nativeEventForTasks(2), executionFailed: true });

      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-1": 1 } })
      );
      expect(testCompletionResult()).toBe("failed");
      expect(mockSolutionUtils.sendMetric).not.toHaveBeenCalledWith(
        expect.objectContaining({ Type: "ResultsParsingFailed" })
      );
    });

    it("does not write empty results when every listed artifact is invalid", async () => {
      const artifact = mockNativeArtifact();
      delete artifact.statistics;
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(artifact),
      });

      await expect(handler(nativeEvent)).rejects.toThrow("Failed to parse results:");

      expect(mockParser.updateTable).not.toHaveBeenCalled();
      expect(mockParser.updateTestHistoryResults).not.toHaveBeenCalled();
    });

    it("persists valid regions when a later region has an invalid artifact", async () => {
      const twoRegionEvent = {
        ...nativeEvent,
        testTaskConfig: [
          { ...nativeEvent.testTaskConfig[0] },
          { ...nativeEvent.testTaskConfig[0], region: "my-region-2" },
        ],
      };
      const invalid = mockNativeArtifact({ taskId: "task-2", region: "my-region-2" });
      delete invalid.statistics;
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
        [nativeResultKey("my-region-2", "task-2")]: JSON.stringify(invalid),
      });

      await expect(handler(twoRegionEvent)).rejects.toThrow("Failed to parse results:");

      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({
          completeTasks: { "my-region-1": 1 },
          finalResults: expect.objectContaining({ "my-region-1": expect.anything(), total: expect.anything() }),
        })
      );
    });

    it("excludes a task that recorded no requests from both the aggregate and the task count", async () => {
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
        [nativeResultKey("my-region-1", "task-2")]: JSON.stringify(noRequestArtifact("task-2")),
      });

      await handler(nativeEventForTasks(2));

      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-1": 1 } })
      );
      expect(mockParser.finalResults.mock.calls[0][1]).toHaveLength(1);
    });

    // The results are written before the failure is raised, so the region that did measure
    // something still shows its numbers while the test itself reads as failed.
    it("fails the test for a region that recorded no requests, but still writes the regions that did", async () => {
      const twoRegionEvent = {
        ...nativeEvent,
        testTaskConfig: [
          { ...nativeEvent.testTaskConfig[0] },
          { ...nativeEvent.testTaskConfig[0], region: "my-region-2" },
        ],
      };
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(noRequestArtifact("task-1")),
        [nativeResultKey("my-region-2", "task-2")]: JSON.stringify(
          mockNativeArtifact({ taskId: "task-2", region: "my-region-2" })
        ),
      });
      mockSolutionUtils.sendMetric.mockResolvedValue("metric sent");

      await expect(handler(twoRegionEvent)).rejects.toThrow(/No requests were recorded in my-region-1/);

      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-2": 1 } })
      );
    });

    it("fails without writing empty results when the native listing is empty", async () => {
      givenNativeObjects({});

      await expect(handler(nativeEvent)).rejects.toThrow(
        "Failed to parse results: Native result collection was incomplete"
      );

      expect(mockS3.getObject).not.toHaveBeenCalled();
      expect(mockParser.updateTable).not.toHaveBeenCalled();
      expect(mockParser.updateTestHistoryResults).not.toHaveBeenCalled();
    });

    it("reads and persists available data before failing a task-count mismatch", async () => {
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
      });

      await expect(handler(nativeEventForTasks(2))).rejects.toThrow(
        "Failed to parse results: Native result collection was incomplete"
      );

      expect(mockS3.getObject).toHaveBeenCalledTimes(1);
      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-1": 1 } })
      );
    });

    it("includes extra valid artifacts before failing the task-count mismatch", async () => {
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
        [nativeResultKey("my-region-1", "task-2")]: JSON.stringify(mockNativeArtifact({ taskId: "task-2" })),
      });

      await expect(handler(nativeEvent)).rejects.toThrow("Failed to parse results:");

      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-1": 2 } })
      );
    });

    it.each([
      ["malformed result key", "results/Q9Isyy5DIK/2024-01-15T14-30-25_abc1234567/my-region-1/result.json"],
      ["unexpected region", nativeResultKey("my-region-2", "task-2")],
    ])("excludes a %s without hiding configured-region data", async (_name, excludedKey) => {
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
        [excludedKey]: JSON.stringify(mockNativeArtifact()),
      });

      await expect(handler(nativeEvent)).rejects.toThrow("Failed to parse results:");

      expect(mockS3.getObject).toHaveBeenCalledTimes(1);
      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-1": 1 } })
      );
    });

    // The flag picks the path, not the shape of the listing: a native run ignores a stray .xml
    // and never reaches the XML parser.
    it("takes the native path exclusively, ignoring a stray XML object", async () => {
      const legacyKey =
        "results/Q9Isyy5DIK/2024-01-15T14-30-25_abc1234567/a3677174-a062-4a50-bbe2-50b995a536b5-my-region-1.xml";
      givenNativeObjects({
        [legacyKey]: "XML_FILE_CONTENT",
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
      });

      await handler(nativeEvent);

      expect(mockParser.results).not.toHaveBeenCalled();
      expect(mockS3.getObject).toHaveBeenCalledTimes(1);
      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-1": 1 } })
      );
    });

    // ...and the converse: a stale pre-object-shape boolean does not select native mode.
    it("ignores stale runNativeMode when nativeRunMode is null", async () => {
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(mockNativeArtifact()),
      });
      mockParser.results.mockReturnValue({ duration: "60" });

      await handler({ ...mockResultParserEvent, runNativeMode: true });

      // The key carries no `<region>.xml` suffix, so the legacy path matches no region at all.
      expect(mockParser.results).not.toHaveBeenCalled();
      expect(mockS3.getObject).not.toHaveBeenCalled();
    });

    // A run where every task recorded nothing — the target was down, or the script issued no
    // request — measured nothing at all, so it fails and says which region was empty. Reporting
    // it as a success would show a green test with an empty results table.
    it("fails a run whose every task recorded no requests, naming the empty region", async () => {
      givenNativeObjects({
        [nativeResultKey("my-region-1", "task-1")]: JSON.stringify(noRequestArtifact("task-1")),
        [nativeResultKey("my-region-1", "task-2")]: JSON.stringify(noRequestArtifact("task-2")),
      });
      mockSolutionUtils.sendMetric.mockResolvedValue("metric sent");

      await expect(handler(nativeEventForTasks(2))).rejects.toThrow(/No requests were recorded in my-region-1/);

      // The errorReason the customer reads on the scenario.
      expect(mockDDBDocumentClient.update).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: expect.objectContaining({
            ":s": "failed",
            ":e": expect.stringContaining("No requests were recorded in my-region-1"),
          }),
        })
      );
    });

    it("continues into later batches when a first-batch artifact cannot be fetched", async () => {
      const taskIds = Array.from({ length: 11 }, (_, index) => `task-${String(index + 1).padStart(2, "0")}`);
      const bodiesByKey = Object.fromEntries(
        taskIds.map((taskId) => [
          nativeResultKey("my-region-1", taskId),
          JSON.stringify(mockNativeArtifact({ taskId })),
        ])
      );
      const unreadableKey = nativeResultKey("my-region-1", taskIds[0]);
      const lastKey = nativeResultKey("my-region-1", taskIds[10]);
      givenNativeObjects(bodiesByKey);
      mockS3.getObject.mockImplementation(({ Key }) => {
        if (Key === unreadableKey) return Promise.reject(new Error("Throttling: Rate exceeded"));
        return Promise.resolve({
          Body: { transformToString: () => Promise.resolve(bodiesByKey[Key]) },
        });
      });

      await expect(handler(nativeEventForTasks(11))).rejects.toThrow("Failed to parse results:");

      expect(mockS3.getObject).toHaveBeenCalledTimes(11);
      expect(mockS3.getObject).toHaveBeenCalledWith(expect.objectContaining({ Key: lastKey }));
      expect(mockParser.updateTable).toHaveBeenCalledWith(
        expect.objectContaining({ completeTasks: { "my-region-1": 10 } })
      );
      expect(mockSolutionUtils.sendMetric).toHaveBeenCalledWith(
        expect.objectContaining({ Type: "TaskCompletion", TaskId: taskIds[10] })
      );
    });
  });

  // The native path fails a run that produced no usable data. Legacy has always reported such a
  // run as completed — a key that matches no region yields an empty aggregate — and stays that way.
  it("still reports a legacy run whose keys match no region as completed", async () => {
    successfulMocks();
    mockS3.listObjectsV2.mockImplementation(() =>
      Promise.resolve({ Contents: [{ Key: "2024-01-15T14-30-25_abc1234567/no-region-here.xml" }] })
    );
    mockSolutionUtils.sendMetric.mockResolvedValue("metric sent");

    const response = await handler(mockResultParserEvent);

    expect(response).toEqual("success");
    expect(mockSolutionUtils.sendMetric.mock.calls[0][0]).toMatchObject({
      Type: "TestCompletion",
      TestResult: "completed",
    });
  });

  it("metric sent successfully", async () => {
    // Arrange
    successfulMocks();
    mockSolutionUtils.sendMetric.mockResolvedValue("metric sent");

    // Act
    await handler(mockResultParserEvent);

    // Assert
    expect(mockSolutionUtils.sendMetric.mock.calls).toHaveLength(2);

    expect(mockSolutionUtils.sendMetric.mock.calls[0][0]).toHaveProperty("Type", "TaskCompletion");
    expect(mockSolutionUtils.sendMetric.mock.calls[0][0]).toHaveProperty("TaskVCPU");
    expect(mockSolutionUtils.sendMetric.mock.calls[0][0]).toHaveProperty("TaskMemory");
    expect(mockSolutionUtils.sendMetric.mock.calls[0][0]).toHaveProperty("ECSCalculatedDuration");
    expect(mockSolutionUtils.sendMetric.mock.calls[0][0]).toHaveProperty("TaskId");

    expect(mockSolutionUtils.sendMetric.mock.calls[1][0]).toHaveProperty("Type", "TestCompletion");
    expect(mockSolutionUtils.sendMetric.mock.calls[1][0]).toHaveProperty("FileType");
    expect(mockSolutionUtils.sendMetric.mock.calls[1][0]).toHaveProperty("TestType");
    expect(mockSolutionUtils.sendMetric.mock.calls[1][0]).toHaveProperty("Duration");
    expect(mockSolutionUtils.sendMetric.mock.calls[1][0]).toHaveProperty("TestResult");
    expect(mockSolutionUtils.sendMetric.mock.calls[1][0]).toMatchObject({
      TestRunId: "abc1234567",
      RunMode: "standard",
    });
  });
});
