// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import {
  sendConsoleMetric,
  sendSessionEndMetric,
  getSessionId,
  resetSessionId,
  initConsoleMetrics,
} from "../../utils/consoleMetrics";

let mockFetch: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  // Spy on whatever fetch is installed (undici via setupTests.ts).
  // Must happen in beforeEach so it wraps the current globalThis.fetch.
  mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  sessionStorage.clear();
});

/** Extract JSON body from mock fetch call (handles both Request object and (url, options) forms). */
async function getCallBody(callIndex = 0): Promise<any> {
  const [arg] = mockFetch.mock.calls[callIndex];
  if (arg instanceof Request) return JSON.parse(await arg.text());
  return JSON.parse(mockFetch.mock.calls[callIndex][1].body);
}

describe("consoleMetrics", () => {
  describe("sendConsoleMetric", () => {
    it("posts to metrics endpoint with correct payload shape", async () => {
      initConsoleMetrics({ deployment_id: "deploy-id-123", version: "v4.0.3", account_id: "123456789012" });
      await sendConsoleMetric("LoginSuccess", { AuthMethod: "CognitoHostedUI" });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      const body = await getCallBody();
      expect(body.Solution).toBe("SO0062");
      expect(body.UUID).toBe("deploy-id-123");
      expect(body.Version).toBe("v4.0.3");
      expect(body.MetricSchemaVersion).toBe(1);
      expect(body.AccountId).toBe("123456789012");
      expect(body.Data.Type).toBe("LoginSuccess");
      expect(body.Data.AuthMethod).toBe("CognitoHostedUI");
      expect(body.Data.SessionId).toBeDefined();
      expect(body.TimeStamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    it("omits AccountId when not provided", async () => {
      initConsoleMetrics({ deployment_id: "deploy-id-123", version: "v4.0.3" });
      await sendConsoleMetric("LoginSuccess", {});
      const body = await getCallBody();
      expect(body.AccountId).toBeUndefined();
      expect(body.MetricSchemaVersion).toBe(1);
    });

    it("does not post when deploymentId is undefined", async () => {
      initConsoleMetrics({ deployment_id: undefined, version: "v4.0.3" });
      await sendConsoleMetric("LoginSuccess", {});
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not throw when fetch rejects", async () => {
      initConsoleMetrics({ deployment_id: "deploy-id-123", version: "v4.0.3" });
      mockFetch.mockRejectedValueOnce(new Error("network error"));
      await expect(sendConsoleMetric("LoginSuccess", {})).resolves.toBeUndefined();
    });

    it("uses 'unknown' version when version is undefined", async () => {
      initConsoleMetrics({ deployment_id: "deploy-id-123", version: undefined });
      await sendConsoleMetric("LoginSuccess", {});
      const body = await getCallBody();
      expect(body.Version).toBe("unknown");
    });
  });

  describe("getSessionId", () => {
    it("returns the same ID on repeated calls", () => {
      const id1 = getSessionId();
      const id2 = getSessionId();
      expect(id1).toBe(id2);
    });

    it("returns a non-empty string", () => {
      expect(getSessionId().length).toBeGreaterThan(0);
    });
  });

  describe("sendSessionEndMetric", () => {
    it("sends payload with SessionEnd type, keepalive, and session duration", () => {
      initConsoleMetrics({ deployment_id: "deploy-id-123", version: "v4.0.3", account_id: "123456789012" });
      const sessionId = getSessionId();
      const startTime = Date.now() - 5000;
      sessionStorage.setItem("dlt-console-session-start", String(startTime));

      sendSessionEndMetric();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://metrics.awssolutionsbuilder.com/page");
      expect(options.keepalive).toBe(true);

      const body = JSON.parse(options.body);
      expect(body.Solution).toBe("SO0062");
      expect(body.UUID).toBe("deploy-id-123");
      expect(body.Version).toBe("v4.0.3");
      expect(body.AccountId).toBe("123456789012");
      expect(body.Data.Type).toBe("SessionEnd");
      expect(body.Data.SessionId).toBe(sessionId);
      expect(body.Data.SessionDurationMs).toBeGreaterThanOrEqual(5000);
    });

    it("skips when deploymentId is not set", () => {
      initConsoleMetrics({ deployment_id: undefined });
      getSessionId();
      sendSessionEndMetric();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("uses duration 0 when session start is missing", () => {
      initConsoleMetrics({ deployment_id: "deploy-id-123", version: "v4.0.3" });
      getSessionId();
      sessionStorage.removeItem("dlt-console-session-start");

      sendSessionEndMetric();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.Data.SessionDurationMs).toBe(0);
    });

    it("does not throw when fetch rejects", () => {
      initConsoleMetrics({ deployment_id: "deploy-id-123", version: "v4.0.3" });
      getSessionId();
      mockFetch.mockRejectedValueOnce(new Error("network error"));
      expect(() => sendSessionEndMetric()).not.toThrow();
    });
  });

  describe("session lifecycle", () => {
    beforeEach(() => {
      initConsoleMetrics({ deployment_id: "deploy-id-123", version: "v4.0.3" });
    });

    it("explicit logout: resetSessionId prevents sendSessionEndMetric from firing", () => {
      getSessionId();
      resetSessionId();
      sendSessionEndMetric();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("tab/browser close: sessionStorage.clear() prevents sendSessionEndMetric from firing", () => {
      getSessionId();
      sessionStorage.clear(); // browser clears all sessionStorage on tab/window close
      sendSessionEndMetric();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("resetSessionId removes both session ID and start keys", () => {
      getSessionId();
      expect(sessionStorage.getItem("dlt-console-session-id")).not.toBeNull();
      expect(sessionStorage.getItem("dlt-console-session-start")).not.toBeNull();

      resetSessionId();

      expect(sessionStorage.getItem("dlt-console-session-id")).toBeNull();
      expect(sessionStorage.getItem("dlt-console-session-start")).toBeNull();
    });

    it("new session ID is generated after resetSessionId", () => {
      const firstId = getSessionId();
      resetSessionId();
      const secondId = getSessionId();
      expect(secondId).not.toBe(firstId);
    });
  });
});
