// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import axios from "axios";
import { load } from "../api.config";
import { ScenarioRequest, ScenarioResponse } from "./scenario";
import { setupAxiosInterceptors, teardownAxiosInterceptors, validateScenario } from "./utils";

const config = load();
const POST_TEST_ID = "POST-TEST-ID-001";

const defaultRequest: ScenarioRequest = {
  testId: POST_TEST_ID,
  testName: "POST Scenario Test",
  testDescription: "",
  testTaskConfigs: [{ concurrency: "1", taskCount: "1", region: "us-east-1" }],
  testScenario: {
    execution: [{ "ramp-up": "1m", "hold-for": "1m", scenario: "Some Test" }],
    scenarios: {},
  },
  showLive: false,
  testType: "simple",
  fileType: "",
  regionalTaskDetails: {
    "us-east-1": { vCPULimit: 4000, vCPUsPerTask: 2, vCPUsInUse: 0, dltTaskLimit: 2000, dltAvailableTasks: 2000 },
  },
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
      const result = await axios.delete(`${config.apiUrl}/scenarios/${POST_TEST_ID}`);
      if (result.status !== 200) {
        throw new Error(`Cleanup failed during deleting test data with status code: ${result.status}`);
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
      await axios.delete(`${config.apiUrl}/scenarios/${POST_TEST_ID}`);
      // TODO: uncomment after making DELETE API returns 404 when test not found
      // if (result.status !== 200 && result.status !== 404) {
      //   throw new Error(`DELETE request failed with status code: ${result.status}`);
      // }
    });

    const defaultScheduleRequest = {
      ...defaultRequest,
      recurrence: "weekly",
      scheduleDate: "2023-01-01",
      scheduleStep: "create",
      scheduleTime: "14:15",
    };

    const now = new Date();
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
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, defaultCronScheduleRequest);
      expect(result.status).toBe(200);
    });

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
      expect(result.data).toBe("Invalid Linux cron expression: Expected format: * * * * *");
      defaultCronScheduleRequest.cronValue = temp;
    });

    it("Failed creation, invalid cron input", async () => {
      const temp = defaultCronScheduleRequest.cronValue;
      defaultCronScheduleRequest.cronValue = "abc abc abc abc abc";
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultCronScheduleRequest,
      });
      expect(result.status).toBe(400);
      expect(result.data).toBe("Invalid Linux cron expression: Expected format: * * * * *");
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
      expect(result.data).toBe("Invalid Linux cron expression: Expected format: * * * * *");
      defaultCronScheduleRequest.cronValue = temp;
    });

    // TODO: Dates in the past should not be accepted, appropriate message should be returned.
    xit("Invalid date", async () => {
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultScheduleRequest,
        scheduleDate: "2000-01-01",
      });
      expect(result.status).toBe(400);
      expect(result.data).toBe("Date must be in the future.");
    });

    // TODO: Invalid times should not be accepted, appropriate message should be returned.
    xit("Invalid time", async () => {
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultScheduleRequest,
        scheduleTime: "25:15",
      });
      expect(result.status).toBe(400);
      expect(result.data).toBe("Time must be valid.");
    });

    it("Invalid time format", async () => {
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultScheduleRequest,
        scheduleTime: "2:15PM",
      });
      expect(result.status).toBe(400);
      expect(result.data).toBe("ValidationException: Parameter ScheduleExpression is not valid.");
    });

    // TODO: Invalid formats should not be accepted, appropriate message should be returned.
    xit("Invalid date format", async () => {
      const result: ScenarioResponse = await axios.post(`${config.apiUrl}/scenarios`, {
        ...defaultScheduleRequest,
        scheduleDate: "01-01-3024",
      });
      expect(result.status).toBe(400);
      expect(result.data).toBe("Invalid date format.");
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
    afterAll(async () => {
      const result = await axios.delete(`${config.apiUrl}/scenarios/${POST_TEST_ID}`);
      if (result.status !== 200) {
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
