// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContext } from "react";
import { render, act } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { rootReducer } from "../../store/store";
import { addNotification, NotificationPayload } from "../../store/notificationsSlice";
import { NotificationContext, NotificationContextProvider } from "../../contexts/NotificationContext";

function setup(initial: NotificationPayload[]) {
  const store = configureStore({ reducer: rootReducer });
  initial.forEach((n) => store.dispatch(addNotification(n)));

  let count = 0;
  const Probe = () => {
    count = useContext(NotificationContext).notifications.length;
    return null;
  };
  render(
    <Provider store={store}>
      <NotificationContextProvider>
        <Probe />
      </NotificationContextProvider>
    </Provider>
  );
  return { getCount: () => count };
}

describe("NotificationContext auto-dismiss", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("removes an auto-dismiss notification after the timeout", () => {
    const { getCount } = setup([{ id: "ok", type: "success", content: "Saved", autoDismiss: true }]);
    expect(getCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(getCount()).toBe(0);
  });

  it("keeps a notification without autoDismiss", () => {
    const { getCount } = setup([{ id: "err", type: "error", content: "Failed" }]);
    expect(getCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(getCount()).toBe(1);
  });
});
