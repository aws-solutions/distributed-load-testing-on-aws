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

vi.mock("../../src/lib/http-client.js", () => ({
  DltHttpClient: vi.fn(function () {
    return { get: mockGet, post: mockPost };
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
  });
});
