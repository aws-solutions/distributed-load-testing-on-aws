// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import axios, { AxiosResponse } from "axios";
import { load } from "../api.config";
import { ScenarioRequest } from "./scenario";
import { setupAxiosInterceptors, teardownAxiosInterceptors, ErrorResponse, validateScenario } from "./utils";

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

describe("/scenarios/{testId}", () => {
  beforeAll(async () => {
    setupAxiosInterceptors();
  });
  afterAll(async () => {
    teardownAxiosInterceptors();
  });

  describe("POST", () => {
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

    it("Successful cancellation", async () => {
      const result: AxiosResponse = await axios.post(`${config.apiUrl}/scenarios/${POST_TEST_ID}`);
      expect(result.status).toBe(200);
      expect(result.data).toBe("test cancelling");
    });

    // TODO - appropriate status, code and message should be returned.
    xit("Invalid ID", async () => {
      const result: ErrorResponse = await axios.post(`${config.apiUrl}/scenarios/INVALID_TEST_ID`);
      expect(result.status).toBe(404);
      expect(result.code).toBe("NOT_FOUND");
      expect(result.data).toContain("testId 'INVALID_TEST_ID' not found");
    });

    it("Missing ID", async () => {
      const result: ErrorResponse = await axios.post(`${config.apiUrl}/scenarios/`);
      expect(result.status).toBe(400);
      expect(result.code).toBe("ERR_BAD_REQUEST");
    });

    it("Invalid Method", async () => {
      const result: ErrorResponse = await axios.put(`${config.apiUrl}/scenarios/${POST_TEST_ID}`);
      expect(result.status).toBe(400); // TODO - this should be 405 (Method Not Allowed)
      expect(result.data).toContain("Error: Method: PUT not supported for this resource: /scenarios/{testId}");
    });
  });

  describe("DELETE", () => {
    beforeAll(async () => {
      const result = await axios.post(`${config.apiUrl}/scenarios`, defaultRequest);
      if (result.status !== 200) {
        throw new Error(`Setup function failed in creating test data status code: ${result.status}`);
      }
    });

    it("Successful deletion", async () => {
      const result: AxiosResponse = await axios.delete(`${config.apiUrl}/scenarios/${POST_TEST_ID}`);
      expect(result.status).toBe(200);
      expect(result.data).toBe("success");

      await axios.get(`${config.apiUrl}/scenarios/${POST_TEST_ID}`);
      // TODO - appropriate status and code should be returned.
      // expect(errorResult.status).toBe(404);
      // expect(errorResult.code).toBe("NOT_FOUND");
    });

    // TODO - appropriate status, code and message should be returned.
    xit("Invalid ID", async () => {
      const result: ErrorResponse = await axios.post(`${config.apiUrl}/scenarios/INVALID_TEST_ID`);
      expect(result.status).toBe(404);
      expect(result.code).toBe("NOT_FOUND");
      expect(result.data).toContain("testId 'INVALID_TEST_ID' not found");
    });

    it("Missing ID", async () => {
      const result: ErrorResponse = await axios.post(`${config.apiUrl}/scenarios/`);
      expect(result.status).toBe(400);
      expect(result.code).toBe("ERR_BAD_REQUEST");
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

    it("Successful retrieval of test scenario", async () => {
      const result = await axios.get(`${config.apiUrl}/scenarios/${POST_TEST_ID}`);
      expect(result.status).toBe(200);
      expect(validateScenario(result.data)).toBe(true);
    });

    // TODO - appropriate status, code and message should be returned.
    xit("Invalid ID", async () => {
      const result: ErrorResponse = await axios.get(`${config.apiUrl}/scenarios/INVALID_TEST_ID`);
      expect(result.status).toBe(404);
      expect(result.code).toBe("NOT_FOUND");
      expect(result.data).toContain("testId 'INVALID_TEST_ID' not found");
    });
  });
});
