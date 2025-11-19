// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { UserContextProvider, UserContext } from "../../contexts/UserContext";
import { useContext } from "react";

// Mock Amplify auth
vi.mock("aws-amplify/auth", () => ({
  getCurrentUser: vi.fn(),
  fetchUserAttributes: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
}));

// Mock Hub
vi.mock("aws-amplify/utils", () => ({
  Hub: { listen: vi.fn() },
}));

// Mock IoT policy utility
vi.mock("../../utils/iotPolicy", () => ({
  attachIoTPolicy: vi.fn(),
}));

const TestComponent = () => {
  const { user, email } = useContext(UserContext);
  return (
    <div>
      <span data-testid="user">{user?.userId || "no-user"}</span>
      <span data-testid="email">{email || "no-email"}</span>
    </div>
  );
};

describe("UserContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("should attach IoT policy when user authenticates", async () => {
    const { getCurrentUser, fetchUserAttributes } = await import("aws-amplify/auth");
    const { attachIoTPolicy } = await import("../../utils/iotPolicy");
    
    const mockUser = { userId: "test-user", username: "test-user" };
    const mockConfig = { IoTPolicy: "test-iot-policy" };

    vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
    vi.mocked(fetchUserAttributes).mockResolvedValue({ email: "test@example.com" });
    vi.mocked(global.fetch).mockResolvedValue({
      json: () => Promise.resolve(mockConfig),
    } as Response);
    vi.mocked(attachIoTPolicy).mockResolvedValue(undefined);

    render(
      <UserContextProvider>
        <TestComponent />
      </UserContextProvider>
    );

    await waitFor(() => {
      expect(attachIoTPolicy).toHaveBeenCalledWith("test-iot-policy");
    });
  });

  it("should not attach IoT policy when no policy in config", async () => {
    const { getCurrentUser, fetchUserAttributes } = await import("aws-amplify/auth");
    const { attachIoTPolicy } = await import("../../utils/iotPolicy");
    
    const mockUser = { userId: "test-user", username: "test-user" };
    const mockConfig = {};

    vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
    vi.mocked(fetchUserAttributes).mockResolvedValue({ email: "test@example.com" });
    vi.mocked(global.fetch).mockResolvedValue({
      json: () => Promise.resolve(mockConfig),
    } as Response);

    render(
      <UserContextProvider>
        <TestComponent />
      </UserContextProvider>
    );

    await waitFor(() => {
      expect(fetchUserAttributes).toHaveBeenCalled();
    });

    expect(attachIoTPolicy).not.toHaveBeenCalled();
  });
});
