// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";

interface HelpContextValue {
  /** Whether the help tools panel is open. */
  isOpen: boolean;
  /** The topic currently shown, or null when nothing has been selected. */
  topicId: string | null;
  /** Open the panel on a topic (switches topic if already open). */
  openTopic: (topicId: string) => void;
  /** Set the open/closed state directly (e.g. from AppLayout's onToolsChange). */
  setOpen: (isOpen: boolean) => void;
}

// Safe no-op default so components using InfoLink/useHelp render without a
// provider (e.g. in isolated unit tests) — the info affordance simply does
// nothing rather than throwing.
const NOOP_HELP: HelpContextValue = {
  isOpen: false,
  topicId: null,
  openTopic: () => {},
  setOpen: () => {},
};

const HelpContext = createContext<HelpContextValue>(NOOP_HELP);

export function HelpProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [isOpen, setIsOpen] = useState(false);
  const [topicId, setTopicId] = useState<string | null>(null);

  const openTopic = useCallback((id: string) => {
    setTopicId(id);
    setIsOpen(true);
  }, []);

  const setOpen = useCallback((open: boolean) => {
    setIsOpen(open);
  }, []);

  const value = useMemo(() => ({ isOpen, topicId, openTopic, setOpen }), [isOpen, topicId, openTopic, setOpen]);

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export function useHelp(): HelpContextValue {
  return useContext(HelpContext);
}
