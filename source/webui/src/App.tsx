// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";
import { signInWithRedirect, signOut, getCurrentUser, fetchAuthSession } from "aws-amplify/auth";
import { get } from "aws-amplify/api";
import { Hub } from "aws-amplify/utils";
import "@aws-amplify/ui-react/styles.css";
import { AppRoutes } from "./AppRoutes.tsx";
import { initConsoleMetrics, sendConsoleMetric, sendSessionEndMetric } from "./utils/consoleMetrics.ts";
import { STACK_INFO_CACHE_SECONDS, StackInfo, useGetStackInfoQuery } from "./store/stackInfoApiSlice.ts";

/**
 * Check if the current URL contains OAuth callback parameters.
 * When Cognito redirects back after sign-in, the URL will contain ?code=...&state=...
 */
const hasOAuthParams = (): boolean => {
  const params = new URLSearchParams(window.location.search);
  return params.has("code") || params.has("error");
};

/**
 * Remove OAuth callback parameters (?code=...&state=...) from the URL
 * without triggering a page reload. This prevents stale params from
 * confusing future auth checks or page refreshes.
 */
const stripOAuthParamsFromUrl = () => {
  if (hasOAuthParams()) {
    const url = new URL(window.location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    url.searchParams.delete("error");
    url.searchParams.delete("error_description");
    const cleanUrl = url.searchParams.toString()
      ? `${url.pathname}?${url.searchParams.toString()}`
      : url.pathname;
    window.history.replaceState({}, "", cleanUrl);
  }
};

/** How long to wait for Amplify to process an OAuth callback before giving up. */
const OAUTH_CALLBACK_TIMEOUT_MS = 5000;

/** Maximum number of redirect attempts before showing an error instead of looping. */
const MAX_REDIRECT_ATTEMPTS = 3;

export const App = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const { data: stackInfo } = useGetStackInfoQuery(undefined, { skip: !isAuthenticated, refetchOnMountOrArgChange: STACK_INFO_CACHE_SECONDS });

  const callbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirectCountRef = useRef(0);
  const loginMetricSentRef = useRef(false); // deduplicate LoginSuccess metric across concurrent checkAuthState calls

  useEffect(() => {
    const handleBeforeUnload = () => {
      sendSessionEndMetric();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (stackInfo) initConsoleMetrics(stackInfo);
  }, [stackInfo]);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      sendConsoleMetric(
        "UnhandledError",
        { ErrorMessage: event.message?.slice(0, 256), Source: event.filename, Line: event.lineno, Column: event.colno, StackTrace: event.error?.stack?.slice(0, 512), CurrentPath: window.location.pathname?.slice(0, 128) },
      );
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg = reason?.message || String(reason);
      sendConsoleMetric(
        "UnhandledPromiseRejection",
        {
          ErrorMessage: msg.slice(0, 256),
          ErrorName: reason?.name?.slice(0, 64),
          StackTrace: reason?.stack?.slice(0, 512),
          CurrentPath: window.location.pathname?.slice(0, 128),
        },
      );
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  useEffect(() => {

    // Listen for auth events BEFORE checking auth state,
    // so we catch the signInWithRedirect event from OAuth callback processing.
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      switch (payload.event) {
        case "signInWithRedirect":
          // OAuth callback was processed successfully.
          // Clear fallback timeout and clean URL, then re-check auth state.
          if (callbackTimeoutRef.current) {
            clearTimeout(callbackTimeoutRef.current);
            callbackTimeoutRef.current = null;
          }
          stripOAuthParamsFromUrl();
          checkAuthState();
          break;
        case "signInWithRedirect_failure":
          console.error("Sign in with redirect failed:", payload.data);
          if (callbackTimeoutRef.current) {
            clearTimeout(callbackTimeoutRef.current);
            callbackTimeoutRef.current = null;
          }
          // Strip the stale params so a refresh starts fresh.
          stripOAuthParamsFromUrl();
          setIsAuthenticated(false);
          setIsRedirecting(false);
          setIsLoading(false);
          break;
        case "signedOut":
          setIsAuthenticated(false);
          break;
        case "tokenRefresh":
          console.log("Token refreshed");
          break;
        case "tokenRefresh_failure":
          console.error("Token refresh failed");
          handleSignOut();
          break;
      }
    });

    // If we landed on an OAuth callback URL, start a fallback timer.
    // If Amplify doesn't fire signInWithRedirect or signInWithRedirect_failure
    // within the timeout (e.g. because the PKCE state was lost), strip the
    // stale params and start a fresh sign-in redirect.
    if (hasOAuthParams()) {
      callbackTimeoutRef.current = setTimeout(() => {
        console.warn("OAuth callback timeout — Amplify did not process the callback. Starting fresh sign-in.");
        stripOAuthParamsFromUrl();
        setIsRedirecting(true);
        signInWithRedirect();
      }, OAUTH_CALLBACK_TIMEOUT_MS);
    }

    // Check if user is authenticated on mount
    checkAuthState();

    return () => {
      unsubscribe();
      if (callbackTimeoutRef.current) {
        clearTimeout(callbackTimeoutRef.current);
      }
    };
  }, []);

  const checkAuthState = async () => {
    try {
      const user = await getCurrentUser();
      if (user) {
        // Verify we have a valid session
        const session = await fetchAuthSession();
        if (session.tokens) {
          setIsAuthenticated(true);
          setIsRedirecting(false);
          setAuthError(null);
          redirectCountRef.current = 0;
          // Clear the fallback timeout — we're authenticated
          if (callbackTimeoutRef.current) {
            clearTimeout(callbackTimeoutRef.current);
            callbackTimeoutRef.current = null;
          }
          // Clean up OAuth params from URL if still present
          stripOAuthParamsFromUrl();
          // Send LoginSuccess metric once per authentication — the mount checkAuthState
          // and the Hub signInWithRedirect handler can both succeed on OAuth callback,
          // so we guard with loginMetricSentRef to avoid duplicate metrics.
          if (!loginMetricSentRef.current) {
            loginMetricSentRef.current = true;
            try {
              const stackInfo = await get({ apiName: "solution-api", path: "/stack-info" }).response.then((r) => r.body.json()) as StackInfo;
              initConsoleMetrics(stackInfo);
              sendConsoleMetric("LoginSuccess", { AuthMethod: "CognitoHostedUI" });
            } catch (err) {
              console.error("LoginSuccess metric failed:", err);
            }
          }
        } else {
          // No valid session, redirect to Cognito
          triggerRedirect();
        }
      } else {
        // No user, redirect to Cognito
        triggerRedirect();
      }
    } catch {
      // User is not authenticated
      triggerRedirect();
    } finally {
      setIsLoading(false);
    }
  };

  const triggerRedirect = () => {
    // If the URL contains OAuth callback parameters (?code=...&state=...),
    // Amplify may still be processing the callback. Do NOT trigger a new redirect
    // as that would interrupt the token exchange. The fallback timeout in useEffect
    // will handle the case where Amplify fails to process it.
    if (hasOAuthParams()) {
      console.log("OAuth callback detected, waiting for Amplify to process...");
      return;
    }

    redirectCountRef.current += 1;
    loginMetricSentRef.current = false; // allow LoginSuccess metric on next successful auth
    if (redirectCountRef.current > MAX_REDIRECT_ATTEMPTS) {
      console.error(`Exceeded maximum redirect attempts (${MAX_REDIRECT_ATTEMPTS}). Stopping to prevent infinite loop.`);
      setAuthError("Unable to complete sign-in after multiple attempts. This may be a temporary issue.");
      setIsRedirecting(false);
      setIsLoading(false);
      return;
    }

    setIsRedirecting(true);
    signInWithRedirect();
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setIsAuthenticated(false);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              border: "4px solid #f3f3f3",
              borderTop: "4px solid #3498db",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 16px",
            }}
          />
          <p>Loading...</p>
          <style>
            {`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}
          </style>
        </div>
      </div>
    );
  }

  // Show error state if authentication permanently failed
  if (authError) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "400px" }}>
          <p style={{ color: "#d32f2f", fontSize: "18px", marginBottom: "8px" }}>Sign-in failed</p>
          <p style={{ color: "#666", fontSize: "14px", marginBottom: "16px" }}>{authError}</p>
          <button
            onClick={() => {
              setAuthError(null);
              redirectCountRef.current = 0;
              triggerRedirect();
            }}
            style={{
              padding: "8px 24px",
              fontSize: "14px",
              cursor: "pointer",
              backgroundColor: "#3498db",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
            }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // If not authenticated, show redirecting message (auto-redirect already triggered)
  if (!isAuthenticated || isRedirecting) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              border: "4px solid #f3f3f3",
              borderTop: "4px solid #3498db",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 16px",
            }}
          />
          <p>Redirecting to sign in...</p>
          <style>
            {`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}
          </style>
        </div>
      </div>
    );
  }

  // User is authenticated, render the app
  return <AppRoutes />;
};

// Export signOut for use in other components (e.g., navigation bar)
export { signOut } from "aws-amplify/auth";
