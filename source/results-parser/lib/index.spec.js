// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const {
  mockS3,
  mockDDBDocumentClient,
  mockResultParserEvent,
  mockS3ListObjectResponse,
  mockParser,
  mockSolutionUtils,
} = require("./mock.js");

process.env = {
  RUNNING_UNIT_TESTS: "True",
  SCENARIOS_BUCKET: "MyBucket",
  SCENARIOS_TABLE: "MyTable",
};

const { handler, _getFilesByRegion } = require("../index.js");

describe("Test getFilesByRegion()", () => {
  beforeEach(() => {
    mockS3.getObject.mockReset();
  });

  it("test regex for aws region matches correctly in bucket object key", async () => {
    // Arrange
    const validRegion = "us-east-2";
    const validBucketObjectKey = `114.44:25:71T20-20-4202-a3677174-a062-4a50-bbe2-50b995a536b5-${validRegion}.xml`;
    const invalidBucketObjectKey = "114.44:25:71T20-20-4202-a3677174-a062-4a50-bbe2-50b995a536b5-my-test-region.xml";
    mockS3.getObject.mockImplementation(() => ({
      promise() {
        return Promise.resolve("");
      },
    }));

    // Act & Assert
    const successResult = await _getFilesByRegion([{ Key: validBucketObjectKey }]);
    expect(successResult).toHaveProperty(validRegion);

    const failureResult = await _getFilesByRegion([{ Key: invalidBucketObjectKey }]);
    expect(failureResult).toEqual({}); // no matched region
  });
});

describe("Handler", () => {
  beforeEach(() => {
    mockDDBDocumentClient.get.mockReset();
    mockDDBDocumentClient.update.mockReset();
    mockS3.listObjectsV2.mockReset();
    mockS3.getObject.mockReset();
  });
  const successfulMocks = () => {
    mockDDBDocumentClient.update.mockImplementation(() => ({
      promise() {
        return Promise.resolve("");
      },
    }));
    mockDDBDocumentClient.get.mockImplementation(() => ({
      promise() {
        return Promise.resolve({ Item: {} });
      },
    }));
    mockS3.listObjectsV2.mockImplementation(() => ({
      promise() {
        return Promise.resolve(mockS3ListObjectResponse);
      },
    }));
    mockS3.getObject.mockImplementation(() => ({
      promise() {
        return Promise.resolve({ Body: "STREAMING_BLOB_VALUE" });
      },
    }));
    mockParser.results.mockReturnValue({});
    mockParser.finalResults.mockReturnValue({ metricLocation: "" });
    mockParser.createWidget.mockReturnValue({});
  };

  it("test handler for successful invocation", async () => {
    // Arrange
    successfulMocks();

    // Act
    const response = await handler(mockResultParserEvent);

    // Assert
    expect(response).toEqual("success");
  });

  it("metric sent successfully", async () => {
    // Arrange
    successfulMocks();
    process.env.SEND_METRIC = "Yes";
    mockSolutionUtils.sendMetric.mockResolvedValue("metric sent");

    // Act
    await handler(mockResultParserEvent);

    // Assert
    expect(mockSolutionUtils.sendMetric.mock.calls).toHaveLength(1);
    expect(mockSolutionUtils.sendMetric.mock.calls[0][0]).toHaveProperty("Type", "TaskCompletion");
    expect(mockSolutionUtils.sendMetric.mock.calls[0][0]).toHaveProperty("FileType");
    expect(mockSolutionUtils.sendMetric.mock.calls[0][0]).toHaveProperty("TestType");
    expect(mockSolutionUtils.sendMetric.mock.calls[0][0]).toHaveProperty("Duration");
    expect(mockSolutionUtils.sendMetric.mock.calls[0][0]).toHaveProperty("TestResult");
  });
});
