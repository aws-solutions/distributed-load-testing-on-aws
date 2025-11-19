#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Standalone CLI tool for testing the Baseline APIs
 *
 * Usage:
 *   node baseline-tester.js --url <API_URL> --test-id <TEST_ID> [--test-run-id <RUN_ID>] [--operation <get|set|delete>] [--simple-response]
 *
 * Examples:
 *   # Get baseline (with test run details - default)
 *   node baseline-tester.js --url https://api.example.com --test-id test123 --operation get
 *
 *   # Get baseline (simple response only)
 *   node baseline-tester.js --url https://api.example.com --test-id test123 --operation get --simple-response
 *
 *   # Set baseline (now uses PUT)
 *   node baseline-tester.js --url https://api.example.com --test-id test123 --test-run-id run456 --operation set
 *
 *   # Clear baseline
 *   node baseline-tester.js --url https://api.example.com --test-id test123 --operation delete
 *
 *   # Interactive mode
 *   node baseline-tester.js --url https://api.example.com --test-id test123 --test-run-id run456
 */

const axios = require("axios");
const { aws4Interceptor } = require("aws4-axios");
const readline = require("readline");

class BaselineTester {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl;
    this.testId = options.testId;
    this.testRunId = options.testRunId;
    this.includeResults = options.includeResults || false;
    this.region = options.region || "us-east-1";
    this.setupAxios();
  }

  setupAxios() {
    // Setup AWS IAM signing for API Gateway
    const interceptor = aws4Interceptor({
      options: {
        region: this.region,
        service: "execute-api",
      },
    });

    axios.interceptors.request.use(interceptor);

    // Setup response interceptor for better error handling
    axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          // API returned an error response
          return Promise.reject({
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
          });
        } else if (error.request) {
          // Network error
          return Promise.reject({
            status: 0,
            statusText: "Network Error",
            data: "Unable to connect to API",
          });
        } else {
          // Other error
          return Promise.reject({
            status: 0,
            statusText: "Unknown Error",
            data: error.message,
          });
        }
      }
    );
  }

  async getBaseline(testId, simpleResponse = false) {
    console.log(
      `Getting baseline for test '${testId}'${simpleResponse ? " (simple response)" : " (with test run details)"}...`
    );

    try {
      let url = `${this.apiUrl}/scenarios/${testId}/baseline`;
      if (simpleResponse) {
        url += "?data=false";
      }

      const response = await axios.get(url);

      console.log(`SUCCESS: Baseline retrieved successfully`);
      console.log(`Response:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.log(`ERROR: Failed to get baseline`);
      console.log(`Status: ${error.status} ${error.statusText}`);
      console.log(`Details:`, error.data);
      throw error;
    }
  }

  async setBaseline(testId, testRunId) {
    console.log(`Setting baseline for test '${testId}' with run '${testRunId}'...`);

    try {
      const response = await axios.put(`${this.apiUrl}/scenarios/${testId}/baseline`, {
        testRunId: testRunId,
      });

      console.log(`SUCCESS: Baseline set successfully`);
      console.log(`Response:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.log(`ERROR: Failed to set baseline`);
      console.log(`Status: ${error.status} ${error.statusText}`);
      console.log(`Details:`, error.data);
      throw error;
    }
  }

  async clearBaseline(testId) {
    console.log(`Clearing baseline for test '${testId}'...`);

    try {
      const response = await axios.delete(`${this.apiUrl}/scenarios/${testId}/baseline`);

      console.log(`SUCCESS: Baseline cleared successfully`);
      console.log(`Response:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.log(`ERROR: Failed to clear baseline`);
      console.log(`Status: ${error.status} ${error.statusText}`);
      console.log(`Details:`, error.data);
      throw error;
    }
  }

  async promptForOperation() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      console.log("\nWhat would you like to do?");
      console.log("1. Get baseline (GET)");
      console.log("2. Set baseline (PUT)");
      console.log("3. Clear baseline (DELETE)");

      rl.question("\nEnter your choice (1, 2, or 3): ", (answer) => {
        rl.close();
        if (answer === "1" || answer.toLowerCase() === "get") {
          resolve("get");
        } else if (answer === "2" || answer.toLowerCase() === "set") {
          resolve("set");
        } else if (answer === "3" || answer.toLowerCase() === "delete") {
          resolve("delete");
        } else {
          console.log("Invalid choice. Please run the command again.");
          process.exit(1);
        }
      });
    });
  }

  async run(operation) {
    console.log("Baseline API Tester");
    console.log("======================");
    console.log(`API URL: ${this.apiUrl}`);
    console.log(`Test ID: ${this.testId}`);
    if (this.testRunId) {
      console.log(`Test Run ID: ${this.testRunId}`);
    }
    if (this.includeResults) {
      console.log(`Simple Response: ${this.includeResults}`);
    }
    console.log(`Region: ${this.region}`);
    console.log("");

    try {
      if (!operation) {
        operation = await this.promptForOperation();
      }

      if (operation === "get") {
        // includeResults now means "simple response" (data=false)
        await this.getBaseline(this.testId, this.includeResults);
      } else if (operation === "set") {
        if (!this.testRunId) {
          console.log("ERROR: Test Run ID is required for setting baseline");
          console.log("Use: --test-run-id <RUN_ID>");
          process.exit(1);
        }
        await this.setBaseline(this.testId, this.testRunId);
      } else if (operation === "delete") {
        await this.clearBaseline(this.testId);
      } else {
        console.log('ERROR: Invalid operation. Use "get", "set", or "delete"');
        process.exit(1);
      }

      console.log("\nOperation completed successfully!");
    } catch (error) {
      console.log("\nOperation failed!");
      process.exit(1);
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  const processed = new Set(); // Track processed indices

  for (const [index, key] of args.entries()) {
    if (processed.has(index)) continue; // Skip already processed arguments

    switch (key) {
      case "--url": {
        options.apiUrl = args[index + 1];
        processed.add(index + 1); // Mark next index as processed
        break;
      }
      case "--test-id": {
        options.testId = args[index + 1];
        processed.add(index + 1);
        break;
      }
      case "--test-run-id": {
        options.testRunId = args[index + 1];
        processed.add(index + 1);
        break;
      }
      case "--operation": {
        options.operation = args[index + 1];
        processed.add(index + 1);
        break;
      }
      case "--region": {
        options.region = args[index + 1];
        processed.add(index + 1);
        break;
      }
      case "--simple-response": {
        options.includeResults = true;
        // No need to mark next index - this flag has no value
        break;
      }
      case "--help":
      case "-h": {
        showHelp();
        process.exit(0);
        break;
      }
      default: {
        if (key.startsWith("--")) {
          console.log(`Unknown argument: ${key}`);
          showHelp();
          process.exit(1);
        }
        break;
      }
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Baseline API Tester - CLI Tool for testing Baseline APIs

USAGE:
  node baseline-tester.js --url <API_URL> --test-id <TEST_ID> [OPTIONS]

REQUIRED ARGUMENTS:
  --url <API_URL>           API Gateway URL (e.g., https://api123.execute-api.us-east-1.amazonaws.com)
  --test-id <TEST_ID>       Test scenario ID

OPTIONAL ARGUMENTS:
  --test-run-id <RUN_ID>    Test run ID (required for set operation)
  --operation <OPERATION>   Operation: "get", "set", or "delete" (if not provided, will prompt)
  --simple-response         Get simple baseline info only (by default, test run details are included)
  --region <REGION>         AWS region (default: us-east-1)
  --help, -h                Show this help message

OPERATIONS:
  get                       Retrieve current baseline information (GET /scenarios/{testId}/baseline)
  set                       Set/update baseline with a test run (PUT /scenarios/{testId}/baseline)
  delete                    Clear/remove current baseline (DELETE /scenarios/{testId}/baseline)

EXAMPLES:
  # Get baseline (with test run details - default)
  node baseline-tester.js --url https://api123.execute-api.us-east-1.amazonaws.com --test-id test123 --operation get

  # Get baseline (simple response only)
  node baseline-tester.js --url https://api123.execute-api.us-east-1.amazonaws.com --test-id test123 --operation get --simple-response

  # Set a baseline (interactive)
  node baseline-tester.js --url https://api123.execute-api.us-east-1.amazonaws.com --test-id test123 --test-run-id run456

  # Set a baseline (direct, now uses PUT method)
  node baseline-tester.js --url https://api123.execute-api.us-east-1.amazonaws.com --test-id test123 --test-run-id run456 --operation set

  # Clear a baseline
  node baseline-tester.js --url https://api123.execute-api.us-east-1.amazonaws.com --test-id test123 --operation delete

AUTHENTICATION:
  This tool uses AWS credentials from your environment:
  - AWS CLI profile (aws configure)
  - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
  - IAM roles (if running on EC2/Lambda)

API CHANGES:
  - Added GET method for retrieving baseline information
  - Changed POST to PUT for setting baselines (better REST semantics)
  - Added optional ?data=false query parameter for simple responses (data=true is default)
  - All baseline operations now support proper HTTP status codes and error handling

NOTE:
  Make sure you have valid AWS credentials configured and the necessary
  permissions to access the API Gateway endpoint.
`);
}

function validateOptions(options) {
  if (!options.apiUrl) {
    console.log("ERROR: API URL is required");
    console.log("Use: --url <API_URL>");
    process.exit(1);
  }

  if (!options.testId) {
    console.log("ERROR: Test ID is required");
    console.log("Use: --test-id <TEST_ID>");
    process.exit(1);
  }

  // Validate URL format
  try {
    new URL(options.apiUrl);
  } catch (error) {
    console.log("ERROR: Invalid API URL format");
    console.log("Example: https://api123.execute-api.us-east-1.amazonaws.com");
    process.exit(1);
  }
}

async function main() {
  const options = parseArgs();
  validateOptions(options);

  const tester = new BaselineTester(options);
  await tester.run(options.operation);
}

// Run the CLI tool if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Unexpected error:", error.message);
    process.exit(1);
  });
}

module.exports = BaselineTester;
