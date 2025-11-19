# DLT Remote MCP Server

![architecture diagram](../../docs/images/mcp_architecture.jpeg)

## Tools

* [list_scenarios](#️-list_scenarios)
* [get_scenario_details](#️-get_scenario_details)
* [list_test_runs](#️-list_test_runs)
* [get_test_run](#️-get_test_run)
* [get_latest_test_run](#️-get_latest_test_run)
* [get_baseline_test_run](#️-get_baseline_test_run)
* [get_test_run_artifacts](#️-get_test_run_artifacts)

## Tool Definitions

### 🛠️ list_scenarios

**Description**

Retrieve a list of all available test scenarios.

**Parameters**

None

**Endpoint**

`GET /scenarios`

**Response Schema**

```json
[
    {
        "startTime": "string",
        "testDescription": "string",
        "scheduleRecurrence": "string",
        "testId": "string",
        "status": "string",
        "testName": "string",
        "cronValue": "string",
        "nextRun": "string"
    }
]
```

### 🛠️ get_scenario_details

**Description**

Retrieve the test configuration and most recent test run for a single test scenario.

**Parameters**

* test_id (required, string): The test scenario's unique identifier.

**Endpoint**

`GET /scenarios/<test_id>/?history=false&results=false`

**Response Schema**

```json
{
    "showLive": "boolean",
    "testTaskConfigs": [
        {
            "region": "string",
            "taskCount": "number",
            "concurrency": "number",
            "ecsCloudWatchLogGroup": "string",
            "taskCluster": "string",
            "testId": "string",
            "taskDefinition": "string",
            "subnetB": "string",
            "taskImage": "string",
            "subnetA": "string",
            "taskSecurityGroup": "string"
        }
    ],
    "status": "string",
    "testType": "string",
    "nextRun": "string",
    "startTime": "string",
    "scheduleRecurrence": "string",
    "testDescription": "string",
    "baselineId": "string",
    "endTime": "string",
    "testId": "string",
    "completeTasks": {
        "region-name": "number",
        ...
    },
    "cronExpiryDate": "string",
    "testName": "string",
    "cronValue": "string",
    "fileType": "string",
    "testScenario": {
        "execution": [
            {
                "ramp-up": "string",
                "hold-for": "string",
                "scenario": "string",
                "taskCount": "number",
                "concurrency": "number"
            }
        ],
        "scenarios": {
            "basic endpoint": {
                "requests": [
                    {
                        "url": "string",
                        "method": "string",
                        "headers": "object",
                        "body": "string"
                    }
                ]
            }
        },
        "reporting": [
            {
                "module": "string",
                "summary": "boolean",
                "percentiles": "boolean",
                "summary-labels": "boolean",
                "test-duration": "boolean",
                "dump-xml": "string"
            }
        ]
    },
    "results": [],
    "history": []
}
```

### 🛠️ list_test_runs

**Description**

Retrieve a list of test runs for a specific test scenario, sorted newest to oldest. More detailed results for a test run can be retrieved with "get_test_run". Note: Only one of 'limit' or 'start_timestamp' may be provided, not both. There is a maximum limit of 30 test runs returned.

**Parameters**

* test_id (required, string): The test scenario's unique identifier.
* limit (optional, int): The maximum number of test runs to return (e.g. if I want the 5 most recent test runs, set the limit to 5). Cannot be used with start_timestamp parameter. Must be a positive integer. Default value is 20 and maximum limit is 30.
* start_timestamp (optional, string): Return all test runs going back to start_timestamp. The date must be in ISO 8601 timestamp format (e.g. '2024-01-15T14:30:00.000Z'). Cannot be used with limit parameter. Date format is strictly validated. There is a limit of 30 test runs that can be returned.

**Endpoint**

`GET /scenarios/<test_id>/testruns?limit=<limit>`

or

`GET /scenarios/<test_id>/testruns?limit=30&start_timestamp=<now>&end_timestamp=<start_timestamp>`

**Response Schema**

```json
[
    {
        "testRunId": "string",
        "startTime": "string",
        "endTime": "string",
        "status": "string",
        "requests": "number",
        "success": "number",
        "errors": "number",
        "requestsPerSecond": "number",
        "avgResponseTime": "number",
        "avgLatency": "number",
        "avgConnectionTime": "number",
        "avgBandwidth": "number",
        "percentiles": {
            "p0": "number",
            "p50": "number",
            "p90": "number",
            "p95": "number",
            "p99": "number",
            "p99_9": "number",
            "p100": "number"
        }
    }
]
```

### 🛠️ get_test_run

**Description**

Retrieve a single test run for a specific test scenario. Results will be provided with a breakdown 1/ for each region (e.g. "us-east-1", "us-west-2") that the test runs in as well as an aggregate "total" 2/ for each endpoint (referred to as "label").

**Parameters**

* test_id (required, string): The test scenario's unique identifier.
* test_run_id (required, string): The test run's unique identifier.

**Endpoint**

`GET /scenarios/<scenario_id>/testruns/<test_run_id>`

**Response Schema**

```json
{
    "startTime": "string",
    "testDescription": "string",
    "testId": "string",
    "endTime": "string",
    "testTaskConfigs": [
        {
            "region": "string",
            "taskCount": "number",
            "concurrency": "number"
        }
    ],
    "completeTasks": {
        "region-name": "number",
        ...
    },
    "testType": "string",
    "status": "string",
    "succPercent": "string",
    "testRunId": "string",
    "results": {
        "region-name": {
            "avg_lt": "string",
            "p0_0": "string",
            "p99_0": "string",
            "stdev_rt": "string",
            "avg_ct": "string",
            "metricS3Location": "string",
            "concurrency": "string",
            "p99_9": "string",
            "labels": [
                {
                    "avg_lt": "string",
                    "p0_0": "string",
                    "p99_0": "string",
                    "stdev_rt": "string",
                    "avg_ct": "string",
                    "label": "string",
                    "concurrency": "string",
                    "p99_9": "string",
                    "fail": "number",
                    "rc": [
                        {
                            "count": "number",
                            "code": "string"
                        }
                    ],
                    "succ": "number",
                    "p100_0": "string",
                    "bytes": "string",
                    "p95_0": "string",
                    "avg_rt": "string",
                    "throughput": "number",
                    "p90_0": "string",
                    "testDuration": "string",
                    "p50_0": "string"
                }
            ],
            "fail": "number",
            "rc": [
                {
                    "count": "number",
                    "code": "string"
                }
            ],
            "succ": "number",
            "p100_0": "string",
            "bytes": "string",
            "p95_0": "string",
            "avg_rt": "string",
            "throughput": "number",
            "p90_0": "string",
            "testDuration": "string",
            "p50_0": "string"
        },
        "total": {
            "avg_lt": "string",
            "p0_0": "string",
            "p99_0": "string",
            "stdev_rt": "string",
            "avg_ct": "string",
            "metricS3Location": "string",
            "concurrency": "string",
            "p99_9": "string",
            "labels": [
                {
                    "avg_lt": "string",
                    "p0_0": "string",
                    "p99_0": "string",
                    "stdev_rt": "string",
                    "avg_ct": "string",
                    "label": "string",
                    "concurrency": "string",
                    "p99_9": "string",
                    "fail": "number",
                    "rc": [
                        {
                            "count": "number",
                            "code": "string"
                        }
                    ],
                    "succ": "number",
                    "p100_0": "string",
                    "bytes": "string",
                    "p95_0": "string",
                    "avg_rt": "string",
                    "throughput": "number",
                    "p90_0": "string",
                    "testDuration": "string",
                    "p50_0": "string"
                }
            ],
            "fail": "number",
            "rc": [
                {
                    "count": "number",
                    "code": "string"
                }
            ],
            "succ": "number",
            "p100_0": "string",
            "bytes": "string",
            "p95_0": "string",
            "avg_rt": "string",
            "throughput": "number",
            "p90_0": "string",
            "testDuration": "string",
            "p50_0": "string"
        }
    },
    "testScenario": {
        "execution": [
            {
                "taskCount": "number",
                "hold-for": "string",
                "scenario": "string",
                "ramp-up": "string",
                "concurrency": "number"
            }
        ],
        "reporting": [
            {
                "summary": "boolean",
                "dump-xml": "string",
                "percentiles": "boolean",
                "test-duration": "boolean",
                "summary-labels": "boolean",
                "module": "string"
            }
        ],
        "scenarios": {
            "basic endpoint": {
                "requests": [
                    {
                        "headers": "object",
                        "method": "string",
                        "body": "string",
                        "url": "string"
                    }
                ]
            }
        }
    }
}
```

### 🛠️ get_latest_test_run

**Description**

Retrieve the most recent test run for a specific test scenario.

**Parameters**

* test_id (required, string): The test scenario's unique identifier.

**Endpoint**

`GET /scenarios/<test_id>/testruns?limit=1`

**Response Schema**

See `get_test_run` Response Schema

**Sample Response**

See `get_test_run` Sample Response

### 🛠️ get_baseline_test_run

**Description**

Retrieve the baseline test run for a specific test scenario. Users are able to set a baseline run for comparisons.

**Parameters**

* test_id (required, string): The test scenario's unique identifier.

**Endpoint**

`GET /scenarios/<test_id>/baseline`

**Response Schema**

See `get_test_run` Response Schema

**Sample Response**

See `get_test_run` Sample Response

### 🛠️ get_test_run_artifacts

**Description**

Retrieve the S3 bucket name and path prefix for test run output (logs, error files, results, etc). Starting in v4.0.0, each test run's artifacts will have a unique path that includes a concatenated prefix of timestamp + test run id ("testRunPath" in the response object). Test runs prior to v4.0.0 will live in a shared path without clear separation ("testScenarioPath" in the response object). If "testRunPath" has no objects, try falling back to "testScenarioPath" for the legacy artifact storage behavior. 

**Parameters**

* test_id (required, string): The test scenario's unique identifier.
* test_run_id (required, string): The test run's unique identifier.

**Response Schema**

```json
{
    "artifactBucketName": "string",
    "testScenarioPath": "string",
    "testRunPath": "string"
}
```
