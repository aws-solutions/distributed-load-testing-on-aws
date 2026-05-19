// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { createContext, ReactNode, useEffect, useState } from "react";
import { AuthUser, fetchAuthSession, getCurrentUser, signInWithRedirect, signOut } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { attachIoTPolicy } from "../utils/iotPolicy";
import { resetSessionId, sendSessionEndMetric } from "../utils/consoleMetrics";

export const UserContext = createContext<{
  user: AuthUser | null;
  email: string | null;
  signOut: () => Promise<void>;
  signInWithRedirect: () => Promise<void>;
}>({
  user: null,
  email: null,
  signOut: () => Promise.resolve(),
  signInWithRedirect: () => Promise.resolve(),
});

export const UserContextProvider = (props: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      switch (payload.event) {
        case "signInWithRedirect":
        case "signedIn":
          checkUser();
          break;
        case "signedOut":
          setUser(null);
          setEmail(null);
          break;
      }
    });
    checkUser();

    return () => unsubscribe();
  }, []);

  const checkUser = async () => {
    try {
      const responseUser: AuthUser | null = await getCurrentUser();
      setUser({
        ...responseUser,
      });
      try {
        const session = await fetchAuthSession();
        const emailClaim = session.tokens?.idToken?.payload?.email;
        setEmail(typeof emailClaim === "string" ? emailClaim : null);

        // Attach IoT policy when user is authenticated
        const response = await fetch("/aws-exports.json");
        const config = await response.json();
        if (config.IoTPolicy) {
          await attachIoTPolicy(config.IoTPolicy);
        }
      } catch (e) {
        console.log(e);
      }
    } catch (error) {
      // User is not authenticated — App.tsx owns the redirect flow,
      // so we only clear local state here without triggering signInWithRedirect.
      console.debug("UserContext: user not authenticated", error);
      setUser(null);
      setEmail(null);
    }
  };

  return (
    <UserContext.Provider
      value={{
        user,
        email,
        signOut: async () => {
          sendSessionEndMetric();
          resetSessionId();
          await signOut();
        },
        signInWithRedirect,
      }}
    >
      {props.children}
    </UserContext.Provider>
  );
};
