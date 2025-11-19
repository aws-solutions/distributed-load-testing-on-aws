// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { attachIoTPolicy } from "../../utils/iotPolicy";

// Mock AWS SDK
const mockSend = vi.fn();
const mockIoTClient = vi.fn().mockImplementation(() => ({
  send: mockSend,
}));
const mockAttachPolicyCommand = vi.fn();

vi.mock("@aws-sdk/client-iot", () => ({
  IoTClient: mockIoTClient,
  AttachPolicyCommand: mockAttachPolicyCommand,
}));

// Mock Amplify auth
vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: vi.fn(),
}));

describe("attachIoTPolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("should attach IoT policy successfully", async () => {
    const { fetchAuthSession } = await import("aws-amplify/auth");

    const mockSession = {
      identityId: "us-west-2:test-identity-id",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    };
    const mockConfig = { UserFilesBucketRegion: "us-west-2" };

    vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);
    vi.mocked(global.fetch).mockResolvedValue({
      json: () => Promise.resolve(mockConfig),
    } as Response);
    mockSend.mockResolvedValue({});

    await attachIoTPolicy("test-policy");

    expect(fetchAuthSession).toHaveBeenCalled();
    expect(mockIoTClient).toHaveBeenCalledWith({
      region: "us-west-2",
      credentials: mockSession.credentials,
    });
    expect(mockAttachPolicyCommand).toHaveBeenCalledWith({
      policyName: "test-policy",
      target: "us-west-2:test-identity-id",
    });
    expect(mockSend).toHaveBeenCalled();
  });

  it("should throw error when no identity ID", async () => {
    const { fetchAuthSession } = await import("aws-amplify/auth");

    vi.mocked(fetchAuthSession).mockResolvedValue({ credentials: { accessKeyId: "test", secretAccessKey: "test" } });

    await expect(attachIoTPolicy("test-policy")).rejects.toThrow("No identity ID found");
  }, 60000);

  it("should throw error when IoT client fails", async () => {
    const { fetchAuthSession } = await import("aws-amplify/auth");

    const mockSession = {
      identityId: "us-west-2:test-identity-id",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    };
    const mockConfig = { UserFilesBucketRegion: "us-west-2" };

    vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);
    vi.mocked(global.fetch).mockResolvedValue({
      json: () => Promise.resolve(mockConfig),
    } as Response);
    mockSend.mockRejectedValue(new Error("IoT error"));

    await expect(attachIoTPolicy("test-policy")).rejects.toThrow("IoT error");
  });
});
