// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createContext, ReactNode, useEffect, useRef, useState } from "react";
import { FlashbarProps } from "@cloudscape-design/components";
import { useDispatch, useSelector } from "react-redux";
import { deleteNotification, selectNotifications } from "../store/notificationsSlice.ts";

/** How long an auto-dismiss notification stays visible before it is removed. */
const AUTO_DISMISS_MS = 5_000;

/**
 * NotificationContext provides the notifications to the global FlashBar
 * and any component that needs to use them.
 *
 * The notifications are stored in the redux store,
 * but NotificationContext adds the onDismiss method to each notification object
 * which is not serializable and cannot be stored in redux.
 */
export type NotificationContextType = {
  notifications: ReadonlyArray<FlashbarProps.MessageDefinition>;
};

export const NotificationContext = createContext<NotificationContextType>(null as unknown as NotificationContextType);
export const NotificationContextProvider = (props: { children: ReactNode }) => {
  const storeNotifications = useSelector(selectNotifications);
  const dispatch = useDispatch();

  const initialState: ReadonlyArray<FlashbarProps.MessageDefinition> = [];
  const [notifications, setNotifications] = useState(initialState);
  // IDs that already have a pending auto-dismiss timer, so re-renders don't double-schedule.
  const scheduled = useRef<Set<string>>(new Set());

  useEffect(() => {
    setNotifications(
      storeNotifications.map((it) => ({
        dismissible: true,
        onDismiss: () => dispatch(deleteNotification({ id: it.id })),
        ...it,
      }))
    );

    // Schedule removal for any auto-dismiss notifications not already timed.
    for (const it of storeNotifications) {
      if (it.autoDismiss && !scheduled.current.has(it.id)) {
        scheduled.current.add(it.id);
        setTimeout(() => {
          dispatch(deleteNotification({ id: it.id }));
          scheduled.current.delete(it.id);
        }, AUTO_DISMISS_MS);
      }
    }
  }, [storeNotifications, dispatch]);

  return (
    <>
      <NotificationContext.Provider value={{ notifications }}>{props.children}</NotificationContext.Provider>
    </>
  );
};
