// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const mockCreateInvestigation = jest.fn();
const mockListInvestigations = jest.fn();
const mockGetInvestigationStatus = jest.fn();
const mockGetInvestigationFindings = jest.fn();
const mockCancelInvestigation = jest.fn();
const mockArchiveInvestigation = jest.fn();
const mockSendMetric = jest.fn();

jest.mock("../lib/investigations/", () => ({
  createInvestigation: mockCreateInvestigation,
  listInvestigations: mockListInvestigations,
  getInvestigationStatus: mockGetInvestigationStatus,
  getInvestigationFindings: mockGetInvestigationFindings,
  cancelInvestigation: mockCancelInvestigation,
  archiveInvestigation: mockArchiveInvestigation,
}));

jest.mock("solution-utils", () => ({
  sendMetric: mockSendMetric,
}));

const {
  handleInvestigations,
  handleInvestigationWithId,
  handleInvestigationStatus,
  handleInvestigationFindings,
} = require("./investigations");

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockSendMetric.mockResolvedValue(undefined);
});

afterEach(() => {
  console.error.mockRestore();
});

// ─── handleInvestigations ────────────────────────────────────────────

describe("handleInvestigations", () => {
  const errorMsg = "Method not allowed";

  it("should create investigation on POST", async () => {
    mockCreateInvestigation.mockResolvedValueOnce({ investigationId: "task-1" });
    const result = await handleInvestigations("POST", "/investigations", errorMsg, "t1", "r1", { agentSpaceId: "as-1" }, "corr-1", "sub-1");
    expect(result).toEqual({ data: { investigationId: "task-1" }, statusCode: 201 });
    expect(mockCreateInvestigation).toHaveBeenCalledWith({
      testId: "t1",
      testRunId: "r1",
      body: { agentSpaceId: "as-1" },
      correlationId: "corr-1",
      requesterCognitoSub: "sub-1",
    });
  });

  it("should send CreateInvestigation metric on POST", async () => {
    mockCreateInvestigation.mockResolvedValueOnce({ investigationId: "task-1" });
    await handleInvestigations("POST", "/investigations", errorMsg, "t1", "r1", {}, "corr-1", "sub-1");
    expect(mockSendMetric).toHaveBeenCalledWith(expect.objectContaining({ Type: "CreateInvestigation" }));
  });

  it("should not fail when POST metric send throws", async () => {
    mockCreateInvestigation.mockResolvedValueOnce({ investigationId: "task-1" });
    mockSendMetric.mockRejectedValueOnce(new Error("network"));
    const result = await handleInvestigations("POST", "/investigations", errorMsg, "t1", "r1", {}, "corr-1", "sub-1");
    expect(result.statusCode).toBe(201);
  });

  it("should list investigations on GET", async () => {
    mockListInvestigations.mockResolvedValueOnce([{ investigationId: "task-1" }]);
    const result = await handleInvestigations("GET", "/investigations", errorMsg, "t1", "r1", {}, "corr-1", "sub-1");
    expect(result).toEqual({ data: [{ investigationId: "task-1" }] });
    expect(mockListInvestigations).toHaveBeenCalledWith({ testId: "t1", testRunId: "r1" });
  });

  it("should send ListInvestigations metric on GET", async () => {
    mockListInvestigations.mockResolvedValueOnce([]);
    await handleInvestigations("GET", "/investigations", errorMsg, "t1", "r1", {}, "corr-1", "sub-1");
    expect(mockSendMetric).toHaveBeenCalledWith(expect.objectContaining({ Type: "ListInvestigations" }));
  });

  it("should not fail when GET metric send throws", async () => {
    mockListInvestigations.mockResolvedValueOnce([]);
    mockSendMetric.mockRejectedValueOnce(new Error("network"));
    const result = await handleInvestigations("GET", "/investigations", errorMsg, "t1", "r1", {}, "corr-1", "sub-1");
    expect(result.data).toEqual([]);
  });

  it("should throw errorMsg on unsupported method", async () => {
    await expect(handleInvestigations("DELETE", "/investigations", errorMsg, "t1", "r1", {}, "corr-1", "sub-1")).rejects.toBe(errorMsg);
  });
});

// ─── handleInvestigationWithId ───────────────────────────────────────

describe("handleInvestigationWithId", () => {
  const errorMsg = "Method not allowed";

  it("should cancel investigation on PUT", async () => {
    mockCancelInvestigation.mockResolvedValueOnce({ investigationId: "task-1", status: "CANCELED" });
    const result = await handleInvestigationWithId("PUT", "/investigations/task-1", errorMsg, "t1", "r1", "task-1", { action: "cancel" }, "corr-1", "sub-1");
    expect(result).toEqual({ data: { investigationId: "task-1", status: "CANCELED" } });
    expect(mockCancelInvestigation).toHaveBeenCalledWith({
      testId: "t1",
      testRunId: "r1",
      investigationId: "task-1",
      body: { action: "cancel" },
      correlationId: "corr-1",
      requesterCognitoSub: "sub-1",
    });
  });

  it("should send CancelInvestigation metric on PUT", async () => {
    mockCancelInvestigation.mockResolvedValueOnce({});
    await handleInvestigationWithId("PUT", "/investigations/task-1", errorMsg, "t1", "r1", "task-1", {}, "corr-1", "sub-1");
    expect(mockSendMetric).toHaveBeenCalledWith(expect.objectContaining({ Type: "CancelInvestigation" }));
  });

  it("should not fail when PUT metric send throws", async () => {
    mockCancelInvestigation.mockResolvedValueOnce({ status: "CANCELED" });
    mockSendMetric.mockRejectedValueOnce(new Error("network"));
    const result = await handleInvestigationWithId("PUT", "/investigations/task-1", errorMsg, "t1", "r1", "task-1", {}, "corr-1", "sub-1");
    expect(result.data).toBeDefined();
  });

  it("should archive investigation on DELETE", async () => {
    mockArchiveInvestigation.mockResolvedValueOnce({ investigationId: "task-1", archived: true });
    const result = await handleInvestigationWithId("DELETE", "/investigations/task-1", errorMsg, "t1", "r1", "task-1", {}, "corr-1", "sub-1");
    expect(result).toEqual({ data: { investigationId: "task-1", archived: true } });
  });

  it("should send ArchiveInvestigation metric on DELETE", async () => {
    mockArchiveInvestigation.mockResolvedValueOnce({});
    await handleInvestigationWithId("DELETE", "/investigations/task-1", errorMsg, "t1", "r1", "task-1", {}, "corr-1", "sub-1");
    expect(mockSendMetric).toHaveBeenCalledWith(expect.objectContaining({ Type: "ArchiveInvestigation" }));
  });

  it("should not fail when DELETE metric send throws", async () => {
    mockArchiveInvestigation.mockResolvedValueOnce({ archived: true });
    mockSendMetric.mockRejectedValueOnce(new Error("network"));
    const result = await handleInvestigationWithId("DELETE", "/investigations/task-1", errorMsg, "t1", "r1", "task-1", {}, "corr-1", "sub-1");
    expect(result.data).toBeDefined();
  });

  it("should throw errorMsg on unsupported method", async () => {
    await expect(handleInvestigationWithId("GET", "/investigations/task-1", errorMsg, "t1", "r1", "task-1", {}, "corr-1", "sub-1")).rejects.toBe(errorMsg);
  });
});

// ─── handleInvestigationStatus ───────────────────────────────────────

describe("handleInvestigationStatus", () => {
  const errorMsg = "Method not allowed";

  it("should get investigation status on GET", async () => {
    mockGetInvestigationStatus.mockResolvedValueOnce({ investigationId: "task-1", status: "IN_PROGRESS" });
    const result = await handleInvestigationStatus("GET", "/status", errorMsg, "t1", "r1", "task-1", "corr-1", "sub-1");
    expect(result).toEqual({ data: { investigationId: "task-1", status: "IN_PROGRESS" } });
  });

  it("should send GetInvestigationStatus metric on GET", async () => {
    mockGetInvestigationStatus.mockResolvedValueOnce({});
    await handleInvestigationStatus("GET", "/status", errorMsg, "t1", "r1", "task-1", "corr-1", "sub-1");
    expect(mockSendMetric).toHaveBeenCalledWith(expect.objectContaining({ Type: "GetInvestigationStatus" }));
  });

  it("should not fail when GET metric send throws", async () => {
    mockGetInvestigationStatus.mockResolvedValueOnce({ status: "COMPLETED" });
    mockSendMetric.mockRejectedValueOnce(new Error("network"));
    const result = await handleInvestigationStatus("GET", "/status", errorMsg, "t1", "r1", "task-1", "corr-1", "sub-1");
    expect(result.data.status).toBe("COMPLETED");
  });

  it("should throw errorMsg on unsupported method", async () => {
    await expect(handleInvestigationStatus("POST", "/status", errorMsg, "t1", "r1", "task-1", "corr-1", "sub-1")).rejects.toBe(errorMsg);
  });
});

// ─── handleInvestigationFindings ─────────────────────────────────────

describe("handleInvestigationFindings", () => {
  const errorMsg = "Method not allowed";

  it("should get investigation findings on GET", async () => {
    mockGetInvestigationFindings.mockResolvedValueOnce({ findings: "# Root Cause", recordType: "investigation_summary_md" });
    const result = await handleInvestigationFindings("GET", "/findings", errorMsg, "t1", "r1", "task-1", "investigation", "markdown", "corr-1", "sub-1");
    expect(result).toEqual({ data: { findings: "# Root Cause", recordType: "investigation_summary_md" } });
    expect(mockGetInvestigationFindings).toHaveBeenCalledWith({
      testId: "t1",
      testRunId: "r1",
      investigationId: "task-1",
      type: "investigation",
      format: "markdown",
      correlationId: "corr-1",
      requesterCognitoSub: "sub-1",
    });
  });

  it("should send GetInvestigationFindings metric on GET", async () => {
    mockGetInvestigationFindings.mockResolvedValueOnce({});
    await handleInvestigationFindings("GET", "/findings", errorMsg, "t1", "r1", "task-1", "investigation", "markdown", "corr-1", "sub-1");
    expect(mockSendMetric).toHaveBeenCalledWith(expect.objectContaining({ Type: "GetInvestigationFindings" }));
  });

  it("should not fail when GET metric send throws", async () => {
    mockGetInvestigationFindings.mockResolvedValueOnce({ findings: "data" });
    mockSendMetric.mockRejectedValueOnce(new Error("network"));
    const result = await handleInvestigationFindings("GET", "/findings", errorMsg, "t1", "r1", "task-1", "investigation", "markdown", "corr-1", "sub-1");
    expect(result.data.findings).toBe("data");
  });

  it("should throw errorMsg on unsupported method", async () => {
    await expect(handleInvestigationFindings("POST", "/findings", errorMsg, "t1", "r1", "task-1", "investigation", "markdown", "corr-1", "sub-1")).rejects.toBe(errorMsg);
  });
});
