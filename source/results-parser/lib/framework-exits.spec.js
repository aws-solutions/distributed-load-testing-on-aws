// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { writeFrameworkExitsReport } = require("./framework-exits");

const testId = "test-1";
const testRunId = "run-1";
const prefix = "prefix-1";
const bucket = "bucket-1";
const testType = "k6";

const key = (region, taskId) => `results/${testId}/${prefix}/${region}/${taskId}/framework-exit.json`;
const artifact = (overrides = {}) => ({
  schema: "dlt.framework-exit.v1",
  timestamp: "2026-09-10T12:00:00.000Z",
  testId,
  testRunId,
  taskId: "task-1",
  region: "us-east-1",
  framework: testType,
  exitCode: 99,
  message: "threshold crossed",
  stopReason: "natural",
  ...overrides,
});

const body = (value) => ({
  Body: { transformToString: jest.fn(async () => JSON.stringify(value)) },
});

const createS3 = (artifactsByKey = {}) => ({
  getObject: jest.fn(async ({ Key }) => body(artifactsByKey[Key])),
  putObject: jest.fn(async () => ({})),
});

const write = (s3, resultList) =>
  writeFrameworkExitsReport({
    s3,
    bucket,
    resultList,
    testId,
    prefix,
  });

describe("writeFrameworkExitsReport", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns nothing without reading or writing when no framework-exit artifacts are listed", async () => {
    const s3 = createS3();

    await expect(
      write(s3, [{ Key: `results/${testId}/${prefix}/us-east-1/task-1/result.json` }])
    ).resolves.toBeUndefined();
    expect(s3.getObject).not.toHaveBeenCalled();
    expect(s3.putObject).not.toHaveBeenCalled();
  });

  it("writes canonical records in full-key order and returns exact deterministic tuple counts", async () => {
    const records = {
      [key("us-west-2", "task-3")]: artifact({
        region: "us-west-2",
        taskId: "task-3",
        exitCode: 1,
        message: "zeta",
      }),
      [key("us-east-1", "task-2")]: artifact({ taskId: "task-2", exitCode: 1, message: "alpha" }),
      [key("us-east-1", "task-1")]: artifact(),
      [key("us-east-1", "task-4")]: artifact({ taskId: "task-4" }),
      [key("us-east-1", "task-5")]: artifact({ taskId: "task-5", exitCode: 1, message: "alpha" }),
      [key("us-east-1", "task-6")]: artifact({ taskId: "task-6", framework: "k6", exitCode: 2, message: "a" }),
    };
    const s3 = createS3(records);

    const result = await write(
      s3,
      Object.keys(records)
        .reverse()
        .map((Key) => ({ Key }))
    );

    const orderedKeys = Object.keys(records).sort();
    expect(s3.getObject.mock.calls.map(([request]) => request.Key)).toEqual(orderedKeys);
    expect(s3.putObject).toHaveBeenCalledWith({
      Bucket: bucket,
      Key: `results/${testId}/${prefix}/framework-exits/framework-exits.jsonl`,
      Body: `${orderedKeys.map((recordKey) => JSON.stringify(records[recordKey])).join("\n")}\n`,
      ContentType: "application/x-ndjson",
    });
    expect(result).toEqual({
      artifactKey: `results/${testId}/${prefix}/framework-exits/framework-exits.jsonl`,
      summary: {
        totalCount: 6,
        artifactKey: `results/${testId}/${prefix}/framework-exits/framework-exits.jsonl`,
        top: [
          { framework: "k6", exitCode: 1, message: "alpha", count: 2 },
          { framework: "k6", exitCode: 99, message: "threshold crossed", count: 2 },
          { framework: "k6", exitCode: 1, message: "zeta", count: 1 },
        ],
      },
      statistics: {
        frameworkExitTaskCount: 6,
        exitCodeCounts: [
          { ExitCode: 1, TaskCount: 3 },
          { ExitCode: 2, TaskCount: 1 },
          { ExitCode: 99, TaskCount: 2 },
        ],
        invalidExitArtifactCount: 0,
      },
    });
  });

  it("never reads a key outside the run's own prefix", async () => {
    const otherRunKey = `results/${testId}/wrong/us-east-1/task-1/framework-exit.json`;
    const otherTestKey = `results/other-test/${prefix}/us-east-1/task-1/framework-exit.json`;
    const s3 = createS3();

    await expect(write(s3, [{ Key: otherRunKey }, { Key: otherTestKey }])).resolves.toBeUndefined();
    expect(s3.getObject).not.toHaveBeenCalled();
    expect(s3.putObject).not.toHaveBeenCalled();
  });

  it("logs and skips unreadable bodies and malformed JSON without logging their content", async () => {
    const unreadableKey = key("us-east-1", "task-1");
    const malformedKey = key("us-east-1", "task-2");
    const secret = "CUSTOMER SECRET MESSAGE";
    const s3 = {
      getObject: jest.fn(async ({ Key }) =>
        Key === unreadableKey ? {} : { Body: { transformToString: async () => `{${secret}` } }
      ),
      putObject: jest.fn(),
    };
    const error = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(write(s3, [{ Key: malformedKey }, { Key: unreadableKey }])).resolves.toMatchObject({
      statistics: {
        frameworkExitTaskCount: 0,
        exitCodeCounts: [],
        invalidExitArtifactCount: 2,
      },
    });

    expect(s3.getObject).toHaveBeenCalledTimes(2);
    expect(s3.putObject).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "Skipping framework-exit artifact:",
      expect.objectContaining({ errorName: "SyntaxError" })
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(error.mock.calls)).not.toContain(malformedKey);
  });

  it.each([
    ["null", null],
    ["a number", 5],
    ["an array", []],
    ["a record with no message", { exitCode: 1 }],
    ["a record with no exit code", { message: "network failure" }],
    ["a record with a textual exit code", { exitCode: "NetworkError", message: "network failure" }],
    ["a record with a null exit code", { exitCode: null, message: "network failure" }],
  ])("skips %s without losing the rest of the run's report", async (_label, payload) => {
    const skippedKey = key("us-east-1", "task-1");
    const validKey = key("us-east-1", "task-2");
    const valid = artifact({ taskId: "task-2" });
    const s3 = createS3({ [skippedKey]: payload, [validKey]: valid });
    jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await write(s3, [{ Key: skippedKey }, { Key: validKey }]);

    expect(result.summary.totalCount).toBe(1);
    expect(result.statistics.invalidExitArtifactCount).toBe(1);
    expect(s3.putObject.mock.calls[0][0].Body).toBe(`${JSON.stringify(valid)}\n`);
  });

  it("preserves a valid sibling when another artifact in the batch is malformed", async () => {
    const validKey = key("us-east-1", "task-1");
    const malformedKey = key("us-east-1", "task-2");
    const valid = artifact();
    const s3 = {
      getObject: jest.fn(async ({ Key }) =>
        Key === validKey ? body(valid) : { Body: { transformToString: async () => "{ truncated" } }
      ),
      putObject: jest.fn(async () => ({})),
    };
    jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await write(s3, [{ Key: malformedKey }, { Key: validKey }]);

    expect(result.summary.totalCount).toBe(1);
    expect(s3.putObject.mock.calls[0][0].Body).toBe(`${JSON.stringify(valid)}\n`);
  });

  it("processes 5,000 artifacts with at most fifty active reads", async () => {
    const resultList = Array.from({ length: 5_000 }, (_, index) => {
      const taskId = `task-${String(index).padStart(4, "0")}`;
      return { Key: key("us-east-1", taskId) };
    });
    let activeReads = 0;
    let maxActiveReads = 0;
    const s3 = {
      getObject: jest.fn(async ({ Key }) => {
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await Promise.resolve();
        activeReads -= 1;
        return body(artifact({ taskId: Key.split("/")[4] }));
      }),
      putObject: jest.fn(async () => ({})),
    };

    const result = await write(s3, resultList.reverse());

    expect(s3.getObject).toHaveBeenCalledTimes(5_000);
    expect(maxActiveReads).toBe(50);
    expect(result.summary).toMatchObject({
      totalCount: 5_000,
      top: [{ framework: "k6", exitCode: 99, message: "threshold crossed", count: 5_000 }],
    });
    expect(s3.putObject.mock.calls[0][0].Body.split("\n")).toHaveLength(5_001);
  });

  it("keeps a message whole when it fits the per-message limit", async () => {
    const recordKey = key("us-east-1", "task-1");
    const message = "界".repeat(600);
    const s3 = createS3({ [recordKey]: artifact({ message }) });

    const { summary } = await write(s3, [{ Key: recordKey }]);

    expect(summary.top).toEqual([{ framework: testType, exitCode: 99, message, count: 1 }]);
  });

  it("truncates oversized messages on Unicode code-point boundaries", async () => {
    const records = Object.fromEntries(
      [1, 2, 3].map((number) => {
        const taskId = `task-${number}`;
        const message = number === 3 ? `${"界😀".repeat(341)}界` : "界".repeat(1_024);
        return [key("us-east-1", taskId), artifact({ taskId, exitCode: number, message })];
      })
    );
    const s3 = createS3(records);

    const { summary } = await write(
      s3,
      Object.keys(records).map((Key) => ({ Key }))
    );

    for (const entry of summary.top) {
      expect(Buffer.byteLength(entry.message, "utf8")).toBeLessThanOrEqual(2 * 1024);
      expect(entry.message).not.toBe(
        Object.values(records).find((record) => record.exitCode === entry.exitCode).message
      );
      expect(
        Array.from(entry.message).every((character) => {
          const codePoint = character.codePointAt(0);
          return codePoint < 0xd800 || codePoint > 0xdfff;
        })
      ).toBe(true);
    }
  });

  it("returns statistics when the aggregate PutObject fails", async () => {
    const recordKey = key("us-east-1", "task-1");
    const s3 = createS3({ [recordKey]: artifact() });
    const secret = "CUSTOMER SECRET REPORT CONTENT";
    s3.putObject.mockRejectedValue(new Error(secret));
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(write(s3, [{ Key: recordKey }])).resolves.toEqual({
      statistics: {
        frameworkExitTaskCount: 1,
        exitCodeCounts: [{ ExitCode: 99, TaskCount: 1 }],
        invalidExitArtifactCount: 0,
      },
    });
    expect(errorLog).toHaveBeenCalledWith("Framework-exit report upload failed");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(secret);
  });
});
