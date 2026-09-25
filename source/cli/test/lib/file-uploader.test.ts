// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(function () {
    return { send: mockSend };
  }),
  PutObjectCommand: vi.fn(function (input: unknown) {
    return { input };
  }),
  CopyObjectCommand: vi.fn(function (input: unknown) {
    return { input };
  }),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(() => Buffer.from("file content")),
}));

import {
  uploadTestFile,
  assertScriptFileMatchesTestType,
  copyScriptObject,
  copyScenarioScript,
} from "../../src/lib/file-uploader.js";
import { existsSync, statSync } from "node:fs";
import { PutObjectCommand, CopyObjectCommand, S3Client } from "@aws-sdk/client-s3";

const fakeCreds = {
  accessKeyId: "AKID",
  secretAccessKey: "SECRET",
  sessionToken: "TOKEN",
};

function createMockApi(config?: Partial<{ scenariosBucket: string | undefined; region: string }>) {
  return {
    config: { scenariosBucket: "my-bucket", region: "us-east-1", ...config },
    awsCredentialIdentity: fakeCreds,
  } as any;
}

describe("file-uploader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("uploadTestFile", () => {
    it("throws when scenariosBucket is not configured", async () => {
      const api = createMockApi({ scenariosBucket: undefined });

      await expect(
        uploadTestFile(api, { filePath: "/tmp/test.jmx", testId: "abc123", testType: "jmeter" })
      ).rejects.toThrow("Scenarios bucket not configured. Run `dlt configure` with --scenarios-bucket");
    });

    it("throws when file does not exist", async () => {
      const api = createMockApi();
      vi.mocked(existsSync).mockReturnValue(false);

      await expect(
        uploadTestFile(api, { filePath: "/tmp/nonexistent.jmx", testId: "abc123", testType: "jmeter" })
      ).rejects.toThrow("File not found: /tmp/nonexistent.jmx");
    });

    it("throws when file exceeds 50MB", async () => {
      const api = createMockApi();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ size: 51 * 1024 * 1024 } as any);

      await expect(
        uploadTestFile(api, { filePath: "/tmp/large.jmx", testId: "abc123", testType: "jmeter" })
      ).rejects.toThrow("Error: File exceeds 50MB limit");
    });

    it("uploads a script file and returns correct key and fileType", async () => {
      const api = createMockApi();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ size: 1024 } as any);
      mockSend.mockResolvedValue({});

      const result = await uploadTestFile(api, {
        filePath: "/tmp/test.jmx",
        testId: "abc123",
        testType: "jmeter",
      });

      expect(result.key).toBe("public/test-scenarios/jmeter/abc123.jmx");
      expect(result.fileType).toBe("script");
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("uploads a zip file and returns fileType zip", async () => {
      const api = createMockApi();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ size: 2048 } as any);
      mockSend.mockResolvedValue({});

      const result = await uploadTestFile(api, {
        filePath: "/tmp/test.zip",
        testId: "def456",
        testType: "k6",
      });

      expect(result.key).toBe("public/test-scenarios/k6/def456.zip");
      expect(result.fileType).toBe("zip");
    });

    it("constructs S3 key with correct test type and extension", async () => {
      const api = createMockApi();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ size: 512 } as any);
      mockSend.mockResolvedValue({});

      const result = await uploadTestFile(api, {
        filePath: "/home/user/scripts/load-test.py",
        testId: "ghi789",
        testType: "locust",
      });

      expect(result.key).toBe("public/test-scenarios/locust/ghi789.py");
      expect(result.fileType).toBe("script");
    });

    it("allows file exactly at 50MB limit", async () => {
      const api = createMockApi();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ size: 50 * 1024 * 1024 } as any);
      mockSend.mockResolvedValue({});

      const result = await uploadTestFile(api, {
        filePath: "/tmp/exactly50mb.js",
        testId: "exact50",
        testType: "k6",
      });

      expect(result.key).toBe("public/test-scenarios/k6/exact50.js");
      expect(result.fileType).toBe("script");
    });

    it("propagates S3 upload errors", async () => {
      const api = createMockApi();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ size: 1024 } as any);
      mockSend.mockRejectedValue(new Error("AccessDenied: Access Denied"));

      await expect(
        uploadTestFile(api, { filePath: "/tmp/test.jmx", testId: "abc123", testType: "jmeter" })
      ).rejects.toThrow("AccessDenied: Access Denied");
    });

    it("sets correct ContentType for known extensions", async () => {
      const api = createMockApi();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ size: 1024 } as any);
      mockSend.mockResolvedValue({});

      await uploadTestFile(api, { filePath: "/tmp/test.jmx", testId: "abc", testType: "jmeter" });

      const cmd = vi.mocked(PutObjectCommand).mock.calls[0]![0] as any;
      expect(cmd.ContentType).toBe("application/xml");
    });

    it("uploads a Buffer body so the SDK can safely retry the upload", async () => {
      const api = createMockApi();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ size: 1024 } as any);
      mockSend.mockResolvedValue({});

      await uploadTestFile(api, { filePath: "/tmp/test.jmx", testId: "abc", testType: "jmeter" });

      const cmd = vi.mocked(PutObjectCommand).mock.calls[0]![0] as any;
      // A Buffer is replayable across SDK retries; a consumed stream would not be.
      expect(Buffer.isBuffer(cmd.Body)).toBe(true);
    });

    it("sets ContentType application/typescript for k6 .ts scripts", async () => {
      const api = createMockApi();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ size: 1024 } as any);
      mockSend.mockResolvedValue({});

      const result = await uploadTestFile(api, { filePath: "/tmp/test.ts", testId: "k6ts", testType: "k6" });

      const cmd = vi.mocked(PutObjectCommand).mock.calls[0]![0] as any;
      expect(cmd.ContentType).toBe("application/typescript");
      expect(result.key).toBe("public/test-scenarios/k6/k6ts.ts");
      expect(result.fileType).toBe("script");
    });

    it("accepts an injected S3 client", async () => {
      const api = createMockApi();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(statSync).mockReturnValue({ size: 1024 } as any);

      const customSend = vi.fn().mockResolvedValue({});
      const customClient = { send: customSend } as unknown as InstanceType<typeof S3Client>;

      const result = await uploadTestFile(
        api,
        { filePath: "/tmp/test.js", testId: "inj1", testType: "k6" },
        customClient
      );

      expect(result.key).toBe("public/test-scenarios/k6/inj1.js");
      expect(customSend).toHaveBeenCalledTimes(1);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("copyScriptObject", () => {
    it("issues a CopyObject within the scenarios bucket", async () => {
      const send = vi.fn().mockResolvedValue({});
      const api = createMockApi();
      await copyScriptObject(
        api,
        "public/test-scenarios/jmeter/old123.jmx",
        "public/test-scenarios/jmeter/new456.jmx",
        { send } as unknown as InstanceType<typeof S3Client>
      );

      expect(send).toHaveBeenCalledTimes(1);
      const cmd = vi.mocked(CopyObjectCommand).mock.calls[0]![0] as any;
      expect(cmd.Bucket).toBe("my-bucket");
      expect(cmd.CopySource).toBe("my-bucket/public/test-scenarios/jmeter/old123.jmx");
      expect(cmd.Key).toBe("public/test-scenarios/jmeter/new456.jmx");
    });

    it("throws when the scenarios bucket is not configured", async () => {
      const api = createMockApi({ scenariosBucket: undefined });
      await expect(copyScriptObject(api, "a", "b", { send: vi.fn() } as any)).rejects.toThrow(
        "Scenarios bucket not configured"
      );
    });
  });

  describe("copyScenarioScript", () => {
    it("copies the script to the new testId's key and returns the new filename", async () => {
      mockSend.mockResolvedValue({});
      const api = createMockApi();

      const newName = await copyScenarioScript(api, {
        testType: "jmeter",
        fromTestId: "old123",
        toTestId: "new456",
        scriptFileName: "old123.jmx",
        copyObject: true,
      });

      expect(newName).toBe("new456.jmx");
      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = vi.mocked(CopyObjectCommand).mock.calls[0]![0] as any;
      expect(cmd.CopySource).toBe("my-bucket/public/test-scenarios/jmeter/old123.jmx");
      expect(cmd.Key).toBe("public/test-scenarios/jmeter/new456.jmx");
    });

    it("computes the new filename without copying when copyObject is false", async () => {
      const api = createMockApi();

      const newName = await copyScenarioScript(api, {
        testType: "jmeter",
        fromTestId: "old123",
        toTestId: "new456",
        scriptFileName: "old123.jmx",
        copyObject: false,
      });

      expect(newName).toBe("new456.jmx");
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe("assertScriptFileMatchesTestType", () => {
    it("accepts each framework's own script extensions", () => {
      expect(() => assertScriptFileMatchesTestType("jmeter", "plan.jmx")).not.toThrow();
      expect(() => assertScriptFileMatchesTestType("k6", "script.js")).not.toThrow();
      expect(() => assertScriptFileMatchesTestType("k6", "script.ts")).not.toThrow();
      expect(() => assertScriptFileMatchesTestType("locust", "locustfile.py")).not.toThrow();
    });

    it("accepts a .zip for any framework", () => {
      expect(() => assertScriptFileMatchesTestType("jmeter", "bundle.zip")).not.toThrow();
      expect(() => assertScriptFileMatchesTestType("locust", "bundle.zip")).not.toThrow();
    });

    it("rejects an extension that belongs to a different framework", () => {
      expect(() => assertScriptFileMatchesTestType("k6", "locustfile.py")).toThrow(/--file for a k6 test/);
      expect(() => assertScriptFileMatchesTestType("jmeter", "script.js")).toThrow(/--file for a jmeter test/);
    });

    it("rejects a file with no extension", () => {
      expect(() => assertScriptFileMatchesTestType("locust", "Makefile")).toThrow(/no extension/);
    });

    it("skips validation for non-framework (simple) test types", () => {
      expect(() => assertScriptFileMatchesTestType("simple", "whatever.txt")).not.toThrow();
    });
  });
});
