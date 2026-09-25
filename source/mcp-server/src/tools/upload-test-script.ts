// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { VALID_FRAMEWORKS, BaseTestIdSchema, parseEventWithSchema, type AgentCoreEvent } from "../lib/common";
import { getRegion, getScenariosBucket } from "../lib/config";
import { AppError } from "../lib/errors";
import type { IHttpClient } from "../lib/http-client";
import { fetchScenario } from "../lib/scenario-helpers";

const VALID_EXTENSIONS = ["jmx", "js", "ts", "py", "zip"] as const;

const PRESIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes
const MAX_DIRECT_UPLOAD_BYTES = 25 * 1024; // 25KB decoded — practical limit for LLM-based MCP clients

export const UploadTestScriptSchema = BaseTestIdSchema.partial().extend({
  test_type: z.enum(VALID_FRAMEWORKS),
  file_extension: z.enum(VALID_EXTENSIONS),
  file_content: z.string().optional(),
});

export type UploadTestScriptParameters = z.infer<typeof UploadTestScriptSchema>;

function generateTestId(): string {
  return randomBytes(5).toString("hex");
}

/**
 * When targeting an existing test, confirm it exists and is a script-based test
 * of the matching framework before any S3 write. Otherwise upload_test_script
 * would drop an orphaned object into the bucket without touching the scenario —
 * e.g. a script "attached" to a simple (inline) test, which stays a simple test.
 */
async function assertScriptTargetMatches(
  httpClient: IHttpClient,
  apiEndpoint: string,
  testId: string,
  testType: string
): Promise<void> {
  const scenario = await fetchScenario(httpClient, apiEndpoint, testId, `Test not found: ${testId}`);
  if (scenario.testType !== testType) {
    throw new AppError(
      scenario.testType === "simple"
        ? `Test '${testId}' is a simple HTTP test — scripts cannot be attached; simple tests are configured inline.`
        : `test_type '${testType}' does not match the existing test's type '${scenario.testType ?? "unknown"}'.`,
      400
    );
  }
}

export async function handleUploadTestScript(
  httpClient: IHttpClient,
  apiEndpoint: string,
  event: AgentCoreEvent
): Promise<unknown> {
  const { test_id, test_type, file_extension, file_content } = parseEventWithSchema(UploadTestScriptSchema, event);

  // New tests (no test_id) skip the check: the id is generated here and
  // create_test links the script afterward.
  if (test_id) {
    await assertScriptTargetMatches(httpClient, apiEndpoint, test_id, test_type);
  }

  const testId = test_id || generateTestId();
  const scriptFilename = `${testId}.${file_extension}`;
  const s3Key = `public/test-scenarios/${test_type}/${scriptFilename}`;
  const bucket = getScenariosBucket();
  const s3Client = new S3Client({ region: getRegion() });

  if (file_content) {
    const fileBuffer = Buffer.from(file_content, "base64");
    if (fileBuffer.toString("base64") !== file_content) {
      throw new AppError("Invalid base64 encoding in file_content", 400);
    }

    if (fileBuffer.length > MAX_DIRECT_UPLOAD_BYTES) {
      throw new AppError(
        `File size (${fileBuffer.length} bytes) exceeds the ${MAX_DIRECT_UPLOAD_BYTES} byte limit for direct upload. Omit file_content and retry to receive a presigned upload URL instead.`,
        400
      );
    }

    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: fileBuffer,
      }));
    } catch {
      throw new AppError("Failed to upload script to S3", 500);
    }

    return {
      test_id: testId,
      script_filename: scriptFilename,
    };
  }

  // No file_content provided — return a presigned URL for the agent or user to upload directly
  const command = new PutObjectCommand({ Bucket: bucket, Key: s3Key });
  let presignedUrl: string;
  try {
    presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRY_SECONDS });
  } catch {
    throw new AppError("Failed to generate presigned upload URL", 500);
  }

  return {
    test_id: testId,
    script_filename: scriptFilename,
    presigned_url: presignedUrl,
    upload_command: `curl -X PUT -T <LOCAL_FILE_PATH> '${presignedUrl}'`,
    expires_in: PRESIGNED_URL_EXPIRY_SECONDS,
  };
}
