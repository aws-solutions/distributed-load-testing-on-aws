// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import axios from "axios";
import { load } from "../api.config";
import { ScenarioRequest, ScenarioResponse } from "./scenario";
import { setupAxiosInterceptors, teardownAxiosInterceptors, validateScenario } from "./utils";
import { S3Client, PutObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const config = load();

const POST_TEST_ID = "POST-TEST-ID-001";
const POST_TEST_JMX_ID = "POST-TEST-JMX-ID-001";
const POST_TEST_ZIP_ID = "POST-TEST-ZIP-ID-001";

const REGION = config.region;
const s3Client = new S3Client({ region: REGION });
const defaultRequest: ScenarioRequest = {
  testId: POST_TEST_ID,
  testName: "POST Scenario Test",
  testDescription: "",
  testTaskConfigs: [{ concurrency: "1", taskCount: "1", region: REGION }],
  testScenario: {
    execution: [{ "ramp-up": "1m", "hold-for": "1m", scenario: "Some Test" }],
    scenarios: {},
  },
  showLive: false,
  testType: "simple",
  fileType: "",
  regionalTaskDetails: {
    [REGION]: { vCPULimit: 4000, vCPUsPerTask: 2, vCPUsInUse: 0, dltTaskLimit: 2000, dltAvailableTasks: 2000 },
  },
};

const putObject = async (srcKey: string, destKey: string) => {
  try {
    const command = new PutObjectCommand({
      Body: `${srcKey}`,
      Bucket: config.s3ScenarioBucket,
      Key: `public/test-scenarios/jmeter/${destKey}`,
    });
    const response = await s3Client.send(command);
    return response;
  } catch (err) {
    console.error(err);
    throw err;
  }
};

const removeObjects = async (keys: string[]) => {
  try {
    const command = new DeleteObjectsCommand({
      Bucket: config.s3ScenarioBucket,
      Delete: { Objects: keys.map((key) => ({ Key: `public/test-scenarios/jmeter/${key}` })) },
    });

    const response = await s3Client.send(command);
    console.log(`Successfully deleted ${response.Deleted?.length} objects from bucket ${config.s3ScenarioBucket}`);
    return response;
  } catch (err) {
    console.error(`Error deleting objects from bucket ${config.s3ScenarioBucket}:`, err);
    throw err;
  }
};

describe("/scenarios", () => {
  beforeAll(async () => {
    setupAxiosInterceptors();
  });
  afterAll(async () => {
    teardownAxiosInterceptors();
  });

  describe("Post - Basic input parameters", () => {
    afterEach(async () => {
      for (const testId of [POST_TEST_ID, POST_TEST_JMX_ID, POST_TEST_ZIP_ID]) {
        const result = await axios.delete(`${config.apiUrl}/scenarios/${testId}`);
        if (result.status !== 404 && result.status !== 200) {
          throw new Error(`Cleanup failed during deleting test with ${testId} data with status code: ${result.status}`);
        }
      }
    });
    const requiredParameters = [
      "testName",
      "testDescription",
      "testTaskConfigs",
      "testScenario",
      "showLive",
      "testType",
      "regionalTaskDetails",
    ];

    it("Successful creation", async () => {
      const result = await axios.post(`${config.apiUrl}/scenarios`, defaultRequest);
      expect(result.status).toBe(200);
    });

    it("Successful creation, jmeter test", async () => {
      await putObject("./assets/jmeter.jmx", `${POST_TEST_JMX_ID}.jmx`);
      const tmp = defaultRequest.testId;
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultRequest,
        testScenario: {
          execution: [{ "ramp-up": "1m", "hold-for": "1m", scenario: "Some Test" }],
          scenarios: { "Some Test": { script: `${POST_TEST_JMX_ID}.jmx` } },
        },
        testId: POST_TEST_JMX_ID,
        testType: "jmeter",
        fileType: "jmeter",
      });
      expect(result.status).toBe(200);
      defaultRequest.testScenario.scenarios = {};
      removeObjects([`${POST_TEST_JMX_ID}.jmx`]);
      defaultRequest.testId = tmp;
      defaultRequest.fileType = "";
      defaultRequest.testType = "simple";
    });

    it("Successful creation, zip test", async () => {
      await putObject("./assets/ziptest.zip", `${POST_TEST_ZIP_ID}.zip`);
      const tmp = defaultRequest.testId;
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultRequest,
        testScenario: {
          execution: [{ "ramp-up": "1m", "hold-for": "1m", scenario: "Some Test" }],
          scenarios: { "Some Test": { script: `${POST_TEST_ZIP_ID}.zip` } },
        },
        testId: POST_TEST_JMX_ID,
        testType: "jmeter",
        fileType: "jmeter",
      });
      expect(result.status).toBe(200);
      defaultRequest.testScenario.scenarios = {};
      await removeObjects([`${POST_TEST_ZIP_ID}.zip`]);
      defaultRequest.testId = tmp;
      defaultRequest.fileType = "";
      defaultRequest.testType = "simple";
    });

    xit("Failed creation, jmeter test wrong extension", async () => {
      await putObject("./assets/jmeter.jmx", `${POST_TEST_JMX_ID}.jmx`);
      const tmp = defaultRequest.testId;
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultRequest,
        testScenario: {
          execution: [{ "ramp-up": "1m", "hold-for": "1m", scenario: "Some Test" }],
          scenarios: { "Some Test": { script: `${POST_TEST_JMX_ID}.jx` } },
        },
        testId: POST_TEST_JMX_ID,
        testType: "jmeter",
        fileType: "jmeter",
      });
      expect(result.status).toBe(400);
      // test the response message
      defaultRequest.testScenario.scenarios = {};
      removeObjects([`${POST_TEST_JMX_ID}.jmx`]);
      defaultRequest.testId = tmp;
      defaultRequest.fileType = "";
      defaultRequest.testType = "simple";
    });

    xit("Failed creation, jmeter test file not exist", async () => {
      const tmp = defaultRequest.testId;
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultRequest,
        testScenario: {
          execution: [{ "ramp-up": "1m", "hold-for": "1m", scenario: "Some Test" }],
          scenarios: { "Some Test": { script: `${POST_TEST_JMX_ID}.jmx` } },
        },
        testId: POST_TEST_JMX_ID,
        testType: "jmeter",
        fileType: "jmeter",
      });
      expect(result.status).toBe(400);
      // test the response message
      defaultRequest.testScenario.scenarios = {};
      defaultRequest.testId = tmp;
      defaultRequest.fileType = "";
      defaultRequest.testType = "simple";
    });

    it("Required parameters behavior", async () => {
      for (const parameter of requiredParameters) {
        const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
          ...defaultRequest,
          [parameter]: undefined,
        });
        expect(result.status).toBe(400);
        // expect(result.data).toBe("Missing required parameter: " + parameter)
      }
    });

    it("Optional parameter behavior", async () => {
      const optionalParameters = ["fileType"];
      for (const parameter of optionalParameters) {
        const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
          ...defaultRequest,
          [parameter]: undefined,
        });
        expect(result.status).toBe(200);
      }
    });
  });

  describe("Post - Scheduled test request", () => {
    afterEach(async () => {
      const result = await axios.delete(`${config.apiUrl}/scenarios/${POST_TEST_ID}`);
      if (result.status !== 200 && result.status !== 404) {
        throw new Error(`DELETE request failed with status code: ${result.status}`);
      }
    });

    const now = new Date();
    const defaultScheduleRequest = {
      ...defaultRequest,
      recurrence: "weekly",
      scheduleDate: now.toISOString().split("T")[0],
      scheduleStep: "create",
      scheduleTime: "14:15",
    };

    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60000);

    const minute = fiveMinutesFromNow.getUTCMinutes();
    const hour = fiveMinutesFromNow.getUTCHours();
    const day = fiveMinutesFromNow.getUTCDate();
    const month = fiveMinutesFromNow.getUTCMonth() + 1; // Months are 0-indexed
    const defaultCronScheduleRequest = {
      ...defaultRequest,
      cronValue: `${minute} ${hour} ${day} ${month} *`,
      scheduleStep: "create",
      scheduleDate: "",
      scheduleTime: "",
      recurrence: undefined,
    };

    it("Successful creation", async () => {
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, defaultScheduleRequest);
      expect(result.status).toBe(200);
    });

    it("Successful creation, non-recurring", async () => {
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultScheduleRequest,
        recurrence: undefined,
        scheduleStep: "start",
      });
      expect(result.status).toBe(200);
    });

    it("Successful creation, cron schedule", async () => {
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultCronScheduleRequest,
        cronExpiryDate: "2099-01-01",
      });
      expect(result.status).toBe(200);
    }, 20000);

    it("Successful creation, cron schedule with expiry date", async () => {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 2);

      const year = tomorrow.getFullYear();
      const month = String(tomorrow.getMonth() + 1).padStart(2, "0"); // Months are 0-indexed
      const day = String(tomorrow.getDate()).padStart(2, "0");

      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultCronScheduleRequest,
        cronExpiryDate: `${year}-${month}-${day}`,
      });
      expect(result.status).toBe(200);
      const [nextRunDate, nextRunTime] = result.data.nextRun.split(" ");
      expect(nextRunDate).toBe(`${fiveMinutesFromNow.toISOString().slice(0, 10)}`);
      expect(nextRunTime).toBe(`${fiveMinutesFromNow.toISOString().slice(11, 17)}00`);
    });

    it("Failed creation, missing all scheduling inputs", async () => {
      const temp = defaultCronScheduleRequest.cronValue;
      defaultCronScheduleRequest.cronValue = "";
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultCronScheduleRequest,
      });
      expect(result.status).toBe(400);
      expect(result.data).toBe(
        "InvalidParameter: Missing cronValue, scheduleDate and ScheduleTime. Cannot schedule the Test."
      );
      defaultCronScheduleRequest.cronValue = temp;
    });

    it("Failed creation, invalid length cron expression", async () => {
      const temp = defaultCronScheduleRequest.cronValue;
      defaultCronScheduleRequest.cronValue = "* 1";
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultCronScheduleRequest,
      });
      expect(result.status).toBe(400);
      expect(result.data).toBe("Invalid Linux cron expression: Expected format: 0 * * * *");
      defaultCronScheduleRequest.cronValue = temp;
    });

    it("Failed creation, invalid cron input", async () => {
      const temp = defaultCronScheduleRequest.cronValue;
      defaultCronScheduleRequest.cronValue = "abc abc abc abc abc";
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultCronScheduleRequest,
      });
      expect(result.status).toBe(400);
      expect(result.data).toBe("Invalid Linux cron expression: Expected format: 0 * * * *");
      defaultCronScheduleRequest.cronValue = temp;
    });

    it("Failed Creation, invalid cron expiry date", async () => {
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultCronScheduleRequest,
        cronExpiryDate: "2021-01-01",
      });
      expect(result.status).toBe(400);
      expect(result.data).toBe("Invalid Parameter: Cron Expiry Date older than the next run.");
    });

    it("Failed Creation, empty cron expression", async () => {
      const temp = defaultCronScheduleRequest.cronValue;
      defaultCronScheduleRequest.cronValue = " ";
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultCronScheduleRequest,
      });
      expect(result.status).toBe(400);
      expect(result.data).toBe("Invalid Linux cron expression: Expected format: 0 * * * *");
      defaultCronScheduleRequest.cronValue = temp;
    });

    it("Invalid date", async () => {
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultScheduleRequest,
        scheduleDate: "2000-01-01",
      });
      expect(result.status).toBe(400);
      expect(result.data).toContain("Date cannot be in the past");
    });

    it("Invalid time", async () => {
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultScheduleRequest,
        scheduleTime: "25:15",
      });
      expect(result.status).toBe(400);
      expect(result.data).toContain("Invalid time format");
    });

    it("Invalid time format", async () => {
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultScheduleRequest,
        scheduleTime: "2:15PM",
      });
      expect(result.status).toBe(400);
      expect(result.data).toContain("Invalid time format. Expected format: HH:MM");
    });

    it("Invalid date format", async () => {
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultScheduleRequest,
        scheduleDate: "01-01-3024",
      });
      expect(result.status).toBe(400);
      expect(result.data).toContain("Invalid date format");
    });

    it("Invalid date type", async () => {
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultScheduleRequest,
        scheduleDate: 2000,
      });
      expect(result.status).toBe(400);
      expect(result.data).toBe("TypeError: scheduleDate.split is not a function or its return value is not iterable");
    });
  });

  describe("GET", () => {
    beforeAll(async () => {
      const result = await axios.post(`${config.apiUrl}/scenarios`, defaultRequest);
      if (result.status !== 200) {
        throw new Error(`Setup function failed in creating test data status code: ${result.status}`);
      }
    });
    afterEach(async () => {
      const result = await axios.delete(`${config.apiUrl}/scenarios/${POST_TEST_ID}`);
      if (result.status !== 404 && result.status !== 200) {
        throw new Error(`Cleanup failed during deleting test data with status code: ${result.status}`);
      }
    });

    it("Successful retrieval of all test scenarios", async () => {
      const result = await axios.get(`${config.apiUrl}/scenarios/`);
      expect(result.status).toBe(200);
      const items: ScenarioResponse[] = result.data.Items;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
      expect(validateScenario(items[0])).toBe(true);
    });
  });
});
