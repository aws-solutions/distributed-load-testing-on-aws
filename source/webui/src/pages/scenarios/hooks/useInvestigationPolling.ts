// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";
import {
  useGetInvestigationStatusQuery,
  useListInvestigationsQuery,
} from "../../../store/investigationsApiSlice";
import type { InvestigationStatus, InvestigationStatusResponse } from "../../../models/investigation";
import { TERMINAL_STATES } from "../../../models/investigation";

const POLLING_INTERVAL_MS = 10_000;
const MAX_POLLING_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes

export interface UseInvestigationPollingResult {
  /** The active (non-archived) investigation for this test run, or null. */
  activeInvestigation: { investigationId: string; agentSpaceId: string; agentSpaceApiId: string; agentSpaceName: string; createdAt: string } | null;
  /** Live status from the DevOps Agent API. */
  status: InvestigationStatusResponse | undefined;
  /** Whether the status query is currently loading. */
  isStatusLoading: boolean;
  /** Whether an error occurred fetching status. */
  isStatusError: boolean;
  /** Whether the polling lifetime cap has been reached. */
  isPollingExpired: boolean;
}

/**
 * Hook that manages investigation polling for a test run.
 *
 * Polls the investigation status endpoint every 10 seconds.
 * Stops polling when:
 * - The investigation reaches a terminal state (COMPLETED, FAILED, TIMED_OUT, CANCELED)
 * - The browser tab becomes hidden (document.hidden)
 * - The component unmounts
 * - 30 minutes of total polling time have elapsed
 */
export function useInvestigationPolling(testId: string, testRunId: string): UseInvestigationPollingResult {
  const [isPollingExpired, setIsPollingExpired] = useState(false);
  const [isTabVisible, setIsTabVisible] = useState(!document.hidden);
  const pollingStartRef = useRef<number | null>(null);

  // Fetch investigations list to find the active (non-archived) one
  const { data: investigations } = useListInvestigationsQuery({ testId, testRunId });

  const activeInvestigation = investigations?.find((inv) => !inv.archived) ?? null;
  const investigationId = activeInvestigation?.investigationId ?? "";

  // Determine if we should be polling
  const hasActiveInvestigation = activeInvestigation !== null;

  // Track the last known terminal status to stop polling once reached.
  // Using state (not a ref) ensures a re-render occurs when the status
  // transitions to terminal, which updates pollingInterval to undefined
  // and triggers the findings fetch.
  const [reachedTerminal, setReachedTerminal] = useState(false);

  const shouldPoll = hasActiveInvestigation && isTabVisible && !isPollingExpired && !reachedTerminal;
  const pollingInterval = shouldPoll ? POLLING_INTERVAL_MS : undefined;

  const {
    data: status,
    isLoading: isStatusLoading,
    isError: isStatusError,
  } = useGetInvestigationStatusQuery(
    { testId, testRunId, investigationId },
    {
      skip: !hasActiveInvestigation || !investigationId,
      pollingInterval,
    },
  );

  // Mark terminal once status reaches a final state
  useEffect(() => {
    if (status?.status && isTerminal(status.status)) {
      setReachedTerminal(true);
    }
  }, [status?.status]);

  // Track tab visibility
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsTabVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Track polling lifetime (30 min cap)
  useEffect(() => {
    if (!hasActiveInvestigation || isTerminal(status?.status)) {
      pollingStartRef.current = null;
      return;
    }

    if (pollingStartRef.current === null) {
      pollingStartRef.current = Date.now();
    }

    const timer = setInterval(() => {
      if (pollingStartRef.current && Date.now() - pollingStartRef.current >= MAX_POLLING_LIFETIME_MS) {
        setIsPollingExpired(true);
        clearInterval(timer);
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [hasActiveInvestigation, status?.status]);

  // Reset polling expiration when investigation changes
  useEffect(() => {
    if (!hasActiveInvestigation) {
      setIsPollingExpired(false);
      setReachedTerminal(false);
      pollingStartRef.current = null;
    }
  }, [hasActiveInvestigation]);

  return {
    activeInvestigation: activeInvestigation
      ? {
          investigationId: activeInvestigation.investigationId,
          agentSpaceId: activeInvestigation.agentSpaceId,
          agentSpaceApiId: activeInvestigation.agentSpaceApiId,
          agentSpaceName: activeInvestigation.agentSpaceName,
          createdAt: activeInvestigation.createdAt,
        }
      : null,
    status,
    isStatusLoading,
    isStatusError,
    isPollingExpired,
  };
}

function isTerminal(status: InvestigationStatus | undefined): boolean {
  if (!status) return false;
  return TERMINAL_STATES.includes(status);
}
