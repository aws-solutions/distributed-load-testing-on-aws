// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/* global vi */

import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { NotificationContextProvider } from "../contexts/NotificationContext.tsx";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../AppRoutes.tsx";
import { render } from "@testing-library/react";
import { rootReducer, RootState } from "../store/store.ts";
import { solutionApi } from "../store/solutionApi.ts";

// Mock the useAuthenticator hook to return a mock user
vi.mock("@aws-amplify/ui-react", () => ({
  useAuthenticator: () => ({
    user: {
      username: "test-user",
      userId: "test-user-id",
      signInDetails: {
        loginId: "test-user@example.com",
        authFlowType: "USER_SRP_AUTH",
      },
    },
    signOut: vi.fn(),
  }),
}));

/*
 * Render a page within the context of a Router, redux store, and NotificationContext.
 *
 * This function provides setup for component tests that
 * - interact with the store state,
 * - navigate between pages
 * - emit notifications
 * - use mocked authentication
 */
export function renderAppContent(props?: { preloadedState?: Partial<RootState>; initialRoute: string }) {
  const store = configureStore({
    reducer: rootReducer,
    preloadedState: props?.preloadedState ?? {},
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(solutionApi.middleware),
  });

  const renderResult = render(
    <MemoryRouter initialEntries={[props?.initialRoute ?? "/"]}>
      <Provider store={store}>
        <NotificationContextProvider>
          <AppRoutes></AppRoutes>
        </NotificationContextProvider>
      </Provider>
    </MemoryRouter>
  );
  return {
    renderResult,
    store,
  };
}
