// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockDynamoDB = jest.fn();
const mockCloudWatch = jest.fn();
const mockCloudWatchLogs = jest.fn();
const mockS3 = jest.fn();
const mockAWS = require("aws-sdk");
mockAWS.CloudWatchLogs = jest.fn(() => ({
  deleteMetricFilter: mockCloudWatchLogs,
}));
mockAWS.CloudWatch = jest.fn(() => ({
  getMetricWidgetImage: mockCloudWatch,
}));
mockAWS.DynamoDB.DocumentClient = jest.fn(() => ({
  update: mockDynamoDB,
  put: mockDynamoDB,
}));
mockAWS.S3 = jest.fn(() => ({
  putObject: mockS3,
}));

// Mock xml-js
const mockParse = jest.fn();
jest.mock("xml-js", () => ({
  xml2js: mockParse,
}));

process.env.SOLUTION_ID = "SO0062";
process.env.VERSION = "3.0.0";
const lambda = require("./index.js");

describe("#RESULTS PARSER::", () => {
  process.env.SCENARIOS_BUCKET = "scenario_bucket";
  const content = "XML_FILE_CONTENT";
  const testId = "abcd";
  const json = {
    FinalStatus: {
      TestDuration: {
        _text: 123,
      },
      Group: [
        {
          _attributes: {
            label: "",
          },
          avg_ct: {
            _attributes: {
              value: "0.23043",
            },
            name: {
              _text: "avg_ct",
            },
            value: {
              _text: 0.23043,
            },
          },
          rc: {
            _attributes: {
              value: "20753",
              param: "UnknownHostException",
            },
            name: {
              _text: "rc/UnknownHostException",
            },
            value: {
              _text: 20753,
            },
          },
          perc: [
            {
              _attributes: {
                value: "4.89600",
                param: "95.0",
              },
              name: {
                _text: "perc/95.0",
              },
              value: {
                _text: 4.896,
              },
            },
          ],
        },
        {
          _attributes: {
            label: "HTTP GET Request",
          },
          avg_ct: {
            _attributes: {
              value: "0.23043",
            },
            name: {
              _text: "avg_ct",
            },
            value: {
              _text: 0.23043,
            },
          },
          rc: {
            _attributes: {
              value: "20753",
              param: "UnknownHostException",
            },
            name: {
              _text: "rc/UnknownHostException",
            },
            value: {
              _text: 20753,
            },
          },
          perc: [
            {
              _attributes: {
                value: "4.89600",
                param: "95.0",
              },
              name: {
                _text: "perc/95.0",
              },
              value: {
                _text: 4.896,
              },
            },
          ],
        },
      ],
    },
  };
  const resultJson = {
    avg_ct: 0.23043,
    p95_0: 4.896,
    rc: [
      {
        code: "UnknownHostException",
        count: 20753,
      },
    ],
    testDuration: 123,
  };
  const finalData = [
    {
      duration: "39",
      labels: [
        {
          avg_ct: 0.00096,
          avg_lt: 0,
          avg_rt: 0.00103,
          bytes: 48258556,
          concurrency: 4,
          fail: 21064,
          label: "HTTP GET Request",
          p0_0: 0,
          p50_0: 0,
          p90_0: 0,
          p95_0: 0.001,
          p99_0: 0.013,
          p99_9: 0.105,
          p100_0: 0.396,
          stdev_rt: 0.01049,
          succ: 0,
          testDuration: 39,
          throughput: 21064,
          rc: [
            { code: "UnknownHostException", count: 20753 },
            { code: "UnknownHostException", count: 20753 },
          ],
        },
      ],
      stats: {
        avg_ct: 0.00096,
        avg_lt: 0,
        avg_rt: 0.00103,
        bytes: 48258556,
        concurrency: 4,
        fail: 21064,
        p0_0: 0,
        p50_0: 0,
        p90_0: 0,
        p95_0: 0.001,
        p99_0: 0.013,
        p99_9: 0.105,
        p100_0: 0.396,
        stdev_rt: 0.01049,
        succ: 0,
        testDuration: 39,
        throughput: 21064,
        rc: [
          { code: "UnknownHostException", count: 20753 },
          { code: "UnknownHostException", count: 20753 },
        ],
      },
    },
  ];
  const singleAggregatedResult = {
    avg_ct: "0.00096",
    avg_lt: "0.00000",
    avg_rt: "0.00103",
    bytes: "48258556",
    concurrency: "4",
    fail: 21064,
    p0_0: "0.000",
    p50_0: "0.000",
    p95_0: "0.001",
    p90_0: "0.000",
    p99_0: "0.013",
    p99_9: "0.105",
    p100_0: "0.396",
    rc: [{ code: "UnknownHostException", count: 41506 }],
    stdev_rt: "0.010",
    succ: 0,
    testDuration: "39",
    throughput: 21064,
    labels: [
      {
        avg_ct: "0.00096",
        avg_lt: "0.00000",
        avg_rt: "0.00103",
        bytes: "48258556",
        concurrency: "4",
        fail: 21064,
        label: "HTTP GET Request",
        p0_0: "0.000",
        p50_0: "0.000",
        p95_0: "0.001",
        p90_0: "0.000",
        p99_0: "0.013",
        p99_9: "0.105",
        p100_0: "0.396",
        rc: [{ code: "UnknownHostException", count: 41506 }],
        stdev_rt: "0.010",
        succ: 0,
        testDuration: "39",
        throughput: 21064,
      },
    ],
  };
  const finalAggregatedResults = {
    "us-east-1": singleAggregatedResult,
    total: singleAggregatedResult,
  };

  const startTime = "2020-09-01 00:00:00";
  const endTime = "2020-09-01 00:02:00";
  const testScenario =
    '{"execution":[{"ramp-up":"10s","hold-for":"2m","scenario":"test1-5-err"}],"scenarios":{"test1-5-err":{"script":"ryWOD3EDT.jmx"}},"reporting":[{"module":"final-stats","summary":true,"percentiles":true,"summary-labels":true,"test-duration":true,"dump-xml":"/tmp/artifacts/results.xml"}]}';
  const testDescription = "This test description";
  const testTaskConfigs = [
    {
      region: "us-east-1",
      concurrency: 1,
      taskCount: 2,
    },
  ];
  const testType = "simple";
  const region = "us-east-1";
  const ecsCloudWatchLogGroup = "testEcsLogGroup";
  const taskCluster = "testCluster";

  const updateTableParams = {
    testId,
    finalResults: finalAggregatedResults,
    startTime,
    endTime,
    testTaskConfigs,
    testScenario,
    testDescription,
    testType,
    region,
    ecsCloudWatchLogGroup,
    taskCluster,
  };
  const widgetMetricsRegion1 = [
    [
      "distributed-load-testing",
      `${testId}-avgRt`,
      { region: "us-east-1", color: "#FF9900", label: "Avg Response Time" },
    ],
    [
      "distributed-load-testing",
      `${testId}-numVu`,
      { region: "us-east-1", color: "#1f77b4", label: "Virtual Users", stat: "Sum", yAxis: "right" },
    ],
    [
      "distributed-load-testing",
      `${testId}-numSucc`,
      { region: "us-east-1", color: "#2CA02C", label: "Successes", stat: "Sum", yAxis: "right" },
    ],
    [
      "distributed-load-testing",
      `${testId}-numFail`,
      { region: "us-east-1", color: "#D62728", label: "Failures", stat: "Sum", yAxis: "right" },
    ],
  ];
  const widgetMetricsRegion2 = [
    [
      "distributed-load-testing",
      `${testId}-avgRt`,
      { region: "us-east-2", color: "#FF9900", label: "Avg Response Time" },
    ],
    [
      "distributed-load-testing",
      `${testId}-numVu`,
      { region: "us-east-2", color: "#1f77b4", label: "Virtual Users", stat: "Sum", yAxis: "right" },
    ],
    [
      "distributed-load-testing",
      `${testId}-numSucc`,
      { region: "us-east-2", color: "#2CA02C", label: "Successes", stat: "Sum", yAxis: "right" },
    ],
    [
      "distributed-load-testing",
      `${testId}-numFail`,
      { region: "us-east-2", color: "#D62728", label: "Failures", stat: "Sum", yAxis: "right" },
    ],
  ];
  const aggregateWidgetMetrics = [
    [
      "distributed-load-testing",
      `${testId}-avgRt`,
      { region: "us-east-1", color: "#FF9900", label: "Avg Response Time", id: "avgRt0", visible: false },
    ],
    [
      "distributed-load-testing",
      `${testId}-numVu`,
      {
        region: "us-east-1",
        color: "#1f77b4",
        label: "Virtual Users",
        stat: "Sum",
        yAxis: "right",
        id: "numVu0",
        visible: false,
      },
    ],
    [
      "distributed-load-testing",
      `${testId}-numSucc`,
      {
        region: "us-east-1",
        color: "#2CA02C",
        label: "Successes",
        stat: "Sum",
        yAxis: "right",
        id: "numSucc0",
        visible: false,
      },
    ],
    [
      "distributed-load-testing",
      `${testId}-numFail`,
      {
        region: "us-east-1",
        color: "#D62728",
        label: "Failures",
        stat: "Sum",
        yAxis: "right",
        id: "numFail0",
        visible: false,
      },
    ],
    [
      "distributed-load-testing",
      `${testId}-avgRt`,
      { region: "us-east-2", color: "#FF9900", label: "Avg Response Time", id: "avgRt1", visible: false },
    ],
    [
      "distributed-load-testing",
      `${testId}-numVu`,
      {
        region: "us-east-2",
        color: "#1f77b4",
        label: "Virtual Users",
        stat: "Sum",
        yAxis: "right",
        id: "numVu1",
        visible: false,
      },
    ],
    [
      "distributed-load-testing",
      `${testId}-numSucc`,
      {
        region: "us-east-2",
        color: "#2CA02C",
        label: "Successes",
        stat: "Sum",
        yAxis: "right",
        id: "numSucc1",
        visible: false,
      },
    ],
    [
      "distributed-load-testing",
      `${testId}-numFail`,
      {
        region: "us-east-2",
        color: "#D62728",
        label: "Failures",
        stat: "Sum",
        yAxis: "right",
        id: "numFail1",
        visible: false,
      },
    ],
    [{ expression: "AVG([avgRt0,avgRt1])", color: "#FF9900", label: "Avg Response Time" }],
    [{ expression: "SUM([numVu0,numVu1])", color: "#1f77b4", label: "Virtual Users", yAxis: "right" }],
    [{ expression: "SUM([numSucc0,numSucc1])", color: "#2CA02C", label: "Successes", yAxis: "right" }],
    [{ expression: "SUM([numFail0,numFail1])", color: "#D62728", label: "Failures", yAxis: "right" }],
  ];
  beforeEach(() => {
    mockDynamoDB.mockReset();
    mockCloudWatch.mockReset();
    mockParse.mockReset();
    mockS3.mockReset();
  });

  it("should return the result object when parse results are processed successfully for the single RC", async () => {
    mockParse.mockImplementation(() => json);

    const response = await lambda.results(content, testId);
    expect(response).toEqual({
      stats: resultJson,
      labels: [
        {
          avg_ct: 0.23043,
          p95_0: 4.896,
          rc: [
            {
              code: "UnknownHostException",
              count: 20753,
            },
          ],
          label: "HTTP GET Request",
        },
      ],
      duration: json.FinalStatus.TestDuration._text,
    });
  });

  it("should return the result object when parse results are processed successfully for the multiple RCs", async () => {
    json.FinalStatus.Group[0].rc = [
      {
        _attributes: {
          value: "20753",
          param: "UnknownHostException",
        },
        name: {
          _text: "rc/UnknownHostException",
        },
        value: {
          _text: 20753,
        },
      },
      {
        _attributes: {
          value: "1",
          param: "200",
        },
        name: {
          _text: "rc/200",
        },
        value: {
          _text: 1,
        },
      },
    ];
    json.FinalStatus.Group[1].rc = json.FinalStatus.Group[0].rc;

    mockParse.mockImplementation(() => json);

    const response = await lambda.results(content, testId);
    expect(response).toEqual({
      stats: resultJson,
      labels: [
        {
          avg_ct: 0.23043,
          p95_0: 4.896,
          rc: [
            {
              code: "UnknownHostException",
              count: 20753,
            },
          ],
          label: "HTTP GET Request",
        },
      ],
      duration: json.FinalStatus.TestDuration._text,
    });
  });

  it("should return the final result when final results are processed successfully", async () => {
    mockDynamoDB.mockImplementationOnce(() => ({
      promise() {
        // update
        return Promise.resolve();
      },
    }));
    mockCloudWatch.mockImplementation(() => ({
      promise() {
        // getMetricWidgetImage
        return Promise.resolve({ MetricWidgetImage: "CloudWatchImage" });
      },
    }));

    mockS3.mockImplementation(() => ({
      promise() {
        // putObject
        return Promise.resolve();
      },
    }));
    mockCloudWatchLogs.mockImplementation(() => ({
      promise() {
        // deleteMetricFilter
        return Promise.resolve();
      },
    }));
    const response = await lambda.finalResults(testId, finalData);
    expect(response).toEqual(singleAggregatedResult);
  });

  it('should return "XML ERROR" when parse results fails', async () => {
    mockParse.mockImplementation(() => {
      throw "XML ERROR";
    });

    try {
      await lambda.results(content, testId, startTime);
    } catch (error) {
      expect(error).toEqual("XML ERROR");
    }
  });

  it('should return "DB UPDATE ERROR" when final results fails', async () => {
    mockDynamoDB.mockImplementationOnce(() => ({
      promise() {
        // update
        return Promise.reject("DB UPDATE ERROR");
      },
    }));
    mockCloudWatch.mockImplementation(() => ({
      promise() {
        // getMetricWidgetImage
        return Promise.resolve({ MetricWidgetImage: "CloudWatchImage" });
      },
    }));

    mockS3.mockImplementation(() => ({
      promise() {
        // putObject
        return Promise.resolve();
      },
    }));

    try {
      await lambda.finalResults(testId, finalData);
    } catch (error) {
      expect(error).toEqual("DB UPDATE ERROR");
    }
  });

  it("should succeed on updateTable call", async () => {
    mockDynamoDB.mockImplementationOnce(() => ({
      promise() {
        // put history
        return Promise.resolve("success");
      },
    }));
    mockDynamoDB.mockImplementationOnce(() => ({
      promise() {
        // update
        return Promise.resolve("success");
      },
    }));
    const result = await lambda.updateTable(updateTableParams);
    expect(result).toEqual("Success");
  });

  it("should fail on DynamoDB failure in updateTable", async () => {
    mockDynamoDB.mockImplementationOnce(() => ({
      promise() {
        // update
        return Promise.reject("Failure");
      },
    }));

    try {
      await lambda.updateTable(updateTableParams);
    } catch (err) {
      expect(err).toEqual("Failure");
    }
  });

  it("should save image and return key and metric on createWidget success", async () => {
    mockCloudWatch.mockImplementationOnce(() => ({
      promise() {
        // update
        return Promise.resolve({ MetricWidgetImage: "Image" });
      },
    }));
    mockS3.mockImplementationOnce(() => ({
      promise() {
        // update
        return Promise.resolve("Success");
      },
    }));

    const result = await lambda.createWidget(startTime, endTime, region, testId, []);
    const expectedImageLocation = `cloudwatch-images/${testId}/CloudWatchMetrics-${region}-${new Date(
      startTime
    ).toISOString()}`;
    expect(mockS3).toHaveBeenCalledWith({
      Body: Buffer.from("Image").toString("base64"),
      Bucket: "scenario_bucket",
      Key: `public/cloudwatch-images/${testId}/CloudWatchMetrics-${region}-${new Date(startTime).toISOString()}`,
      ContentEncoding: "base64",
      ContentType: "image/jpeg",
    });
    expect(result).toEqual({ metricS3Location: expectedImageLocation, metrics: widgetMetricsRegion1 });
  });

  it("should save image and return key and metrics for totals on createWidget success", async () => {
    mockCloudWatch.mockImplementationOnce(() => ({
      promise() {
        // update
        return Promise.resolve({ MetricWidgetImage: "Image" });
      },
    }));
    mockS3.mockImplementationOnce(() => ({
      promise() {
        // update
        return Promise.resolve("Success");
      },
    }));

    const result = await lambda.createWidget(
      startTime,
      endTime,
      "total",
      testId,
      widgetMetricsRegion1.concat(widgetMetricsRegion2)
    );
    const expectedImageLocation = `cloudwatch-images/${testId}/CloudWatchMetrics-total-${new Date(
      startTime
    ).toISOString()}`;
    expect(mockS3).toHaveBeenCalledWith({
      Body: Buffer.from("Image").toString("base64"),
      Bucket: "scenario_bucket",
      Key: `public/cloudwatch-images/${testId}/CloudWatchMetrics-total-${new Date(startTime).toISOString()}`,
      ContentEncoding: "base64",
      ContentType: "image/jpeg",
    });

    expect(result).toEqual({ metricS3Location: expectedImageLocation, metrics: aggregateWidgetMetrics });
  });

  it("should fail on getMetricWidgetImage failure in createWidget", async () => {
    mockCloudWatch.mockImplementationOnce(() => ({
      promise() {
        // update
        return Promise.reject("Failure");
      },
    }));

    try {
      await lambda.createWidget(startTime, endTime, region, testId, []);
    } catch (err) {
      expect(err).toEqual("Failure");
    }
  });

  it("should fail on S3 failure in createWidget", async () => {
    mockCloudWatch.mockImplementationOnce(() => ({
      promise() {
        // update
        return Promise.resolve({ MetricWidgetImage: "Image" });
      },
    }));
    mockS3.mockImplementationOnce(() => ({
      promise() {
        // update
        return Promise.reject("Failure");
      },
    }));

    try {
      await lambda.createWidget(startTime, endTime, region, testId, []);
    } catch (err) {
      expect(err).toEqual("Failure");
    }
  });

  it("should delete metric filter on deleteRegionalMetricFilter success", async () => {
    mockCloudWatchLogs.mockImplementationOnce(() => ({
      promise() {
        // update
        return Promise.resolve("Success");
      },
    }));

    await lambda.deleteRegionalMetricFilter(testId, region, taskCluster, ecsCloudWatchLogGroup);
    expect(mockCloudWatchLogs).toHaveBeenCalledTimes(4);
    expect(mockCloudWatchLogs).toHaveBeenCalledWith(expect.objectContaining({ logGroupName: ecsCloudWatchLogGroup }));
  });
});
