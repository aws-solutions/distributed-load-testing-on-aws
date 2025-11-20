// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import https from "https";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IAMHttpClient } from "../../src/lib/http-client.js";

vi.mock("https");

// Mock aws4 with factory function
vi.mock("aws4", () => {
  const mockSign = vi.fn();
  return {
    default: {
      sign: mockSign,
    },
    sign: mockSign,
  };
});

// Import aws4 to get the mocked version
import * as aws4 from "aws4";

describe("IAMHttpClient", () => {
  let client: IAMHttpClient;
  const mockRegion = "us-east-1";
  const mockCorrelationId = "test-correlation-id";

  beforeEach(() => {
    vi.clearAllMocks();
    client = new IAMHttpClient(mockRegion, mockCorrelationId);
  });

  describe("request", () => {
    it("should make a successful GET request with IAM signing", async () => {
      const mockResponse = {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        on: vi.fn((event, handler) => {
          if (event === "data") {
            handler('{"result":"success"}');
          } else if (event === "end") {
            handler();
          }
        }),
      };

      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };

      vi.mocked(https.request).mockImplementation(((options: any, callback: any) => {
        if (callback) callback(mockResponse as any);
        return mockRequest as any;
      }) as any);

      vi.mocked(aws4.sign).mockReturnValue({} as any);

      const result = await client.request({
        method: "GET",
        url: "https://api.example.com/test",
      });

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('{"result":"success"}');
      expect(result.headers).toEqual({ "content-type": "application/json" });
      expect(aws4.sign).toHaveBeenCalled();
    });

    it("should include correlation ID and user agent headers", async () => {
      const mockResponse = {
        statusCode: 200,
        headers: {},
        on: vi.fn((event, handler) => {
          if (event === "data") handler("");
          else if (event === "end") handler();
        }),
      };

      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };

      let capturedOptions: any;
      vi.mocked(https.request).mockImplementation(((options: any, callback: any) => {
        capturedOptions = options;
        if (callback) callback(mockResponse as any);
        return mockRequest as any;
      }) as any);

      vi.mocked(aws4.sign).mockImplementation((opts: any) => opts as any);

      await client.request({
        method: "GET",
        url: "https://api.example.com/test",
      });

      expect(capturedOptions.headers["X-Correlation-Id"]).toBe(mockCorrelationId);
      expect(capturedOptions.headers["User-Agent"]).toBe("dlt-mcp-server");
    });

    it("should include custom headers", async () => {
      const mockResponse = {
        statusCode: 200,
        headers: {},
        on: vi.fn((event, handler) => {
          if (event === "data") handler("");
          else if (event === "end") handler();
        }),
      };

      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };

      let capturedOptions: any;
      vi.mocked(https.request).mockImplementation(((options: any, callback: any) => {
        capturedOptions = options;
        if (callback) callback(mockResponse as any);
        return mockRequest as any;
      }) as any);

      vi.mocked(aws4.sign).mockImplementation((opts: any) => opts as any);

      await client.request({
        method: "GET",
        url: "https://api.example.com/test",
        headers: { "X-Custom-Header": "custom-value" },
      });

      expect(capturedOptions.headers["X-Custom-Header"]).toBe("custom-value");
    });

    it("should handle request body", async () => {
      const mockResponse = {
        statusCode: 200,
        headers: {},
        on: vi.fn((event, handler) => {
          if (event === "data") handler("");
          else if (event === "end") handler();
        }),
      };

      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };

      vi.mocked(https.request).mockImplementation(((options: any, callback: any) => {
        if (callback) callback(mockResponse as any);
        return mockRequest as any;
      }) as any);

      vi.mocked(aws4.sign).mockReturnValue({} as any);

      const requestBody = '{"test":"data"}';
      await client.request({
        method: "POST",
        url: "https://api.example.com/test",
        body: requestBody,
      });

      expect(mockRequest.write).toHaveBeenCalledWith(requestBody);
    });

    it("should handle HTTP request errors", async () => {
      const mockRequest = {
        on: vi.fn((event, handler) => {
          if (event === "error") {
            handler(new Error("Network error"));
          }
        }),
        write: vi.fn(),
        end: vi.fn(),
      };

      vi.mocked(https.request).mockReturnValue(mockRequest as any);
      vi.mocked(aws4.sign).mockReturnValue({} as any);

      await expect(
        client.request({
          method: "GET",
          url: "https://api.example.com/test",
        })
      ).rejects.toThrow("HTTP request failed: Network error");
    });

    it("should handle URL parsing errors", async () => {
      await expect(
        client.request({
          method: "GET",
          url: "invalid-url",
        })
      ).rejects.toThrow("Failed to make signed request");
    });

    it("should set service and region for IAM signing", async () => {
      const mockResponse = {
        statusCode: 200,
        headers: {},
        on: vi.fn((event, handler) => {
          if (event === "data") handler("");
          else if (event === "end") handler();
        }),
      };

      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };

      let capturedOptions: any;
      vi.mocked(https.request).mockImplementation(((options: any, callback: any) => {
        if (callback) callback(mockResponse as any);
        return mockRequest as any;
      }) as any);

      vi.mocked(aws4.sign).mockImplementation((opts: any) => {
        capturedOptions = opts;
        return opts as any;
      });

      await client.request({
        method: "GET",
        url: "https://api.example.com/test",
      });

      expect(capturedOptions.service).toBe("execute-api");
      expect(capturedOptions.region).toBe(mockRegion);
    });
  });

  describe("get", () => {
    it("should make a GET request", async () => {
      const mockResponse = {
        statusCode: 200,
        headers: {},
        on: vi.fn((event, handler) => {
          if (event === "data") handler('{"data":"test"}');
          else if (event === "end") handler();
        }),
      };

      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };

      vi.mocked(https.request).mockImplementation(((options: any, callback: any) => {
        if (callback) callback(mockResponse as any);
        return mockRequest as any;
      }) as any);

      vi.mocked(aws4.sign).mockReturnValue({} as any);

      const result = await client.get("https://api.example.com/test");

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('{"data":"test"}');
    });

    it("should pass custom headers to GET request", async () => {
      const mockResponse = {
        statusCode: 200,
        headers: {},
        on: vi.fn((event, handler) => {
          if (event === "data") handler("");
          else if (event === "end") handler();
        }),
      };

      const mockRequest = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };

      let capturedOptions: any;
      vi.mocked(https.request).mockImplementation(((options: any, callback: any) => {
        capturedOptions = options;
        if (callback) callback(mockResponse as any);
        return mockRequest as any;
      }) as any);

      vi.mocked(aws4.sign).mockImplementation((opts: any) => opts as any);

      await client.get("https://api.example.com/test", {
        "X-Test-Header": "test-value",
      });

      expect(capturedOptions.headers["X-Test-Header"]).toBe("test-value");
    });
  });
});
