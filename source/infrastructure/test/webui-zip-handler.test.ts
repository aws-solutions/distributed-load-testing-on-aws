// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn((input) => ({ input })),
}));

// Mock fs — existsSync returns false so getAllFiles throws (web-assets directory not present in test env)
jest.mock("fs", () => ({
  existsSync: jest.fn(() => false),
  readdirSync: jest.fn(() => []),
}));

jest.mock("archiver", () => ({
  default: jest.fn(() => ({
    on: jest.fn(),
    append: jest.fn(),
    file: jest.fn(),
    finalize: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { handler } from "../lambda/webui-zip-handler/index";

const baseProps = {
  UserPoolId: "us-east-1_abc",
  PoolClientId: "client-123",
  IdentityPoolId: "us-east-1:pool-123",
  UserPoolDomain: "domain.auth.us-east-1.amazoncognito.com",
  ApiEndpoint: "https://api.example.com",
  UserFilesBucket: "files-bucket",
  UserFilesBucketRegion: "us-east-1",
  IoTEndpoint: "iot.us-east-1.amazonaws.com",
  IoTPolicy: "iot-policy",
  DestinationBucket: "dest-bucket",
  DestinationKey: "web-console.zip",
};

describe("webui-zip-handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it("returns SUCCESS immediately for Delete requests without calling S3", async () => {
    const result = await handler({
      RequestType: "Delete",
      ResourceProperties: baseProps,
    });

    expect(result.Status).toBe("SUCCESS");
    expect(result.Data).toEqual({});
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("uses PhysicalResourceId from event when provided", async () => {
    const result = await handler({
      RequestType: "Delete",
      ResourceProperties: baseProps,
      PhysicalResourceId: "my-existing-id",
    });

    expect(result.PhysicalResourceId).toBe("my-existing-id");
  });

  it("generates PhysicalResourceId when not provided", async () => {
    const result = await handler({
      RequestType: "Delete",
      ResourceProperties: baseProps,
    });

    expect(result.PhysicalResourceId).toMatch(/^web-console-zip-\d+$/);
  });

  it("returns FAILED when web-assets directory does not exist (Create)", async () => {
    const result = await handler({
      RequestType: "Create",
      ResourceProperties: baseProps,
    });

    expect(result.Status).toBe("FAILED");
    expect(result.Reason).toContain("Web assets directory not found");
  });

  it("returns FAILED when web-assets directory does not exist (Update)", async () => {
    const result = await handler({
      RequestType: "Update",
      ResourceProperties: baseProps,
    });

    expect(result.Status).toBe("FAILED");
    expect(result.Reason).toContain("Web assets directory not found");
  });

  it("includes error message in Reason field for Error instances", async () => {
    const result = await handler({
      RequestType: "Create",
      ResourceProperties: baseProps,
    });

    expect(result.Status).toBe("FAILED");
    expect(typeof result.Reason).toBe("string");
    expect(result.Reason!.length).toBeGreaterThan(0);
  });

  it("preserves PhysicalResourceId in error responses", async () => {
    const result = await handler({
      RequestType: "Create",
      ResourceProperties: baseProps,
      PhysicalResourceId: "keep-this-id",
    });

    expect(result.Status).toBe("FAILED");
    expect(result.PhysicalResourceId).toBe("keep-this-id");
  });
});
