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
    // TODO: Invalid test ID should throw explicit error
    xit("GET /scenarios/{testId}", async () => {
      const result: ErrorResponse = await axios.get(`${config.apiUrl}/scenarios/INVALID_TEST_ID`);
      expect(result.status).toBe(400); // TODO - this should be 404
      expect(result.code).toBe("ERR_BAD_REQUEST"); // TODO - this should be "NOT_FOUND"
      expect(result.data).toStrictEqual({
        message: "testId 'INVALID_TEST_ID' not found",
      });
    }); // TODO - this is failing, error message needs to be fixed
    xit("POST scenarios/{testId}", async () => {
      const result = await axios.post(`${config.apiUrl}/scenarios/INVALID_TEST_ID`);
      expect(result.status).toBe(200);
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
});
