// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { createContext, ReactNode, useEffect, useState } from "react";
import { AuthUser, fetchUserAttributes, getCurrentUser, signInWithRedirect, signOut } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { attachIoTPolicy } from "../utils/iotPolicy";

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

  Hub.listen("auth", ({ payload }) => {
    switch (payload.event) {
      case "signedOut":
        setUser(null);
        break;
      case "signInWithRedirect":
      case "signedIn":
        checkUser();
        break;
      default:
        break;
    }
  });

  useEffect(() => {
    Hub.listen("auth", ({ payload }) => {
      switch (payload.event) {
        case "signInWithRedirect":
        case "signedIn":
          checkUser();
          break;
        case "signedOut":
          setUser(null);
          break;
      }
    });
    checkUser();
  }, []);

  const checkUser = async () => {
    try {
      const responseUser: AuthUser | null = await getCurrentUser();
      setUser({
        ...responseUser,
      });
      try {
        const userAttributesOutput = await fetchUserAttributes();
        setEmail(userAttributesOutput.email ?? null);

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
      console.error(error);
      setUser(null);
      // If user is not authenticated, trigger sign in
      try {
        await signInWithRedirect();
      } catch (signInError) {
        console.debug("Sign in error:", signInError);
      }
    }
  };

  return (
    <UserContext.Provider
      value={{
        user,
        email,
        signOut,
        signInWithRedirect,
      }}
    >
      {props.children}
    </UserContext.Provider>
  );
};
