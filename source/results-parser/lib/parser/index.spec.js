// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockCloudWatch = jest.fn();
const mockCloudWatchLogs = jest.fn();
const mockS3 = jest.fn();

const mockDynamoDB = {
  update: jest.fn(),
  put: jest.fn(),
};

// Mock DynamoDB
jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDB: jest.fn(() => ({})),
}));

jest.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocument: {
    from: jest.fn(() => ({
      update: mockDynamoDB.update,
      put: mockDynamoDB.put,
    })),
  },
}));

// Mock CloudWatch
jest.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatch: jest.fn(() => ({
    getMetricWidgetImage: mockCloudWatch,
  })),
}));

// Mock CloudWatch Logs
jest.mock("@aws-sdk/client-cloudwatch-logs", () => ({
  CloudWatchLogs: jest.fn(() => ({
    deleteMetricFilter: mockCloudWatchLogs,
  })),
}));

// Mock S3
jest.mock("@aws-sdk/client-s3", () => ({
  S3: jest.fn(() => ({
    putObject: mockS3,
  })),
}));

// Mock xml-js
const mockParse = jest.fn();
jest.mock("xml-js", () => ({
  xml2js: mockParse,
}));

process.env.SOLUTION_ID = "SO0062";
process.env.VERSION = "3.0.0";
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
const lambda = require("./index.js");

describe("#RESULTS PARSER::", () => {
  process.env.SCENARIOS_BUCKET = "scenario_bucket";
  const content = "XML_FILE_CONTENT";
  const testId = "abcd";
  const mockJsonSingleRC = {
    FinalStatus: {
      TestDuration: {
        _text: 123,
      },
      TaskId: {
        _text: "abcd",
      },
      TaskCPU: {
        _text: "2",
      },
      TaskMemory: {
        _text: "2048",
      },
      ECSDuration: {
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
  const mockJsonMultipleRC = {
    FinalStatus: {
      TestDuration: {
        _text: 120,
      },
      TaskId: {
        _text: "abcd",
      },
      TaskCPU: {
        _text: "2",
      },
      TaskMemory: {
        _text: "2048",
      },
      ECSDuration: {
        _text: 123,
      },
      Group: [
        {
          _attributes: {
            label: "API1",
          },
          throughput: {
            _attributes: {
              value: "16175",
            },
            name: {
              _text: "throughput",
            },
            value: {
              _text: 16175,
            },
          },
          concurrency: {
            _attributes: {
              value: "5",
            },
            name: {
              _text: "concurrency",
            },
            value: {
              _text: 5,
            },
          },
          succ: {
            _attributes: {
              value: "308",
            },
            name: {
              _text: "succ",
            },
            value: {
              _text: 308,
            },
          },
          fail: {
            _attributes: {
              value: "15867",
            },
            name: {
              _text: "fail",
            },
            value: {
              _text: 15867,
            },
          },
          avg_rt: {
            _attributes: {
              value: "0.01817",
            },
            name: {
              _text: "avg_rt",
            },
            value: {
              _text: 0.01817,
            },
          },
          stdev_rt: {
            _attributes: {
              value: "0.01198",
            },
            name: {
              _text: "stdev_rt",
            },
            value: {
              _text: 0.01198,
            },
          },
          avg_lt: {
            _attributes: {
              value: "0.01785",
            },
            name: {
              _text: "avg_lt",
            },
            value: {
              _text: 0.01785,
            },
          },
          avg_ct: {
            _attributes: {
              value: "0.00705",
            },
            name: {
              _text: "avg_ct",
            },
            value: {
              _text: 0.00705,
            },
          },
          bytes: {
            _attributes: {
              value: "114370983",
            },
            name: {
              _text: "bytes",
            },
            value: {
              _text: 114370983,
            },
          },
          rc: [
            {
              _attributes: {
                value: "10547",
                param: "503",
              },
              name: {
                _text: "rc/503",
              },
              value: {
                _text: 10547,
              },
            },
            {
              _attributes: {
                value: "308",
                param: "200",
              },
              name: {
                _text: "rc/200",
              },
              value: {
                _text: 308,
              },
            },
            {
              _attributes: {
                value: "5320",
                param: "429",
              },
              name: {
                _text: "rc/429",
              },
              value: {
                _text: 5320,
              },
            },
          ],
          perc: [
            {
              _attributes: {
                value: "0.00500",
                param: "0.0",
              },
              name: {
                _text: "perc/0.0",
              },
              value: {
                _text: 0.005,
              },
            },
            {
              _attributes: {
                value: "0.01700",
                param: "50.0",
              },
              name: {
                _text: "perc/50.0",
              },
              value: {
                _text: 0.017,
              },
            },
            {
              _attributes: {
                value: "0.02500",
                param: "90.0",
              },
              name: {
                _text: "perc/90.0",
              },
              value: {
                _text: 0.025,
              },
            },
            {
              _attributes: {
                value: "0.03000",
                param: "95.0",
              },
              name: {
                _text: "perc/95.0",
              },
              value: {
                _text: 0.03,
              },
            },
            {
              _attributes: {
                value: "0.06800",
                param: "99.0",
              },
              name: {
                _text: "perc/99.0",
              },
              value: {
                _text: 0.068,
              },
            },
            {
              _attributes: {
                value: "0.11700",
                param: "99.9",
              },
              name: {
                _text: "perc/99.9",
              },
              value: {
                _text: 0.117,
              },
            },
            {
              _attributes: {
                value: "0.39700",
                param: "100.0",
              },
              name: {
                _text: "perc/100.0",
              },
              value: {
                _text: 0.397,
              },
            },
          ],
        },
        {
          _attributes: {
            label: "",
          },
          throughput: {
            _attributes: {
              value: "31301",
            },
            name: {
              _text: "throughput",
            },
            value: {
              _text: 31301,
            },
          },
          concurrency: {
            _attributes: {
              value: "5",
            },
            name: {
              _text: "concurrency",
            },
            value: {
              _text: 5,
            },
          },
          succ: {
            _attributes: {
              value: "308",
            },
            name: {
              _text: "succ",
            },
            value: {
              _text: 308,
            },
          },
          fail: {
            _attributes: {
              value: "30993",
            },
            name: {
              _text: "fail",
            },
            value: {
              _text: 30993,
            },
          },
          avg_rt: {
            _attributes: {
              value: "0.01886",
            },
            name: {
              _text: "avg_rt",
            },
            value: {
              _text: 0.01886,
            },
          },
          stdev_rt: {
            _attributes: {
              value: "0.01490",
            },
            name: {
              _text: "stdev_rt",
            },
            value: {
              _text: 0.0149,
            },
          },
          avg_lt: {
            _attributes: {
              value: "0.01868",
            },
            name: {
              _text: "avg_lt",
            },
            value: {
              _text: 0.01868,
            },
          },
          avg_ct: {
            _attributes: {
              value: "0.00769",
            },
            name: {
              _text: "avg_ct",
            },
            value: {
              _text: 0.00769,
            },
          },
          bytes: {
            _attributes: {
              value: "153701120",
            },
            name: {
              _text: "bytes",
            },
            value: {
              _text: 153701120,
            },
          },
          rc: [
            {
              _attributes: {
                value: "14895",
                param: "503",
              },
              name: {
                _text: "rc/503",
              },
              value: {
                _text: 14895,
              },
            },
            {
              _attributes: {
                value: "308",
                param: "200",
              },
              name: {
                _text: "rc/200",
              },
              value: {
                _text: 308,
              },
            },
            {
              _attributes: {
                value: "16098",
                param: "429",
              },
              name: {
                _text: "rc/429",
              },
              value: {
                _text: 16098,
              },
            },
          ],
          perc: [
            {
              _attributes: {
                value: "0.00500",
                param: "0.0",
              },
              name: {
                _text: "perc/0.0",
              },
              value: {
                _text: 0.005,
              },
            },
            {
              _attributes: {
                value: "0.01700",
                param: "50.0",
              },
              name: {
                _text: "perc/50.0",
              },
              value: {
                _text: 0.017,
              },
            },
            {
              _attributes: {
                value: "0.03000",
                param: "90.0",
              },
              name: {
                _text: "perc/90.0",
              },
              value: {
                _text: 0.03,
              },
            },
            {
              _attributes: {
                value: "0.04000",
                param: "95.0",
              },
              name: {
                _text: "perc/95.0",
              },
              value: {
                _text: 0.04,
              },
            },
            {
              _attributes: {
                value: "0.07200",
                param: "99.0",
              },
              name: {
                _text: "perc/99.0",
              },
              value: {
                _text: 0.072,
              },
            },
            {
              _attributes: {
                value: "0.16000",
                param: "99.9",
              },
              name: {
                _text: "perc/99.9",
              },
              value: {
                _text: 0.16,
              },
            },
            {
              _attributes: {
                value: "0.51700",
                param: "100.0",
              },
              name: {
                _text: "perc/100.0",
              },
              value: {
                _text: 0.517,
              },
            },
          ],
        },
        {
          _attributes: {
            label: "API2",
          },
          throughput: {
            _attributes: {
              value: "15126",
            },
            name: {
              _text: "throughput",
            },
            value: {
              _text: 15126,
            },
          },
          concurrency: {
            _attributes: {
              value: "5",
            },
            name: {
              _text: "concurrency",
            },
            value: {
              _text: 5,
            },
          },
          succ: {
            _attributes: {
              value: "0",
            },
            name: {
              _text: "succ",
            },
            value: {
              _text: 0,
            },
          },
          fail: {
            _attributes: {
              value: "15126",
            },
            name: {
              _text: "fail",
            },
            value: {
              _text: 15126,
            },
          },
          avg_rt: {
            _attributes: {
              value: "0.01960",
            },
            name: {
              _text: "avg_rt",
            },
            value: {
              _text: 0.0196,
            },
          },
          stdev_rt: {
            _attributes: {
              value: "0.01747",
            },
            name: {
              _text: "stdev_rt",
            },
            value: {
              _text: 0.01747,
            },
          },
          avg_lt: {
            _attributes: {
              value: "0.01957",
            },
            name: {
              _text: "avg_lt",
            },
            value: {
              _text: 0.01957,
            },
          },
          avg_ct: {
            _attributes: {
              value: "0.00837",
            },
            name: {
              _text: "avg_ct",
            },
            value: {
              _text: 0.00837,
            },
          },
          bytes: {
            _attributes: {
              value: "39330137",
            },
            name: {
              _text: "bytes",
            },
            value: {
              _text: 39330137,
            },
          },
          rc: [
            {
              _attributes: {
                value: "10778",
                param: "429",
              },
              name: {
                _text: "rc/429",
              },
              value: {
                _text: 10778,
              },
            },
            {
              _attributes: {
                value: "4348",
                param: "503",
              },
              name: {
                _text: "rc/503",
              },
              value: {
                _text: 4348,
              },
            },
          ],
          perc: [
            {
              _attributes: {
                value: "0.00500",
                param: "0.0",
              },
              name: {
                _text: "perc/0.0",
              },
              value: {
                _text: 0.005,
              },
            },
            {
              _attributes: {
                value: "0.01500",
                param: "50.0",
              },
              name: {
                _text: "perc/50.0",
              },
              value: {
                _text: 0.015,
              },
            },
            {
              _attributes: {
                value: "0.03600",
                param: "90.0",
              },
              name: {
                _text: "perc/90.0",
              },
              value: {
                _text: 0.036,
              },
            },
            {
              _attributes: {
                value: "0.04700",
                param: "95.0",
              },
              name: {
                _text: "perc/95.0",
              },
              value: {
                _text: 0.047,
              },
            },
            {
              _attributes: {
                value: "0.08100",
                param: "99.0",
              },
              name: {
                _text: "perc/99.0",
              },
              value: {
                _text: 0.081,
              },
            },
            {
              _attributes: {
                value: "0.19000",
                param: "99.9",
              },
              name: {
                _text: "perc/99.9",
              },
              value: {
                _text: 0.19,
              },
            },
            {
              _attributes: {
                value: "0.51700",
                param: "100.0",
              },
              name: {
                _text: "perc/100.0",
              },
              value: {
                _text: 0.517,
              },
            },
          ],
        },
      ],
    },
  };

  const finalData = [
    {
      stats: {
        rc: [
          {
            code: "503",
            count: 14895,
          },
          {
            code: "429",
            count: 16098,
          },
        ],
        throughput: 31301,
        concurrency: 5,
        succ: 308,
        fail: 30993,
        avg_rt: 0.01886,
        stdev_rt: 0.0149,
        avg_lt: 0.01868,
        avg_ct: 0.00769,
        bytes: 153701120,
        p0_0: 0.005,
        p50_0: 0.017,
        p90_0: 0.03,
        p95_0: 0.04,
        p99_0: 0.072,
        p99_9: 0.16,
        p100_0: 0.517,
        testDuration: 120,
      },
      labels: [
        {
          rc: [
            {
              code: "503",
              count: 10547,
            },
            {
              code: "429",
              count: 5320,
            },
          ],
          throughput: 16175,
          concurrency: 5,
          succ: 308,
          fail: 15867,
          avg_rt: 0.01817,
          stdev_rt: 0.01198,
          avg_lt: 0.01785,
          avg_ct: 0.00705,
          bytes: 114370983,
          p0_0: 0.005,
          p50_0: 0.017,
          p90_0: 0.025,
          p95_0: 0.03,
          p99_0: 0.068,
          p99_9: 0.117,
          p100_0: 0.397,
          label: "API1",
        },
        {
          rc: [
            {
              code: "429",
              count: 10778,
            },
            {
              code: "503",
              count: 4348,
            },
          ],
          throughput: 15126,
          concurrency: 5,
          succ: 0,
          fail: 15126,
          avg_rt: 0.0196,
          stdev_rt: 0.01747,
          avg_lt: 0.01957,
          avg_ct: 0.00837,
          bytes: 39330137,
          p0_0: 0.005,
          p50_0: 0.015,
          p90_0: 0.036,
          p95_0: 0.047,
          p99_0: 0.081,
          p99_9: 0.19,
          p100_0: 0.517,
          label: "API2",
        },
      ],
      duration: 120,
    },
  ];
  const singleAggregatedResult = {
    avg_ct: "0.00769",
    avg_lt: "0.01868",
    avg_rt: "0.01886",
    bytes: "153701120",
    concurrency: "5",
    fail: 30993,
    p0_0: "0.005",
    p100_0: "0.517",
    p50_0: "0.017",
    p90_0: "0.030",
    p95_0: "0.040",
    p99_0: "0.072",
    p99_9: "0.160",
    stdev_rt: "0.015",
    succ: 308,
    testDuration: "120",
    throughput: 31301,
    rc: [
      {
        code: "503",
        count: 14895,
      },
      {
        code: "429",
        count: 16098,
      },
    ],
    labels: [
      {
        avg_ct: "0.00705",
        avg_lt: "0.01785",
        avg_rt: "0.01817",
        bytes: "114370983",
        concurrency: "5",
        fail: 15867,
        label: "API1",
        p0_0: "0.005",
        p100_0: "0.397",
        p50_0: "0.017",
        p90_0: "0.025",
        p95_0: "0.030",
        p99_0: "0.068",
        p99_9: "0.117",
        stdev_rt: "0.012",
        succ: 308,
        testDuration: "0",
        throughput: 16175,
        rc: [
          {
            code: "503",
            count: 10547,
          },
          {
            code: "429",
            count: 5320,
          },
        ],
      },
      {
        avg_ct: "0.00837",
        avg_lt: "0.01957",
        avg_rt: "0.01960",
        bytes: "39330137",
        concurrency: "5",
        fail: 15126,
        label: "API2",
        p0_0: "0.005",
        p100_0: "0.517",
        p50_0: "0.015",
        p90_0: "0.036",
        p95_0: "0.047",
        p99_0: "0.081",
        p99_9: "0.190",
        stdev_rt: "0.017",
        succ: 0,
        testDuration: "0",
        throughput: 15126,
        rc: [
          {
            code: "429",
            count: 10778,
          },
          {
            code: "503",
            count: 4348,
          },
        ],
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
      {
        region: "us-east-1",
        color: "#1f77b4",
        label: "Accumulated Virtual Users Activities",
        stat: "Sum",
        yAxis: "right",
      },
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
        label: "Accumulated Virtual Users Activities",
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
    [
      {
        expression: "SUM([numVu0,numVu1])",
        color: "#1f77b4",
        label: "Accumulated Virtual Users Activities",
        yAxis: "right",
      },
    ],
    [{ expression: "SUM([numSucc0,numSucc1])", color: "#2CA02C", label: "Successes", yAxis: "right" }],
    [{ expression: "SUM([numFail0,numFail1])", color: "#D62728", label: "Failures", yAxis: "right" }],
  ];
  beforeEach(() => {
    mockDynamoDB.put.mockReset();
    mockDynamoDB.update.mockReset();
    mockCloudWatch.mockReset();
    mockParse.mockReset();
    mockS3.mockReset();
  });

  it("should return the result object when parse results are processed successfully for the single RC", async () => {
    mockParse.mockImplementation(() => mockJsonSingleRC);

    const response = await lambda.results(content, testId);
    expect(response.stats.rc).toEqual([
      {
        code: "UnknownHostException",
        count: 20753,
      },
    ]);
  });

  it("should return the result object when parse results are processed successfully for the multiple RCs", async () => {
    mockParse.mockImplementation(() => mockJsonMultipleRC);

    const response = await lambda.results(content, testId);
    expect(response.stats.succ).toEqual(308);
    expect(response.stats.rc).toEqual([
      {
        code: "503",
        count: 14895,
      },
      {
        code: "429",
        count: 16098,
      },
    ]);
  });

  it("should return the final result when final results are processed successfully", async () => {
    mockDynamoDB.put.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatch.mockImplementation(() => Promise.resolve({ MetricWidgetImage: "CloudWatchImage" }));
    mockS3.mockImplementation(() => Promise.resolve());
    mockCloudWatchLogs.mockImplementation(() => Promise.resolve());
    const response = await lambda.finalResults(testId, finalData);
    expect(response).toEqual(singleAggregatedResult);
  });

  it("should return an equal number of failure to sum of response codes error count", async () => {
    mockDynamoDB.put.mockImplementationOnce(() => Promise.resolve());
    mockCloudWatch.mockImplementation(() => Promise.resolve({ MetricWidgetImage: "CloudWatchImage" }));
    mockS3.mockImplementation(() => Promise.resolve());
    mockCloudWatchLogs.mockImplementation(() => Promise.resolve());
    const response = await lambda.finalResults(testId, finalData);
    expect(response.fail).toEqual(response.rc[0].count + response.rc[1].count);
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
    mockDynamoDB.put.mockImplementationOnce(() => Promise.reject("DB UPDATE ERROR"));
    mockCloudWatch.mockImplementation(() => Promise.resolve({ MetricWidgetImage: "CloudWatchImage" }));
    mockS3.mockImplementation(() => Promise.resolve());

    try {
      await lambda.finalResults(testId, finalData);
    } catch (error) {
      expect(error).toEqual("DB UPDATE ERROR");
    }
  });

  it("should succeed on updateTable call", async () => {
    mockDynamoDB.update.mockImplementationOnce(() => Promise.resolve("success"));
    mockDynamoDB.update.mockImplementationOnce(() => Promise.resolve("success"));
    const result = await lambda.updateTable(updateTableParams);
    expect(result).toEqual("Success");
  });

  it("should fail on DynamoDB failure in updateTable", async () => {
    mockDynamoDB.update.mockImplementationOnce(() => Promise.reject("Failure"));

    try {
      await lambda.updateTable(updateTableParams);
    } catch (err) {
      expect(err).toEqual("Failure");
    }
  });

  it("should save image and return key and metric on createWidget success", async () => {
    mockCloudWatch.mockImplementationOnce(() => Promise.resolve({ MetricWidgetImage: "Image" }));
    mockS3.mockImplementationOnce(() => Promise.resolve("Success"));

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
    mockCloudWatch.mockImplementationOnce(() => Promise.resolve({ MetricWidgetImage: "Image" }));
    mockS3.mockImplementationOnce(() => Promise.resolve("Success"));

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
    mockCloudWatch.mockImplementationOnce(() => Promise.reject("Failure"));

    try {
      await lambda.createWidget(startTime, endTime, region, testId, []);
    } catch (err) {
      expect(err).toEqual("Failure");
    }
  });

  it("should fail on S3 failure in createWidget", async () => {
    mockCloudWatch.mockImplementationOnce(() => Promise.resolve({ MetricWidgetImage: "Image" }));
    mockS3.mockImplementationOnce(() => Promise.reject("Failure"));

    try {
      await lambda.createWidget(startTime, endTime, region, testId, []);
    } catch (err) {
      expect(err).toEqual("Failure");
    }
  });

  it("should delete metric filter on deleteRegionalMetricFilter success", async () => {
    mockCloudWatchLogs.mockImplementationOnce(() => Promise.resolve("Success"));

    await lambda.deleteRegionalMetricFilter(testId, region, taskCluster, ecsCloudWatchLogGroup);
    expect(mockCloudWatchLogs).toHaveBeenCalledTimes(4);
    expect(mockCloudWatchLogs).toHaveBeenCalledWith(expect.objectContaining({ logGroupName: ecsCloudWatchLogGroup }));
  });
});
