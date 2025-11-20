// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import axios, { AxiosError, AxiosResponse } from "axios";
import { load } from "../api.config";
import { setupAxiosInterceptors, teardownAxiosInterceptors, ErrorResponse } from "./utils";
const config = load();

describe("Unauthenticated API (without sigv4)", () => {
  beforeAll(async () => {
    axios.interceptors.response.use(
      (response: AxiosResponse): AxiosResponse => response,
      (error: AxiosError): AxiosError => error
    );
  });
  afterAll(async () => {
    axios.interceptors.response.clear();
  });

  describe("Base API", () => {
    it("OPTIONS /", async () => {
      const result: AxiosResponse = await axios.options(config.apiUrl);
      expect(result.status).toBe(200);
    });
    it("GET /", async () => {
      const result: AxiosError = await axios.get(config.apiUrl);
      expect(result.response.status).toBe(403);
      expect(result.response.data).toStrictEqual({ message: "Missing Authentication Token" });
    });
  });

  describe("API endpoints", () => {
    it("OPTIONS scenarios", async () => {
      const result: AxiosResponse = await axios.options(`${config.apiUrl}/scenarios`);
      expect(result.status).toBe(200);
    });
    it("GET /scenarios", async () => {
      const result: AxiosError = await axios.get(`${config.apiUrl}/scenarios`);
      expect(result.response.status).toBe(403);
      expect(result.response.data).toStrictEqual({ message: "Missing Authentication Token" });
    });
    it("OPTIONS scenarios/{testId}", async () => {
      const result: AxiosResponse = await axios.options(`${config.apiUrl}/scenarios/INVALID_TEST_ID`);
      expect(result.status).toBe(200);
    });
    it("GET /scenarios/{testId}", async () => {
      const result: AxiosError = await axios.get(`${config.apiUrl}/scenarios/INVALID_TEST_ID`);
      expect(result.response.status).toBe(403);
      expect(result.response.data).toStrictEqual({ message: "Missing Authentication Token" });
    });
    it("OPTIONS /tasks", async () => {
      const result: AxiosResponse = await axios.options(`${config.apiUrl}/tasks`);
      expect(result.status).toBe(200);
    });
    it("GET /tasks", async () => {
      const result: AxiosError = await axios.get(`${config.apiUrl}/tasks`);
      expect(result.response.status).toBe(403);
      expect(result.response.data).toStrictEqual({ message: "Missing Authentication Token" });
    });
    it("OPTIONS /regions", async () => {
      const result: AxiosResponse = await axios.options(`${config.apiUrl}/regions`);
      expect(result.status).toBe(200);
    });
    it("GET /regions", async () => {
      const result: AxiosError = await axios.get(`${config.apiUrl}/regions`);
      expect(result.response.status).toBe(403);
      expect(result.response.data).toStrictEqual({ message: "Missing Authentication Token" });
    });
    it("OPTIONS /scenarios/{testId}/baseline", async () => {
      const result: AxiosResponse = await axios.options(`${config.apiUrl}/scenarios/INVALID_TEST_ID/baseline`);
      expect(result.status).toBe(200);
    });
    it("GET /scenarios/{testId}/baseline", async () => {
      const result: AxiosError = await axios.get(`${config.apiUrl}/scenarios/INVALID_TEST_ID/baseline`);
      expect(result.response.status).toBe(403);
      expect(result.response.data).toStrictEqual({ message: "Missing Authentication Token" });
    });
    it("PUT /scenarios/{testId}/baseline", async () => {
      const result: AxiosError = await axios.put(`${config.apiUrl}/scenarios/INVALID_TEST_ID/baseline`, {
        testRunId: "test-run-123",
      });
      expect(result.response.status).toBe(403);
      expect(result.response.data).toStrictEqual({ message: "Missing Authentication Token" });
    });
    it("DELETE /scenarios/{testId}/baseline", async () => {
      const result: AxiosError = await axios.delete(`${config.apiUrl}/scenarios/INVALID_TEST_ID/baseline`);
      expect(result.response.status).toBe(403);
      expect(result.response.data).toStrictEqual({ message: "Missing Authentication Token" });
    });
  });
});

describe("Authenticated API", () => {
  beforeAll(async () => {
    setupAxiosInterceptors();
  });
  afterAll(async () => {
    teardownAxiosInterceptors();
  });

  describe("/scenarios", () => {
    it("GET /scenarios", async () => {
      const result: AxiosResponse = await axios.get(`${config.apiUrl}/scenarios`);
      expect(result.status).toBe(200);
    });
  });

  describe("/scenarios/{testId}", () => {
    it("GET /scenarios/{testId}", async () => {
      const result: ErrorResponse = await axios.get(`${config.apiUrl}/scenarios/INVALID_TEST_ID`);
      expect(result.status).toBe(404);
      expect(result.code).toBe("NOT_FOUND");
      expect(result.data).toEqual("TEST_NOT_FOUND: testId 'INVALID_TEST_ID' not found");
    });
    it("POST scenarios/{testId}", async () => {
      const result = await axios.post(`${config.apiUrl}/scenarios/INVALID_TEST_ID`);
      expect(result.status).toBe(404);
      expect(result.data).toEqual("TEST_NOT_FOUND: testId 'INVALID_TEST_ID' not found");
    });
    xit("DELETE scenarios/{testId}", async () => {
      const result = await axios.delete(`${config.apiUrl}/scenarios/INVALID_TEST_ID`);
      expect(result.status).toBe(200);
    });
  });

  describe("/tasks", () => {
    it("GET /tasks", async () => {
      const result: AxiosResponse = await axios.get(`${config.apiUrl}/tasks`);
      expect(result.status).toBe(200);
    });
  });

  describe("/regions", () => {
    it("GET /regions", async () => {
      const result: AxiosResponse = await axios.get(`${config.apiUrl}/regions`);
      expect(result.status).toBe(200);
    });
  });

  describe("/scenarios/{testId}/baseline", () => {
    const MOCK_TEST_ID = "baseline-test-123";
    const MOCK_TEST_RUN_ID = "test-run-456";

    describe("GET /scenarios/{testId}/baseline - Get Baseline", () => {
      it("should return 404 for non-existent test scenario", async () => {
        const result: ErrorResponse = await axios.get(`${config.apiUrl}/scenarios/NON_EXISTENT_TEST/baseline`);
        expect(result.status).toBe(404);
        expect(result.data).toContain("TEST_NOT_FOUND");
      });

      it("should return 200 with null baseline when no baseline is set", async () => {
        const result: AxiosResponse = await axios.get(`${config.apiUrl}/scenarios/${MOCK_TEST_ID}/baseline`);
        expect(result.status).toBe(200);
        expect(result.data.testId).toBe(MOCK_TEST_ID);
        expect(result.data.baselineId).toBeNull();
        expect(result.data.message).toBe("No baseline set for this test");
      });

      it("should support ?data=false query parameter for simple response", async () => {
        const result: AxiosResponse = await axios.get(`${config.apiUrl}/scenarios/${MOCK_TEST_ID}/baseline?data=false`);
        expect(result.status).toBe(200);
        expect(result.data.testId).toBe(MOCK_TEST_ID);
        // Should not include enhanced test run details when data=false
      });

      // Note: This test would require a real test scenario with baseline set
      xit("should return baseline info with enhanced details by default", async () => {
        const result: AxiosResponse = await axios.get(`${config.apiUrl}/scenarios/${MOCK_TEST_ID}/baseline`);
        expect(result.status).toBe(200);
        expect(result.data.testId).toBe(MOCK_TEST_ID);
        expect(result.data.baselineId).toBeDefined();
        expect(result.data.testRunDetails).toBeDefined(); // Enhanced response includes test run details
        expect(result.data.message).toBe("Baseline retrieved successfully");
      });
    });

    describe("PUT /scenarios/{testId}/baseline - Set Baseline", () => {
      it("should return 404 for non-existent test scenario", async () => {
        const result: ErrorResponse = await axios.put(`${config.apiUrl}/scenarios/NON_EXISTENT_TEST/baseline`, {
          testRunId: MOCK_TEST_RUN_ID,
        });
        expect(result.status).toBe(404);
        expect(result.data).toContain("TEST_NOT_FOUND");
      });

      it("should return 400 when testRunId is missing", async () => {
        const result: ErrorResponse = await axios.put(`${config.apiUrl}/scenarios/${MOCK_TEST_ID}/baseline`, {});
        expect(result.status).toBe(400);
        expect(result.data).toContain("INVALID_PARAMETER");
        expect(result.data).toContain("testRunId is required");
      });

      it("should return 400 when testRunId is null", async () => {
        const result: ErrorResponse = await axios.put(`${config.apiUrl}/scenarios/${MOCK_TEST_ID}/baseline`, {
          testRunId: null,
        });
        expect(result.status).toBe(400);
        expect(result.data).toContain("INVALID_PARAMETER");
        expect(result.data).toContain("testRunId is required");
      });

      it("should return 400 when testRunId is empty string", async () => {
        const result: ErrorResponse = await axios.put(`${config.apiUrl}/scenarios/${MOCK_TEST_ID}/baseline`, {
          testRunId: "",
        });
        expect(result.status).toBe(400);
        expect(result.data).toContain("INVALID_PARAMETER");
        expect(result.data).toContain("testRunId is required");
      });

      // Note: This test would require a real test scenario with history entries to pass
      // For actual testing, you would need to:
      // 1. Create a test scenario
      // 2. Run the test to create history entries
      // 3. Then use those IDs for baseline operations
      xit("should set baseline successfully with valid testId and testRunId", async () => {
        const result: AxiosResponse = await axios.put(`${config.apiUrl}/scenarios/${MOCK_TEST_ID}/baseline`, {
          testRunId: MOCK_TEST_RUN_ID,
        });
        expect(result.status).toBe(200);
        expect(result.data.testId).toBe(MOCK_TEST_ID);
        expect(result.data.baselineId).toBe(MOCK_TEST_RUN_ID);
        expect(result.data.message).toBe("Baseline set successfully");
      });
    });

    describe("DELETE /scenarios/{testId}/baseline - Clear Baseline", () => {
      it("should return 404 for non-existent test scenario", async () => {
        const result: ErrorResponse = await axios.delete(`${config.apiUrl}/scenarios/NON_EXISTENT_TEST/baseline`);
        expect(result.status).toBe(404);
        expect(result.data).toContain("TEST_NOT_FOUND");
      });

      it("should return 400 when no baseline is set", async () => {
        const result: ErrorResponse = await axios.delete(`${config.apiUrl}/scenarios/${MOCK_TEST_ID}/baseline`);
        expect(result.status).toBe(400);
        expect(result.data).toContain("NO_BASELINE_SET");
      });

      // Note: This test would require a test scenario with a baseline already set
      xit("should clear baseline successfully", async () => {
        const result: AxiosResponse = await axios.delete(`${config.apiUrl}/scenarios/${MOCK_TEST_ID}/baseline`);
        expect(result.status).toBe(200);
        expect(result.data.message).toBe("Baseline cleared successfully");
        expect(result.data.testId).toBe(MOCK_TEST_ID);
      });
    });

    describe("Baseline API Integration Flow", () => {
      // This is a comprehensive test that would work with real data
      // It demonstrates the complete flow of setting and clearing baselines
      xit("should support complete baseline lifecycle", async () => {
        // This test would require:
        // 1. A real test scenario ID
        // 2. A real test run ID from the history table

        const realTestId = "YOUR_REAL_TEST_ID";
        const realTestRunId = "YOUR_REAL_TEST_RUN_ID";

        // Step 1: Set baseline
        const setResult: AxiosResponse = await axios.put(`${config.apiUrl}/scenarios/${realTestId}/baseline`, {
          testRunId: realTestRunId,
        });
        expect(setResult.status).toBe(200);
        expect(setResult.data.baselineId).toBe(realTestRunId);

        // Step 2: Update baseline with a different test run
        const anotherTestRunId = "ANOTHER_REAL_TEST_RUN_ID";
        const updateResult: AxiosResponse = await axios.put(`${config.apiUrl}/scenarios/${realTestId}/baseline`, {
          testRunId: anotherTestRunId,
        });
        expect(updateResult.status).toBe(200);
        expect(updateResult.data.baselineId).toBe(anotherTestRunId);
        expect(updateResult.data.message).toBe("Baseline updated successfully");
        expect(updateResult.data.previousBaselineId).toBe(realTestRunId);

        // Step 3: Clear baseline
        const clearResult: AxiosResponse = await axios.delete(`${config.apiUrl}/scenarios/${realTestId}/baseline`);
        expect(clearResult.status).toBe(200);
        expect(clearResult.data.message).toBe("Baseline cleared successfully");

        // Step 4: Verify baseline is cleared
        const clearAgainResult: ErrorResponse = await axios.delete(`${config.apiUrl}/scenarios/${realTestId}/baseline`);
        expect(clearAgainResult.status).toBe(400);
        expect(clearAgainResult.data).toContain("NO_BASELINE_SET");
      });
    });
  });
});
