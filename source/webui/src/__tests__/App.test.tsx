// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

// Mock Amplify auth
const mockGetCurrentUser = vi.fn();
const mockFetchAuthSession = vi.fn();
const mockSignInWithRedirect = vi.fn();
const mockSignOut = vi.fn();

vi.mock("aws-amplify/auth", () => ({
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
  fetchAuthSession: (...args: unknown[]) => mockFetchAuthSession(...args),
  signInWithRedirect: (...args: unknown[]) => mockSignInWithRedirect(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

// Capture the Hub listener callback so tests can simulate auth events
let hubCallback: (event: { payload: { event: string; data?: unknown } }) => void;
vi.mock("aws-amplify/utils", () => ({
  Hub: {
    listen: vi.fn((_channel: string, cb: typeof hubCallback) => {
      hubCallback = cb;
      return vi.fn(); // unsubscribe
    }),
  },
}));

// Mock AppRoutes — rendered when authenticated
vi.mock("../AppRoutes.tsx", () => ({
  AppRoutes: () => <div data-testid="app-routes">App Routes</div>,
}));

// Mock the stack info query so App doesn't need a Redux Provider
vi.mock("../store/stackInfoApiSlice.ts", async () => {
  const actual = await vi.importActual("../store/stackInfoApiSlice.ts");
  return {
    ...actual,
    useGetStackInfoQuery: () => ({ data: undefined }),
  };
});

import { App } from "../App";

const setLocation = (search = "", pathname = "/") => {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: `http://localhost${pathname}${search}`, search, pathname },
  });
};

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLocation();
    window.history.replaceState = vi.fn();
  });

  const authenticateUser = () => {
    mockGetCurrentUser.mockResolvedValue({ userId: "user-1", username: "user-1" });
    mockFetchAuthSession.mockResolvedValue({ tokens: { idToken: "token" } });
  };

  it("renders AppRoutes when user is authenticated", async () => {
    authenticateUser();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("app-routes")).toBeInTheDocument());
  });

  it("shows loading state initially", () => {
    mockGetCurrentUser.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("redirects to sign in when user is not authenticated", async () => {
    mockGetCurrentUser.mockRejectedValue(new Error("not authenticated"));
    render(<App />);
    await waitFor(() => expect(mockSignInWithRedirect).toHaveBeenCalled());
    expect(screen.getByText("Redirecting to sign in...")).toBeInTheDocument();
  });

  it("redirects when user exists but session has no tokens", async () => {
    mockGetCurrentUser.mockResolvedValue({ userId: "user-1" });
    mockFetchAuthSession.mockResolvedValue({ tokens: null });
    render(<App />);
    await waitFor(() => expect(mockSignInWithRedirect).toHaveBeenCalled());
  });

  it("shows error after exceeding max redirect attempts", async () => {
    mockGetCurrentUser.mockRejectedValue(new Error("not authenticated"));
    render(<App />);

    // 1st redirect from checkAuthState
    await waitFor(() => expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1));

    // Hub signInWithRedirect triggers checkAuthState again → 2nd redirect
    await act(async () => hubCallback({ payload: { event: "signInWithRedirect" } }));
    await waitFor(() => expect(mockSignInWithRedirect).toHaveBeenCalledTimes(2));

    // 3rd redirect
    await act(async () => hubCallback({ payload: { event: "signInWithRedirect" } }));
    await waitFor(() => expect(mockSignInWithRedirect).toHaveBeenCalledTimes(3));

    // 4th attempt should be blocked → error shown
    await act(async () => hubCallback({ payload: { event: "signInWithRedirect" } }));
    await waitFor(() => expect(screen.getByText("Sign-in failed")).toBeInTheDocument());
    expect(mockSignInWithRedirect).toHaveBeenCalledTimes(3); // no additional call
  });

  it("Try Again button resets error and retries redirect", async () => {
    mockGetCurrentUser.mockRejectedValue(new Error("not authenticated"));
    render(<App />);

    await waitFor(() => expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1));
    await act(async () => hubCallback({ payload: { event: "signInWithRedirect" } }));
    await waitFor(() => expect(mockSignInWithRedirect).toHaveBeenCalledTimes(2));
    await act(async () => hubCallback({ payload: { event: "signInWithRedirect" } }));
    await waitFor(() => expect(mockSignInWithRedirect).toHaveBeenCalledTimes(3));
    await act(async () => hubCallback({ payload: { event: "signInWithRedirect" } }));
    await waitFor(() => expect(screen.getByText("Sign-in failed")).toBeInTheDocument());

    mockSignInWithRedirect.mockClear();
    fireEvent.click(screen.getByText("Try Again"));
    expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it("handles signInWithRedirect_failure Hub event", async () => {
    setLocation("?code=abc&state=xyz");
    mockGetCurrentUser.mockReturnValue(new Promise(() => {}));
    render(<App />);

    await act(async () => hubCallback({ payload: { event: "signInWithRedirect_failure", data: "error" } }));
    await waitFor(() => expect(screen.getByText("Redirecting to sign in...")).toBeInTheDocument());
  });

  it("handles tokenRefresh_failure by signing out", async () => {
    authenticateUser();
    mockSignOut.mockResolvedValue(undefined);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("app-routes")).toBeInTheDocument());

    await act(async () => hubCallback({ payload: { event: "tokenRefresh_failure" } }));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  });

  it("does not redirect when OAuth params are present (waits for Amplify)", async () => {
    setLocation("?code=abc&state=xyz");
    mockGetCurrentUser.mockRejectedValue(new Error("not authenticated"));
    render(<App />);
    await waitFor(() => expect(mockGetCurrentUser).toHaveBeenCalled());
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });

  describe("OAuth callback timeout", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("triggers fresh redirect after OAuth callback timeout", async () => {
      setLocation("?code=abc&state=xyz");
      mockGetCurrentUser.mockRejectedValue(new Error("not authenticated"));
      render(<App />);

      await waitFor(() => expect(mockGetCurrentUser).toHaveBeenCalled());
      expect(mockSignInWithRedirect).not.toHaveBeenCalled();

      // Advance past OAUTH_CALLBACK_TIMEOUT_MS (5000ms)
      await act(async () => vi.advanceTimersByTime(5001));
      expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
    });
  });
});
