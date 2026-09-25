// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Coverage for the rejection telemetry emitted when the server-side single-run
// guard rejects a start (TEST_RUNNING). The event uses the same instrumentation
// envelope as other metrics (utils.sendMetric attaches account id / uuid /
// version) so rejections are observable alongside TestCreate/TestUpdate.

const mockSendMetric = jest.fn(() => Promise.resolve());
jest.mock("solution-utils", () => ({
  sendMetric: (...args) => mockSendMetric(...args),
}));

const mockCreateTest = jest.fn();
const mockGetTestEntry = jest.fn();
jest.mock("../lib/scenarios/", () => ({
  createTest: (...args) => mockCreateTest(...args),
  getTestEntry: (...args) => mockGetTestEntry(...args),
  getTestRunCount: jest.fn(() => Promise.resolve(0)),
  computeChangedFields: jest.fn(() => []),
  getTestDurationSeconds: jest.fn(() => 0),
  scheduleTest: jest.fn(),
  listTests: jest.fn(),
}));

jest.mock("./regions", () => ({ getRegions: jest.fn() }));

const { handleScenarios, sendScenarioRejectionMetric } = require("./scenarios");

const testId = "abc123";
const baseConfig = {
  testId,
  testType: "simple",
  testTaskConfigs: [{ region: "us-east-1", taskCount: 5, concurrency: 1 }],
  testScenario: { execution: [{ "hold-for": "1m" }] },
};

const invokeStart = (config, userAgent) =>
  handleScenarios("POST", "/scenarios", new Error("method not allowed"), config, null, {}, "fn", "arn", userAgent);

describe("scenario start rejection telemetry", () => {
  beforeEach(() => {
    mockSendMetric.mockClear();
    mockCreateTest.mockReset();
    mockGetTestEntry.mockReset();
  });

  it("emits a TestStartRejected metric when a start is rejected with TEST_RUNNING", async () => {
    expect.assertions(5);
    mockGetTestEntry.mockResolvedValue({ testId, status: "running" });
    const err = Object.assign(new Error("active run"), { code: "TEST_RUNNING", statusCode: 409 });
    mockCreateTest.mockRejectedValue(err);

    await expect(invokeStart(baseConfig, "curl/8.0")).rejects.toBe(err);

    expect(mockSendMetric).toHaveBeenCalledTimes(1);
    const metric = mockSendMetric.mock.calls[0][0];
    expect(metric.Type).toEqual("TestStartRejected");
    expect(metric.Status).toEqual("running");
    expect(metric.UserAgent).toEqual("curl/8.0");
  });

  it("does not emit a rejection metric for a saveOnly TEST_RUNNING conflict", async () => {
    expect.assertions(2);
    mockGetTestEntry.mockResolvedValue({ testId, status: "running" });
    const err = Object.assign(new Error("active run"), { code: "TEST_RUNNING", statusCode: 409 });
    mockCreateTest.mockRejectedValue(err);

    await expect(invokeStart({ ...baseConfig, saveOnly: true }, "console")).rejects.toBe(err);
    expect(mockSendMetric).not.toHaveBeenCalled();
  });

  it("does not emit a rejection metric for unrelated createTest errors", async () => {
    expect.assertions(2);
    mockGetTestEntry.mockResolvedValue(null);
    const err = Object.assign(new Error("bad request"), { code: "INVALID_REQUEST_BODY", statusCode: 400 });
    mockCreateTest.mockRejectedValue(err);

    await expect(invokeStart(baseConfig, "console")).rejects.toBe(err);
    expect(mockSendMetric).not.toHaveBeenCalled();
  });

  it("sendScenarioRejectionMetric maps region task counts and swallows emit failures", async () => {
    mockSendMetric.mockRejectedValueOnce(new Error("network"));
    await sendScenarioRejectionMetric({
      config: baseConfig,
      userAgent: "mcp",
      existingEntry: { status: "provisioning" },
    });
    const metric = mockSendMetric.mock.calls[0][0];
    expect(metric.Reason).toEqual("already_running");
    expect(metric.TaskCountPerRegion).toEqual({ "us-east-1": 5 });
  });
});
