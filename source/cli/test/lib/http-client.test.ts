// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// Create mock request/response helpers
function createMockResponse(statusCode: number, body: string, headers: Record<string, string> = {}) {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    headers: Record<string, string>;
  };
  res.statusCode = statusCode;
  res.headers = headers;
  return {
    res,
    emit: () => {
      process.nextTick(() => {
        res.emit("data", Buffer.from(body));
        res.emit("end");
      });
    },
  };
}

const mockRequest = vi.fn();

vi.mock("node:https", () => ({
  default: {
    request: (...args: unknown[]) => mockRequest(...args),
  },
}));

vi.mock("aws4", () => ({
  default: {
    sign: (opts: Record<string, unknown>) => opts,
  },
}));

import { DltHttpClient, httpsPostForm } from "../../src/lib/http-client.js";

describe("http-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const creds = {
    accessKeyId: "AKID",
    secretAccessKey: "SECRET",
    sessionToken: "TOKEN",
  };

  describe("DltHttpClient", () => {
    it("makes a GET request", async () => {
      const { res, emit } = createMockResponse(200, '{"ok":true}');
      const mockReq = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();

      mockRequest.mockImplementation((_opts: unknown, callback: (res: unknown) => void) => {
        process.nextTick(() => callback(res));
        emit();
        return mockReq;
      });

      const client = new DltHttpClient("us-east-1", creds);
      const result = await client.get("https://api.example.com/test");

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('{"ok":true}');
      expect(mockReq.end).toHaveBeenCalled();
    });

    it("makes a POST request with body", async () => {
      const { res, emit } = createMockResponse(200, '{"created":true}');
      const mockReq = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();

      mockRequest.mockImplementation((_opts: unknown, callback: (res: unknown) => void) => {
        process.nextTick(() => callback(res));
        emit();
        return mockReq;
      });

      const client = new DltHttpClient("us-east-1", creds);
      const result = await client.post("https://api.example.com/test", '{"data":"hello"}');

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('{"created":true}');
      expect(mockReq.write).toHaveBeenCalledWith('{"data":"hello"}');
    });

    it("rejects on request error", async () => {
      const mockReq = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();

      mockRequest.mockImplementation(() => {
        process.nextTick(() => mockReq.emit("error", new Error("connection refused")));
        return mockReq;
      });

      const client = new DltHttpClient("us-east-1", creds);
      await expect(client.get("https://api.example.com/test")).rejects.toThrow("connection refused");
    });

    it("handles custom headers in GET", async () => {
      const { res, emit } = createMockResponse(200, "ok");
      const mockReq = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();

      mockRequest.mockImplementation((_opts: unknown, callback: (res: unknown) => void) => {
        process.nextTick(() => callback(res));
        emit();
        return mockReq;
      });

      const client = new DltHttpClient("us-east-1", creds);
      const result = await client.get("https://api.example.com/test", {
        "X-Custom": "value",
      });

      expect(result.statusCode).toBe(200);
    });

    it("includes OS info in User-Agent header", async () => {
      const { res, emit } = createMockResponse(200, "ok");
      const mockReq = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();

      mockRequest.mockImplementation((_opts: unknown, callback: (res: unknown) => void) => {
        process.nextTick(() => callback(res));
        emit();
        return mockReq;
      });

      const client = new DltHttpClient("us-east-1", creds);
      await client.get("https://api.example.com/test");

      const requestOpts = mockRequest.mock.calls[0][0] as { headers: Record<string, string> };
      const ua = requestOpts.headers["User-Agent"];
      expect(ua).toMatch(/^dlt-cli\/.+ \(.+ .+; .+\)$/);
    });

    it("uses request() method directly", async () => {
      const { res, emit } = createMockResponse(204, "");
      const mockReq = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();

      mockRequest.mockImplementation((_opts: unknown, callback: (res: unknown) => void) => {
        process.nextTick(() => callback(res));
        emit();
        return mockReq;
      });

      const client = new DltHttpClient("us-east-1", creds);
      const result = await client.request({
        url: "https://api.example.com/test?foo=bar",
      });

      expect(result.statusCode).toBe(204);
    });
  });

  describe("httpsPostForm", () => {
    it("sends a form-encoded POST request", async () => {
      const { res, emit } = createMockResponse(200, '{"token":"abc"}');
      const mockReq = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();

      mockRequest.mockImplementation((_opts: unknown, callback: (res: unknown) => void) => {
        process.nextTick(() => callback(res));
        emit();
        return mockReq;
      });

      const result = await httpsPostForm(
        "https://auth.example.com/oauth2/token",
        "grant_type=authorization_code&code=abc"
      );

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('{"token":"abc"}');
      expect(mockReq.write).toHaveBeenCalledWith("grant_type=authorization_code&code=abc");
    });

    it("rejects on request error", async () => {
      const mockReq = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
      };
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();

      mockRequest.mockImplementation(() => {
        process.nextTick(() => mockReq.emit("error", new Error("timeout")));
        return mockReq;
      });

      await expect(httpsPostForm("https://auth.example.com/token", "body")).rejects.toThrow("timeout");
    });
  });
});
