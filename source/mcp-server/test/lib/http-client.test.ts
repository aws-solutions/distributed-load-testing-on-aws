// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ClientRequest, IncomingMessage } from "http";
import https from "https";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IAMHttpClient } from "../../src/lib/http-client.js";

vi.mock("https");
vi.mock("aws4", () => ({
  default: { sign: vi.fn() },
  sign: vi.fn(),
}));

import * as aws4 from "aws4";

describe("IAMHttpClient", () => {
  let client: IAMHttpClient;
  const mockRegion = "us-east-1";
  const mockCorrelationId = "test-correlation-id";

  // Helper to create a mock request that resolves successfully
  function setupSuccessfulRequest(responseBody = "{}", statusCode = 200): void {
    vi.mocked(https.request).mockImplementation(((_opts: unknown, callback?: unknown) => {
      const mockReq = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };

      // Simulate async response after req.end() is called
      setImmediate(() => {
        const mockRes = {
          statusCode,
          headers: { "content-type": "application/json" },
          on: vi.fn((event: string, handler: (data?: string) => void) => {
            if (event === "data")
              setImmediate(() => {
                handler(responseBody);
              });
            if (event === "end")
              setImmediate(() => {
                handler();
              });
          }),
        };
        const cb = callback as ((res: IncomingMessage) => void) | undefined;
        if (cb) {
          cb(mockRes as unknown as IncomingMessage);
        }
      });

      return mockReq as unknown as ClientRequest;
    }) as typeof https.request);

    vi.mocked(aws4.sign).mockReturnValue({} as aws4.Request);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    client = new IAMHttpClient(mockRegion, mockCorrelationId);
  });

  describe("request preparation", () => {
    it("should call aws4.sign with correct service and region", async () => {
      setupSuccessfulRequest();
      let capturedOptions: aws4.Request | undefined;

      vi.mocked(aws4.sign).mockImplementation((opts: unknown) => {
        capturedOptions = opts as aws4.Request;
        return opts as aws4.Request;
      });

      await client.request({
        method: "GET",
        url: "https://api.example.com/test",
      });

      expect(capturedOptions?.service).toBe("execute-api");
      expect(capturedOptions?.region).toBe(mockRegion);
      expect(capturedOptions?.hostname).toBe("api.example.com");
      expect(capturedOptions?.path).toBe("/test");
      expect(capturedOptions?.method).toBe("GET");
    });

    it("should include correlation ID header", async () => {
      setupSuccessfulRequest();
      let capturedOptions: aws4.Request | undefined;

      vi.mocked(aws4.sign).mockImplementation((opts: unknown) => {
        capturedOptions = opts as aws4.Request;
        return opts as aws4.Request;
      });

      await client.request({
        method: "GET",
        url: "https://api.example.com/test",
      });

      expect(capturedOptions?.headers?.["X-Correlation-Id"]).toBe(mockCorrelationId);
      expect(capturedOptions?.headers?.["User-Agent"]).toBe("dlt-mcp-server");
      expect(capturedOptions?.headers?.["Content-Type"]).toBe("application/json");
    });

    it("should include custom headers", async () => {
      setupSuccessfulRequest();
      let capturedOptions: aws4.Request | undefined;

      vi.mocked(aws4.sign).mockImplementation((opts: unknown) => {
        capturedOptions = opts as aws4.Request;
        return opts as aws4.Request;
      });

      await client.request({
        method: "GET",
        url: "https://api.example.com/test",
        headers: { "X-Custom-Header": "custom-value" },
      });

      expect(capturedOptions?.headers?.["X-Custom-Header"]).toBe("custom-value");
    });

    it("should include request body in options when provided", async () => {
      setupSuccessfulRequest();
      let capturedOptions: aws4.Request | undefined;

      vi.mocked(aws4.sign).mockImplementation((opts: unknown) => {
        capturedOptions = opts as aws4.Request;
        return opts as aws4.Request;
      });

      const requestBody = '{"test":"data"}';
      await client.request({
        method: "POST",
        url: "https://api.example.com/test",
        body: requestBody,
      });

      expect(capturedOptions?.body).toBe(requestBody);
    });

    it("should parse URL with query parameters correctly", async () => {
      setupSuccessfulRequest();
      let capturedOptions: aws4.Request | undefined;

      vi.mocked(aws4.sign).mockImplementation((opts: unknown) => {
        capturedOptions = opts as aws4.Request;
        return opts as aws4.Request;
      });

      await client.request({
        method: "GET",
        url: "https://api.example.com/test?param1=value1&param2=value2",
      });

      expect(capturedOptions?.hostname).toBe("api.example.com");
      expect(capturedOptions?.path).toBe("/test?param1=value1&param2=value2");
    });
  });

  describe("request execution", () => {
    it("should return successful response", async () => {
      setupSuccessfulRequest('{"result":"success"}', 200);

      const result = await client.request({
        method: "GET",
        url: "https://api.example.com/test",
      });

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('{"result":"success"}');
      expect(result.headers).toBeDefined();
    });

    it("should write body to request when provided", async () => {
      let mockReq:
        | { on: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
        | undefined;

      vi.mocked(https.request).mockImplementation(((_opts: unknown, callback?: unknown) => {
        mockReq = {
          on: vi.fn(),
          write: vi.fn(),
          end: vi.fn(),
        };

        setImmediate(() => {
          const mockRes = {
            statusCode: 200,
            headers: {},
            on: vi.fn((event: string, handler: () => void) => {
              if (event === "end")
                setImmediate(() => {
                  handler();
                });
            }),
          };
          const cb = callback as ((res: IncomingMessage) => void) | undefined;
          if (cb) {
            cb(mockRes as unknown as IncomingMessage);
          }
        });

        return mockReq as unknown as ClientRequest;
      }) as typeof https.request);

      vi.mocked(aws4.sign).mockReturnValue({} as aws4.Request);

      const requestBody = '{"test":"data"}';
      await client.request({
        method: "POST",
        url: "https://api.example.com/test",
        body: requestBody,
      });

      expect(mockReq?.write).toHaveBeenCalledWith(requestBody);
    });
  });

  describe("error handling", () => {
    it("should reject on invalid URL", async () => {
      await expect(
        client.request({
          method: "GET",
          url: "invalid-url",
        })
      ).rejects.toThrow("Failed to make signed request");
    });

    it("should wrap network errors with descriptive message", async () => {
      vi.mocked(https.request).mockImplementation(() => {
        const mockReq = {
          on: vi.fn((event: string, handler: (error: Error) => void) => {
            if (event === "error") {
              setImmediate(() => {
                handler(new Error("Network error"));
              });
            }
          }),
          write: vi.fn(),
          end: vi.fn(),
        };
        return mockReq as unknown as ClientRequest;
      });

      vi.mocked(aws4.sign).mockReturnValue({} as aws4.Request);

      await expect(
        client.request({
          method: "GET",
          url: "https://api.example.com/test",
        })
      ).rejects.toThrow("HTTP request failed: Network error");
    });
  });

  describe("get method", () => {
    it("should make a GET request with provided URL", async () => {
      setupSuccessfulRequest('{"data":"test"}', 200);
      let capturedOptions: aws4.Request | undefined;

      vi.mocked(aws4.sign).mockImplementation((opts: unknown) => {
        capturedOptions = opts as aws4.Request;
        return opts as aws4.Request;
      });

      const result = await client.get("https://api.example.com/test");

      expect(capturedOptions?.method).toBe("GET");
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('{"data":"test"}');
    });

    it("should pass custom headers to underlying request", async () => {
      setupSuccessfulRequest();
      let capturedOptions: aws4.Request | undefined;

      vi.mocked(aws4.sign).mockImplementation((opts: unknown) => {
        capturedOptions = opts as aws4.Request;
        return opts as aws4.Request;
      });

      await client.get("https://api.example.com/test", {
        "X-Test-Header": "test-value",
      });

      expect(capturedOptions?.headers?.["X-Test-Header"]).toBe("test-value");
    });
  });
});
