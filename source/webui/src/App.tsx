// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { withAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import { AppRoutes } from "./AppRoutes.tsx";

export const AppComponent = () => <AppRoutes></AppRoutes>;

export const App = withAuthenticator(AppComponent, {
  loginMechanisms: ["username"],
  hideSignUp: true,
});
