// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../../src/lib/config.js", () => ({
  loadConfig: vi.fn(() => ({
    apiEndpoint: "https://api.example.com/prod",
    userPoolId: "us-east-1_AbCdEfG",
    userPoolClientId: "client123",
    identityPoolId: "us-east-1:aaaa-bbbb",
    userPoolDomain: "dlt-test.auth.us-east-1.amazoncognito.com",
    region: "us-east-1",
  })),
}));

vi.mock("../../src/lib/credentials.js", () => ({
  loadCredentials: vi.fn(() => ({
    authMode: "iam",
    awsAccessKeyId: "AKID",
    awsSecretAccessKey: "SECRET",
    awsSessionToken: "TOKEN",
    awsCredentialExpiry: new Date(Date.now() + 3600000).toISOString(),
  })),
  toAwsCredentialIdentity: vi.fn((creds: Record<string, string>) => ({
    accessKeyId: creds.awsAccessKeyId,
    secretAccessKey: creds.awsSecretAccessKey,
    sessionToken: creds.awsSessionToken,
  })),
}));

vi.mock("../../src/lib/auth/index.js", () => ({
  ensureValidCredentials: vi.fn((_config: unknown, creds: unknown) => creds),
}));

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockRequest = vi.fn();

vi.mock("../../src/lib/http-client.js", () => ({
  DltHttpClient: vi.fn(function () {
    return { get: mockGet, post: mockPost, request: mockRequest };
  }),
}));

import { ApiClient } from "../../src/lib/api-client.js";

describe("ApiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("creates an authenticated API client", async () => {
      mockGet.mockResolvedValue({ statusCode: 200, body: '{"ok":true}' });
      const client = await ApiClient.create();
      expect(client).toBeDefined();
    });
  });

  describe("get", () => {
    it("makes a GET request and returns parsed JSON", async () => {
      mockGet.mockResolvedValue({
        statusCode: 200,
        body: '{"items":[1,2,3]}',
      });

      const client = await ApiClient.create();
      const result = await client.get<{ items: number[] }>("/test");
      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it("throws on non-200 status", async () => {
      mockGet.mockResolvedValue({
        statusCode: 500,
        body: "Internal Server Error",
      });

      const client = await ApiClient.create();
      await expect(client.get("/test")).rejects.toThrow("API returned HTTP 500");
    });

    it("includes session-expiry hint for 403", async () => {
      mockGet.mockResolvedValue({
        statusCode: 403,
        body: "Forbidden",
      });

      const client = await ApiClient.create();
      await expect(client.get("/test")).rejects.toThrow('try running "dlt login" again');
    });
  });

  describe("post", () => {
    it("makes a POST request and returns parsed JSON", async () => {
      mockPost.mockResolvedValue({
        statusCode: 200,
        body: '{"created":true}',
      });

      const client = await ApiClient.create();
      const result = await client.post<{ created: boolean }>("/test", {
        data: "hello",
      });
      expect(result).toEqual({ created: true });
    });

    it("throws on non-200 status", async () => {
      mockPost.mockResolvedValue({
        statusCode: 400,
        body: "Bad Request",
      });

      const client = await ApiClient.create();
      await expect(client.post("/test", { data: "hello" })).rejects.toThrow("API returned HTTP 400");
    });

    it("treats a 201 Created as success", async () => {
      mockPost.mockResolvedValue({ statusCode: 201, body: '{"created":true}' });

      const client = await ApiClient.create();
      const result = await client.post<{ created: boolean }>("/test", { data: "x" });
      expect(result).toEqual({ created: true });
    });

    it("treats a 202 Accepted as success", async () => {
      mockPost.mockResolvedValue({ statusCode: 202, body: '{"accepted":true}' });

      const client = await ApiClient.create();
      const result = await client.post<{ accepted: boolean }>("/test", { data: "x" });
      expect(result).toEqual({ accepted: true });
    });
  });

  describe("2xx and empty-body handling", () => {
    it("returns an empty object for a 204 No Content response", async () => {
      mockRequest.mockResolvedValue({ statusCode: 204, body: "" });

      const client = await ApiClient.create();
      const result = await client.delete("/scenarios/abc");
      expect(result).toEqual({});
    });

    it("returns an empty object for a 200 with a whitespace-only body", async () => {
      mockGet.mockResolvedValue({ statusCode: 200, body: "   \n  " });

      const client = await ApiClient.create();
      const result = await client.get("/test");
      expect(result).toEqual({});
    });

    it("lets a caller safely read a field off an empty write response", async () => {
      // A write that indexes into the result (e.g. cancel reads result.status)
      // must not throw when the body is empty — the field reads as undefined.
      mockPost.mockResolvedValue({ statusCode: 204, body: "" });

      const client = await ApiClient.create();
      const result = await client.post<Record<string, unknown>>("/scenarios/abc", {});
      expect(() => (result as Record<string, unknown>)["status"]).not.toThrow();
      expect((result as Record<string, unknown>)["status"]).toBeUndefined();
    });

    it("throws a clear error for a non-JSON success body", async () => {
      mockGet.mockResolvedValue({ statusCode: 200, body: "<html>not json</html>" });

      const client = await ApiClient.create();
      await expect(client.get("/test")).rejects.toThrow("non-JSON response");
    });

    it("does not leak the 403 hint on a non-403 non-2xx status", async () => {
      mockGet.mockResolvedValue({ statusCode: 500, body: "boom" });

      const client = await ApiClient.create();
      await expect(client.get("/test")).rejects.not.toThrow('dlt login" again');
    });
  });

  describe("delete", () => {
    it("makes a DELETE request and returns parsed JSON", async () => {
      mockRequest.mockResolvedValue({
        statusCode: 200,
        body: '{"deleted":true}',
      });

      const client = await ApiClient.create();
      const result = await client.delete<{ deleted: boolean }>("/scenarios/abc");
      expect(result).toEqual({ deleted: true });
      expect(mockRequest).toHaveBeenCalledWith({
        url: "https://api.example.com/prod/scenarios/abc",
        method: "DELETE",
      });
    });

    it("throws on non-200 status", async () => {
      mockRequest.mockResolvedValue({
        statusCode: 404,
        body: "Not Found",
      });

      const client = await ApiClient.create();
      await expect(client.delete("/scenarios/nonexistent")).rejects.toThrow("API returned HTTP 404");
    });

    it("includes session-expiry hint for 403", async () => {
      mockRequest.mockResolvedValue({
        statusCode: 403,
        body: "Forbidden",
      });

      const client = await ApiClient.create();
      await expect(client.delete("/scenarios/abc")).rejects.toThrow('try running "dlt login" again');
    });
  });

  describe("put", () => {
    it("makes a PUT request and returns parsed JSON", async () => {
      mockRequest.mockResolvedValue({
        statusCode: 200,
        body: '{"updated":true}',
      });

      const client = await ApiClient.create();
      const result = await client.put<{ updated: boolean }>("/scenarios/abc/baseline", { testRunId: "run1" });
      expect(result).toEqual({ updated: true });
      expect(mockRequest).toHaveBeenCalledWith({
        url: "https://api.example.com/prod/scenarios/abc/baseline",
        method: "PUT",
        body: '{"testRunId":"run1"}',
      });
    });

    it("throws on non-200 status", async () => {
      mockRequest.mockResolvedValue({
        statusCode: 500,
        body: "Internal Server Error",
      });

      const client = await ApiClient.create();
      await expect(client.put("/test", { data: "hello" })).rejects.toThrow("API returned HTTP 500");
    });
  });
});
