#!/usr/bin/env node

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Standalone CLI tool for testing the Delete Test Runs API
 *
 * Usage:
 *   node testrun-deleter.js --url <API_URL> --test-id <TEST_ID> --test-run-ids <RUN_ID1,RUN_ID2,...> [--region <REGION>]
 *
 * Examples:
 *   # Delete specific test runs
 *   node testrun-deleter.js --url https://api.example.com --test-id test123 --test-run-ids run456,run789
 *
 *   # Delete single test run
 *   node testrun-deleter.js --url https://api.example.com --test-id test123 --test-run-ids run456
 *
 *   # Interactive mode (list available test runs first)
 *   node testrun-deleter.js --url https://api.example.com --test-id test123 --interactive
 */

const axios = require("axios");
const { aws4Interceptor } = require("aws4-axios");
const readline = require("readline");

class TestRunDeleter {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl;
    this.testId = options.testId;
    this.testRunIds = options.testRunIds || [];
    this.interactive = options.interactive || false;
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

  async getTestRuns(testId, limit = 50) {
    console.log(`Fetching test runs for test '${testId}'...`);

    try {
      const response = await axios.get(`${this.apiUrl}/scenarios/${testId}/testruns`, {
        params: { limit },
      });

      console.log(`SUCCESS: Found ${response.data.testRuns.length} test runs`);
      return response.data.testRuns;
    } catch (error) {
      console.log(`ERROR: Failed to get test runs`);
      console.log(`Status: ${error.status} ${error.statusText}`);
      console.log(`Details:`, error.data);
      throw error;
    }
  }

  async deleteTestRuns(testId, testRunIds) {
    console.log(`Deleting ${testRunIds.length} test runs for test '${testId}'...`);
    console.log(`Test run IDs: ${testRunIds.join(", ")}`);

    try {
      const response = await axios.delete(`${this.apiUrl}/scenarios/${testId}/testruns`, {
        data: testRunIds,
        headers: {
          "Content-Type": "application/json",
        },
      });

      console.log(`SUCCESS: Test runs deleted successfully`);
      console.log(`Response:`, JSON.stringify(response.data, null, 2));
      return response.data;
    } catch (error) {
      console.log(`ERROR: Failed to delete test runs`);
      console.log(`Status: ${error.status} ${error.statusText}`);
      console.log(`Details:`, error.data);
      throw error;
    }
  }

  async promptForTestRuns(availableTestRuns) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      console.log("\nAvailable test runs:");
      availableTestRuns.forEach((testRun, index) => {
        console.log(`${index + 1}. ${testRun.testRunId} (${testRun.startTime}) - ${testRun.status || "complete"}`);
      });

      console.log("\nEnter the test run IDs to delete (comma-separated):");
      console.log("You can use either:");
      console.log("- Test run IDs: run-001,run-002");
      console.log("- Numbers from list: 1,3,5");

      rl.question("\nYour selection: ", (answer) => {
        rl.close();

        if (!answer.trim()) {
          console.log("No selection made. Exiting.");
          process.exit(0);
        }

        const selections = answer.split(",").map((s) => s.trim());
        const selectedTestRunIds = [];

        selections.forEach((selection) => {
          // Check if it's a number (list index)
          const index = parseInt(selection);
          if (!isNaN(index) && index >= 1 && index <= availableTestRuns.length) {
            selectedTestRunIds.push(availableTestRuns[index - 1].testRunId);
          } else {
            // Assume it's a test run ID
            selectedTestRunIds.push(selection);
          }
        });

        resolve(selectedTestRunIds);
      });
    });
  }

  async run() {
    console.log("Test Run Deleter CLI Tool");
    console.log("============================");
    console.log(`API URL: ${this.apiUrl}`);
    console.log(`Test ID: ${this.testId}`);
    console.log(`Region: ${this.region}`);
    console.log("");

    try {
      let testRunIdsToDelete = this.testRunIds;

      if (this.interactive || this.testRunIds.length === 0) {
        // Interactive mode: fetch and display available test runs
        const availableTestRuns = await this.getTestRuns(this.testId);

        if (availableTestRuns.length === 0) {
          console.log("No test runs found for this test.");
          return;
        }

        testRunIdsToDelete = await this.promptForTestRuns(availableTestRuns);
      }

      if (testRunIdsToDelete.length === 0) {
        console.log("No test runs selected for deletion.");
        return;
      }

      // Confirm deletion
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const confirmed = await new Promise((resolve) => {
        rl.question(`\nAre you sure you want to delete ${testRunIdsToDelete.length} test runs? (y/N): `, (answer) => {
          rl.close();
          resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
        });
      });

      if (!confirmed) {
        console.log("Deletion cancelled.");
        return;
      }

      // Perform deletion
      const result = await this.deleteTestRuns(this.testId, testRunIdsToDelete);

      console.log("\n=== DELETION SUMMARY ===");
      console.log(`Requested to delete: ${testRunIdsToDelete.length} test runs`);
      console.log(`Successfully deleted: ${result.deletedCount} test runs`);

      if (result.deletedCount < testRunIdsToDelete.length) {
        const skipped = testRunIdsToDelete.length - result.deletedCount;
        console.log(`Skipped (not found): ${skipped} test runs`);
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
      case "--url":
        options.apiUrl = args[index + 1];
        processed.add(index + 1); // Mark next index as processed
        break;
      case "--test-id":
        options.testId = args[index + 1];
        processed.add(index + 1);
        break;
      case "--test-run-ids":
        options.testRunIds = args[index + 1] ? args[index + 1].split(",").map((id) => id.trim()) : [];
        processed.add(index + 1);
        break;
      case "--region":
        options.region = args[index + 1];
        processed.add(index + 1);
        break;
      case "--interactive":
        options.interactive = true;
        // No need to mark next index - this flag has no value
        break;
      case "--help":
      case "-h":
        showHelp();
        process.exit(0);
        break;
      default:
        if (key.startsWith("--")) {
          console.log(`Unknown argument: ${key}`);
          showHelp();
          process.exit(1);
        }
        break;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Test Run Deleter - CLI Tool for testing DELETE /scenarios/{testId}/testruns API

USAGE:
  node testrun-deleter.js --url <API_URL> --test-id <TEST_ID> [OPTIONS]

REQUIRED ARGUMENTS:
  --url <API_URL>           API Gateway URL (e.g., https://api123.execute-api.us-east-1.amazonaws.com)
  --test-id <TEST_ID>       Test scenario ID

OPTIONAL ARGUMENTS:
  --test-run-ids <IDS>      Comma-separated list of test run IDs to delete (e.g., run123,run456)
  --interactive             Interactive mode - browse and select test runs to delete
  --region <REGION>         AWS region (default: us-east-1)
  --help, -h                Show this help message

MODES:
  Direct Mode:              Specify test run IDs directly with --test-run-ids
  Interactive Mode:         Use --interactive to browse available test runs and select which to delete

EXAMPLES:
  # Delete specific test runs (direct mode)
  node testrun-deleter.js --url https://api123.execute-api.us-east-1.amazonaws.com --test-id test123 --test-run-ids run456,run789

  # Delete single test run
  node testrun-deleter.js --url https://api123.execute-api.us-east-1.amazonaws.com --test-id test123 --test-run-ids run456

  # Interactive mode - browse and select
  node testrun-deleter.js --url https://api123.execute-api.us-east-1.amazonaws.com --test-id test123 --interactive

  # Interactive mode in different region
  node testrun-deleter.js --url https://api123.execute-api.eu-west-1.amazonaws.com --test-id test123 --region eu-west-1 --interactive

API SPECIFICATION:
  DELETE /scenarios/{testId}/testruns
  Request Body: ["testRunId1", "testRunId2", ...]
  Response: { "deletedCount": <number> }

BEHAVIOR:
  - Non-existent test run IDs are silently skipped
  - Only test runs belonging to the specified testId can be deleted
  - Returns count of successfully deleted test runs
  - Batch operations are handled automatically (up to DynamoDB limits)

AUTHENTICATION:
  This tool uses AWS credentials from your environment:
  - AWS CLI profile (aws configure)
  - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
  - IAM roles (if running on EC2/Lambda)

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

  // Validate that either test-run-ids or interactive mode is specified
  if (!options.interactive && (!options.testRunIds || options.testRunIds.length === 0)) {
    console.log("ERROR: Either specify --test-run-ids or use --interactive mode");
    console.log("Use: --test-run-ids <ID1,ID2,...> or --interactive");
    process.exit(1);
  }
}

async function main() {
  const options = parseArgs();
  validateOptions(options);

  const deleter = new TestRunDeleter(options);
  await deleter.run();
}

// Run the CLI tool if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Unexpected error:", error.message);
    process.exit(1);
  });
}

module.exports = TestRunDeleter;
