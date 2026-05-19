// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import * as archiver from "archiver";
import * as fs from "fs";
import * as path from "path";

const s3Client = new S3Client();
const WEB_ASSETS_DIR = path.join(__dirname, "web-assets");

interface ResourceProperties {
  UserPoolId: string;
  PoolClientId: string;
  IdentityPoolId: string;
  UserPoolDomain: string;
  ApiEndpoint: string;
  UserFilesBucket: string;
  UserFilesBucketRegion: string;
  IoTEndpoint: string;
  IoTPolicy: string;
  DestinationBucket: string;
  DestinationKey: string;
}

interface CloudFormationEvent {
  RequestType: "Create" | "Update" | "Delete";
  ResourceProperties: ResourceProperties;
  PhysicalResourceId?: string;
}

interface CloudFormationResponse {
  Status: "SUCCESS" | "FAILED";
  PhysicalResourceId: string;
  Data: Record<string, string>;
  Reason?: string;
}

// Extract aws-exports keys for cleaner mapping
const AWS_EXPORTS_KEYS = [
  "UserPoolId",
  "PoolClientId",
  "IdentityPoolId",
  "UserPoolDomain",
  "ApiEndpoint",
  "UserFilesBucket",
  "UserFilesBucketRegion",
  "IoTEndpoint",
  "IoTPolicy",
] as const;

/**
 * Recursively get all files in a directory
 * @param {string} dirPath - Directory path to scan
 * @param {string} basePath - Base path for relative path calculation
 * @returns {string[]} Array of relative file paths
 */
function getAllFiles(dirPath: string, basePath: string = dirPath): string[] {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Web assets directory not found: ${dirPath}`);
  }

  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dirPath, entry.name);
    return entry.isDirectory() ? getAllFiles(fullPath, basePath) : [path.relative(basePath, fullPath)];
  });
}

/**
 * Create ZIP buffer containing web assets and aws-exports.json
 * @param {Record<string, string>} awsExports - AWS configuration object
 * @returns {Promise<Buffer>} ZIP file as Buffer
 */
async function createZipBuffer(awsExports: Record<string, string>): Promise<Buffer> {
  const files = getAllFiles(WEB_ASSETS_DIR);
  console.log(`Found ${files.length} files for ZIP`);

  const archive = archiver.default("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];

  archive.on("data", (chunk: Buffer) => chunks.push(chunk));
  archive.append(JSON.stringify(awsExports, null, 2), { name: "aws-exports.json" });

  for (const relativePath of files) {
    if (relativePath !== "aws-exports.json") {
      archive.file(path.join(WEB_ASSETS_DIR, relativePath), { name: relativePath });
    }
  }

  await archive.finalize();
  return Buffer.concat(chunks);
}

/**
 * Upload buffer to S3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {Buffer} body - File content as Buffer
 * @returns {Promise<void>}
 */
async function uploadToS3(bucket: string, key: string, body: Buffer): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/zip",
    })
  );
  console.log(`Uploaded ZIP to s3://${bucket}/${key}`);
}

/**
 * Lambda handler for CloudFormation custom resource
 * @param {CloudFormationEvent} event - CloudFormation custom resource event
 * @returns {Promise<CloudFormationResponse>} CloudFormation response
 */
export const handler = async (event: CloudFormationEvent): Promise<CloudFormationResponse> => {
  console.log("Event:", JSON.stringify(event, null, 2));

  const { RequestType, ResourceProperties, PhysicalResourceId } = event;
  const physicalResourceId = PhysicalResourceId || `web-console-zip-${Date.now()}`;

  try {
    if (RequestType === "Delete") {
      return { Status: "SUCCESS", PhysicalResourceId: physicalResourceId, Data: {} };
    }

    // Build aws-exports from resource properties
    const awsExports = Object.fromEntries(AWS_EXPORTS_KEYS.map((key) => [key, ResourceProperties[key]]));

    const zipBuffer = await createZipBuffer(awsExports);
    console.log(`Created ZIP: ${zipBuffer.length} bytes`);

    await uploadToS3(ResourceProperties.DestinationBucket, ResourceProperties.DestinationKey, zipBuffer);

    return {
      Status: "SUCCESS",
      PhysicalResourceId: physicalResourceId,
      Data: { ZipLocation: `s3://${ResourceProperties.DestinationBucket}/${ResourceProperties.DestinationKey}` },
    };
  } catch (error: unknown) {
    console.error("Error:", error);
    return {
      Status: "FAILED",
      Reason: error instanceof Error ? error.message : String(error),
      PhysicalResourceId: physicalResourceId,
      Data: {},
    };
  }
};
