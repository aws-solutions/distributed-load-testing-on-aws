// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCoreEvent } from "../../src/lib/common.js";
import { AppError } from "../../src/lib/errors.js";
import { handleUploadTestScript } from "../../src/tools/upload-test-script.js";
import {
  createMockHttpClient,
  type MockHttpClient,
} from "../test-utils.js";

// Mock S3Client — upload-test-script calls S3 PutObject directly, not the HTTP client
const mockSend = vi.fn().mockResolvedValue({});
vi.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: class {
      send = mockSend;
    },
    PutObjectCommand: class {
      input: unknown;
      constructor(input: unknown) { this.input = input; }
    },
  };
});

// Mock s3-request-presigner
const mockGetSignedUrl = vi.fn().mockResolvedValue("https://s3.amazonaws.com/presigned-url");
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

// Mock config module for region and bucket name
vi.mock("../../src/lib/config.js", () => ({
  getRegion: vi.fn().mockReturnValue("us-east-1"),
  getScenariosBucket: vi.fn().mockReturnValue("test-scenarios-bucket"),
}));

// Mock crypto.randomBytes for deterministic test_id generation
vi.mock("crypto", () => ({
  randomBytes: vi.fn().mockReturnValue(Buffer.from("abcde12345", "hex")),
}));

describe("handleUploadTestScript", () => {
  let mockHttpClient: MockHttpClient;
  const apiEndpoint = "https://api.example.com";
  const validBase64Content = Buffer.from("test script content").toString("base64");

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient = createMockHttpClient();
  });

  describe("Successful requests", () => {
    // Uploads to S3 at public/test-scenarios/{test_type}/{testId}.{ext}
    it("should upload to S3 and return test_id and script_filename", async () => {
      const event: AgentCoreEvent = {
        test_type: "jmeter",
        file_extension: "jmx",
        file_content: validBase64Content,
      };

      const result = await handleUploadTestScript(mockHttpClient, apiEndpoint, event) as {
        test_id: string;
        script_filename: string;
      };

      expect(result.test_id).toBeDefined();
      expect(result.script_filename).toMatch(/\.jmx$/);
      expect(result.script_filename).toContain(result.test_id);
    });

    // When test_id is provided, it uses that instead of generating one
    it("should use provided test_id instead of generating one", async () => {
      mockHttpClient.get.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ testType: "k6" }), headers: {} });
      const event: AgentCoreEvent = {
        test_id: "existIng1d",
        test_type: "k6",
        file_extension: "js",
        file_content: validBase64Content,
      };

      const result = await handleUploadTestScript(mockHttpClient, apiEndpoint, event) as {
        test_id: string;
        script_filename: string;
      };

      expect(result.test_id).toBe("existIng1d");
      expect(result.script_filename).toBe("existIng1d.js");
    });

    // When test_id contains invalid characters, it should raise a validation error.
    it("should throw AppError when provided test_id contains invalid characters", async () => {
      const event: AgentCoreEvent = {
        test_id: "../Parent1",
        test_type: "k6",
        file_extension: "js",
        file_content: validBase64Content,
      };

      await expect(handleUploadTestScript(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
      await expect(handleUploadTestScript(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "testId must contain only alphanumeric characters and hyphens"
      );
    });

    // S3 key should include the public/ prefix for CloudFront compatibility
    it("should upload to public/test-scenarios/{type}/ path in S3", async () => {
      mockHttpClient.get.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ testType: "locust" }), headers: {} });
      const event: AgentCoreEvent = {
        test_id: "existIng1d",
        test_type: "locust",
        file_extension: "py",
        file_content: validBase64Content,
      };

      await handleUploadTestScript(mockHttpClient, apiEndpoint, event);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: "test-scenarios-bucket",
            Key: "public/test-scenarios/locust/existIng1d.py",
            Body: expect.any(Buffer) as Buffer,
          },
        })
      );
    });

  });

  describe("Presigned URL path", () => {
    // When file_content is omitted, returns a presigned URL for direct upload
    it("should return presigned URL when file_content is omitted", async () => {
      const event: AgentCoreEvent = {
        test_type: "jmeter",
        file_extension: "jmx",
      };

      const result = await handleUploadTestScript(mockHttpClient, apiEndpoint, event) as {
        test_id: string;
        script_filename: string;
        presigned_url: string;
        upload_command: string;
        expires_in: number;
      };

      expect(result.test_id).toBeDefined();
      expect(result.script_filename).toMatch(/\.jmx$/);
      expect(result.presigned_url).toBe("https://s3.amazonaws.com/presigned-url");
      expect(result.upload_command).toContain("curl -X PUT -T");
      expect(result.expires_in).toBe(900);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should return presigned URL with provided test_id", async () => {
      mockHttpClient.get.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ testType: "k6" }), headers: {} });
      const event: AgentCoreEvent = {
        test_id: "existIng1d",
        test_type: "k6",
        file_extension: "js",
      };

      const result = await handleUploadTestScript(mockHttpClient, apiEndpoint, event) as {
        test_id: string;
        script_filename: string;
        presigned_url: string;
      };

      expect(result.test_id).toBe("existIng1d");
      expect(result.script_filename).toBe("existIng1d.js");
      expect(result.presigned_url).toBeDefined();
    });

    it("should throw AppError with 500 when presigned URL generation fails", async () => {
      mockGetSignedUrl.mockRejectedValue(new Error("signing error"));

      const event: AgentCoreEvent = {
        test_type: "jmeter",
        file_extension: "jmx",
      };

      await expect(handleUploadTestScript(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
      await expect(handleUploadTestScript(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Failed to generate presigned upload URL"
      );
    });
  });

  describe("Size validation", () => {
    it("should reject file_content exceeding 25KB with actionable error", async () => {
      const oversizedContent = Buffer.alloc(26 * 1024).toString("base64");
      const event: AgentCoreEvent = {
        test_type: "jmeter",
        file_extension: "jmx",
        file_content: oversizedContent,
      };

      await expect(handleUploadTestScript(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleUploadTestScript(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("exceeds the");
        expect((error as AppError).message).toContain("Omit file_content");
      }
    });

    it("should accept file_content at exactly 25KB", async () => {
      const content = Buffer.alloc(25 * 1024).toString("base64");
      const event: AgentCoreEvent = {
        test_type: "jmeter",
        file_extension: "jmx",
        file_content: content,
      };

      const result = await handleUploadTestScript(mockHttpClient, apiEndpoint, event) as { test_id: string };
      expect(result.test_id).toBeDefined();
    });
  });

  describe("Parameter validation", () => {
    // test_type must be one of: "jmeter", "k6", "locust" (NOT "simple")
    it("should throw AppError for invalid test_type", async () => {
      const event: AgentCoreEvent = {
        test_type: "simple",
        file_extension: "jmx",
        file_content: validBase64Content,
      };

      await expect(handleUploadTestScript(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleUploadTestScript(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
      }
    });

    // file_extension must be one of: "jmx", "js", "ts", "py", "zip"
    it("should throw AppError for invalid file_extension", async () => {
      const event: AgentCoreEvent = {
        test_type: "jmeter",
        file_extension: "txt",
        file_content: validBase64Content,
      };

      await expect(handleUploadTestScript(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);

      try {
        await handleUploadTestScript(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
      }
    });
  });

  describe("Existing-test validation", () => {
    // A script must not be attachable to a simple (inline) test — that would
    // leave an orphaned object in S3 while the scenario stays a simple test.
    it("should reject uploading a script to a simple test", async () => {
      mockHttpClient.get.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ testType: "simple" }), headers: {} });
      const event: AgentCoreEvent = {
        test_id: "existIng1d",
        test_type: "k6",
        file_extension: "js",
        file_content: validBase64Content,
      };

      await expect(handleUploadTestScript(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
      try {
        await handleUploadTestScript(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("simple HTTP test");
      }
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should reject when test_type does not match the existing test's type", async () => {
      mockHttpClient.get.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ testType: "k6" }), headers: {} });
      const event: AgentCoreEvent = {
        test_id: "existIng1d",
        test_type: "locust",
        file_extension: "py",
        file_content: validBase64Content,
      };

      await expect(handleUploadTestScript(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
      try {
        await handleUploadTestScript(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(400);
        expect((error as AppError).message).toContain("does not match");
      }
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should surface a not-found error and not write to S3 when the test does not exist", async () => {
      mockHttpClient.get.mockResolvedValue({ statusCode: 404, body: "TEST_NOT_FOUND", headers: {} });
      const event: AgentCoreEvent = {
        test_id: "existIng1d",
        test_type: "k6",
        file_extension: "js",
        file_content: validBase64Content,
      };

      await expect(handleUploadTestScript(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
      try {
        await handleUploadTestScript(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(404);
      }
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should allow replacing the script on a matching existing test", async () => {
      mockHttpClient.get.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ testType: "k6" }), headers: {} });
      const event: AgentCoreEvent = {
        test_id: "existIng1d",
        test_type: "k6",
        file_extension: "js",
        file_content: validBase64Content,
      };

      const result = await handleUploadTestScript(mockHttpClient, apiEndpoint, event) as { test_id: string };
      expect(result.test_id).toBe("existIng1d");
      expect(mockSend).toHaveBeenCalled();
    });

    it("should not look up a scenario for new tests (no test_id)", async () => {
      const event: AgentCoreEvent = {
        test_type: "jmeter",
        file_extension: "jmx",
        file_content: validBase64Content,
      };

      await handleUploadTestScript(mockHttpClient, apiEndpoint, event);
      expect(mockHttpClient.get).not.toHaveBeenCalled();
    });
  });

  describe("Error handling", () => {
    // S3 PutObject failure is caught and wrapped as 500 "Failed to upload script to S3"
    it("should throw AppError with 500 when S3 upload fails", async () => {
      mockSend.mockRejectedValue(new Error("S3 access denied"));

      const event: AgentCoreEvent = {
        test_type: "jmeter",
        file_extension: "jmx",
        file_content: validBase64Content,
      };

      await expect(handleUploadTestScript(mockHttpClient, apiEndpoint, event)).rejects.toThrow(AppError);
      await expect(handleUploadTestScript(mockHttpClient, apiEndpoint, event)).rejects.toThrow(
        "Failed to upload script to S3"
      );

      try {
        await handleUploadTestScript(mockHttpClient, apiEndpoint, event);
      } catch (error) {
        expect((error as AppError).code).toBe(500);
      }
    });
  });
});
