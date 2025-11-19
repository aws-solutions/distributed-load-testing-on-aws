// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const mockS3Send = jest.fn();
const mockS3Client = { send: mockS3Send };

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(() => mockS3Client),
  PutObjectCommand: jest.fn(),
}));

// eslint-disable-next-line import/first
import { handler } from "../lambda/aws-exports-handler/index";
// eslint-disable-next-line import/first
import { PutObjectCommand } from "@aws-sdk/client-s3";

describe("aws-exports handler with realistic CloudFormation event", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockEvent = {
    RequestType: "Create",
    ServiceToken: "arn:aws:lambda:us-east-1:123456789012:function:test-function",
    ResponseURL: "https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com/...",
    StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/12345678-1234-1234-1234-123456789012",
    RequestId: "12345678-1234-1234-1234-123456789012",
    LogicalResourceId: "TestCustomResource",
    ResourceType: "AWS::CloudFormation::CustomResource",
    ResourceProperties: {
      ServiceToken: "arn:aws:lambda:us-east-1:123456789012:function:test-function",
      UserFilesBucketRegion: "us-east-1",
      PoolClientId: "test-client-id",
      UserPoolId: "us-east-1_TestPool",
      BucketName: "test-console-bucket",
      UserFilesBucket: "test-files-bucket",
      ObjectKey: "aws-exports.json",
      IdentityPoolId: "us-east-1:12345678-1234-1234-1234-123456789012",
      ApiEndpoint: "https://testapi.execute-api.us-east-1.amazonaws.com/prod",
      IoTEndpoint: "https://iot.us-east-1.amazonaws.com",
      IoTPolicy: "test-iot-policy",
    },
  };

  test("handles Create request with realistic CloudFormation event", async () => {
    mockS3Send.mockResolvedValue({});

    const result = await handler(mockEvent);

    expect(result.Status).toBe("SUCCESS");
    expect(mockS3Send).toHaveBeenCalledTimes(1);
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: "test-console-bucket",
      Key: "aws-exports.json",
      Body: JSON.stringify(
        {
          UserPoolId: "us-east-1_TestPool",
          PoolClientId: "test-client-id",
          IdentityPoolId: "us-east-1:12345678-1234-1234-1234-123456789012",
          ApiEndpoint: "https://testapi.execute-api.us-east-1.amazonaws.com/prod",
          UserFilesBucket: "test-files-bucket",
          UserFilesBucketRegion: "us-east-1",
          IoTEndpoint: "https://iot.us-east-1.amazonaws.com",
          IoTPolicy: "test-iot-policy",
        },
        null,
        2
      ),
      ContentType: "application/json",
    });
  });

  test("handles Update request", async () => {
    mockS3Send.mockResolvedValue({});
    const updateEvent = { ...mockEvent, RequestType: "Update" };

    const result = await handler(updateEvent);

    expect(result.Status).toBe("SUCCESS");
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });

  test("handles Delete request without S3 operation", async () => {
    const deleteEvent = { ...mockEvent, RequestType: "Delete" };

    const result = await handler(deleteEvent);

    expect(result.Status).toBe("SUCCESS");
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  test("returns FAILED status on S3 error", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    mockS3Send.mockRejectedValue(new Error("S3 upload failed"));

    const result = await handler(mockEvent);

    expect(result.Status).toBe("FAILED");
    expect(result.Reason).toBe("S3 upload failed");
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error:", expect.any(Error));
    consoleErrorSpy.mockRestore();
  });
});
