// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { get } from "aws-amplify/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { addNotification } from "../../../store/notificationsSlice";
import {
  useGetBaselineQuery,
  useGetTestRunsQuery,
  useRemoveTestRunBaselineMutation,
  useSetTestRunBaselineMutation
} from "../../../store/scenariosApiSlice";
import { TestRun, TestRunsResponse } from "../types";

const PAGE_LIMIT = 20;
const DEBOUNCE_DELAY = 300;
const API_NAME = "solution-api";

interface DateRange {
  type?: string;
  unit?: "minute" | "hour" | "day" | "week" | "month" | "year";
  amount?: number;
}

interface DateRangeResult {
  startTimestamp?: string;
  endTimestamp?: string;
}

interface ApiError {
  message?: string;
}



const createQueryParams = (nextToken: string, dateRange: DateRangeResult): URLSearchParams => {
  const params = new URLSearchParams();
  params.append("limit", PAGE_LIMIT.toString());
  params.append("next_token", nextToken);
  if (dateRange.startTimestamp) params.append("start_timestamp", dateRange.startTimestamp);
  if (dateRange.endTimestamp) params.append("end_timestamp", dateRange.endTimestamp);
  return params;
};

const getLocalStorageItem = <T>(key: string): T | null => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
};

const getDateRange = (dateRange: DateRange | null): DateRangeResult => {
  if (!dateRange?.type || dateRange.type !== "relative") return {};

  const now = new Date();
  now.setSeconds(0, 0);

  const startDate = new Date(now);
  const { unit = "day", amount = 1 } = dateRange;

  const operations = {
    minute: () => startDate.setMinutes(now.getMinutes() - amount),
    hour: () => startDate.setHours(now.getHours() - amount),
    day: () => startDate.setDate(now.getDate() - amount),
    week: () => startDate.setDate(now.getDate() - amount * 7),
    month: () => startDate.setMonth(now.getMonth() - amount),
    year: () => startDate.setFullYear(now.getFullYear() - amount),
  };

  (operations[unit] || operations.day)();

  return {
    startTimestamp: startDate.toISOString(),
    endTimestamp: now.toISOString(),
  };
};

export const useTestRuns = (testId: string) => {
  const dispatch = useDispatch();
  const [dateFilter, setDateFilter] = useState<DateRange | null>(() =>
    getLocalStorageItem<DateRange>(`dateFilter-${testId}`)
  );

  const [baselineTestRun, setBaselineTestRun] = useState<TestRun | null>(() =>
    getLocalStorageItem<TestRun>(`baseline-${testId}`)
  );

  const [allTestRuns, setAllTestRuns] = useState<TestRun[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const dateRange = useMemo(() => getDateRange(dateFilter), [dateFilter]);

  const {
    data: firstPageData,
    isLoading,
    error,
    refetch,
  } = useGetTestRunsQuery(
    {
      testId,
      nextToken: undefined,
      ...dateRange,
    },
    {
      skip: false,
      refetchOnMountOrArgChange: true,
    }
  );

  const { data: baselineData, error: baselineError } = useGetBaselineQuery({ testId });

  const [setBaseline, { isLoading: isSettingBaseline }] = useSetTestRunBaselineMutation();
  const [removeBaseline, { isLoading: isRemovingBaseline }] = useRemoveTestRunBaselineMutation();

  // Progressive loading: Fetches remaining pages of test runs after initial page load
  const loadRemainingPages = useCallback(
    async (startToken: string, firstPageData: TestRun[]) => {
      // Cancel any ongoing progressive loading request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      setIsLoadingMore(true);

      let nextToken: string | null = startToken;
      // Add first page of test runs from initial page load
      const testRuns: TestRun[] = [...firstPageData];

      try {
        // Continue fetching pages until no more tokens or request is aborted
        while (nextToken && !abortControllerRef.current.signal.aborted) {
          const params = createQueryParams(nextToken, dateRange);

          const response = await get({
            apiName: API_NAME,
            path: `/scenarios/${testId}/testruns?${params.toString()}`,
          }).response;
          const data = (await response.body.json()) as unknown as TestRunsResponse;

          // Append new test runs to existing data
          if (data?.testRuns?.length) {
            testRuns.push(...data.testRuns);
          }

          nextToken = data?.pagination?.next_token || null;
        }

        // Only update state if request wasn't cancelled
        if (!abortControllerRef.current.signal.aborted) {
          setAllTestRuns(testRuns);
        }
      } catch (err) {
        if (!abortControllerRef.current.signal.aborted) {
          console.warn("Progressive loading failed:", err);
        }
      } finally {
        setIsLoadingMore(false);
        abortControllerRef.current = null;
      }
    },
    [dateRange, testId]
  );

  // Handle first page load and trigger progressive loading for remaining pages
  useEffect(() => {
    if (!firstPageData || isLoading || error) return;

    // Set initial test runs from first page
    setAllTestRuns(firstPageData.testRuns);

    // Start progressive loading if more pages exist
    if (firstPageData.pagination?.next_token) {
      loadRemainingPages(firstPageData.pagination.next_token, firstPageData.testRuns);
    }
  }, [firstPageData, isLoading, error, loadRemainingPages]);

  // Update baseline from dedicated baseline API endpoint, since we are not guaranteed to receive baseline in the first page of test runs
  useEffect(() => {
    if (!baselineData) return;

    // Convert BaselineTestRunDetails to TestRun format if baseline exists
    if (baselineData.baselineId && baselineData.testRunDetails) {
      const details = baselineData.testRunDetails;
      const totalResults = details.results?.total;
      
      const baselineTestRun: TestRun = {
        testRunId: details.testRunId,
        startTime: details.startTime,
        endTime: details.endTime,
        status: details.status as TestRun['status'],
        isBaseline: true,
        requests: totalResults ? (totalResults.succ + totalResults.fail) : undefined,
        success: totalResults ? totalResults.succ : undefined,
        errors: totalResults ? totalResults.fail : undefined,
        // Calculate RPS: total throughput / test duration
        requestsPerSecond: totalResults && parseFloat(totalResults.testDuration) > 0
          ? totalResults.throughput / parseFloat(totalResults.testDuration)
          : undefined,
        // Convert seconds to milliseconds (× 1000)
        avgResponseTime: totalResults ? parseFloat(totalResults.avg_rt) * 1000 : undefined,
        avgLatency: totalResults ? parseFloat(totalResults.avg_lt) * 1000 : undefined,
        avgConnectionTime: totalResults ? parseFloat(totalResults.avg_ct) * 1000 : undefined,
        // Calculate average bandwidth per request
        avgBandwidth: totalResults && (totalResults.succ + totalResults.fail) > 0
          ? parseFloat(totalResults.bytes) / (totalResults.succ + totalResults.fail)
          : undefined,
        // Convert all percentiles from seconds to milliseconds
        percentiles: totalResults ? {
          p0: parseFloat(totalResults.p0_0) * 1000,
          p50: parseFloat(totalResults.p50_0) * 1000,
          p90: parseFloat(totalResults.p90_0) * 1000,
          p95: parseFloat(totalResults.p95_0) * 1000,
          p99: parseFloat(totalResults.p99_0) * 1000,
          p99_9: parseFloat(totalResults.p99_9) * 1000,
          p100: parseFloat(totalResults.p100_0) * 1000,
        } : undefined,
      };

      setBaselineTestRun(baselineTestRun);
      localStorage.setItem(`baseline-${testId}`, JSON.stringify(baselineTestRun));
    } else if (!baselineData.baselineId && baselineTestRun) {
      // Clear baseline if API indicates no baseline is set
      setBaselineTestRun(null);
      localStorage.removeItem(`baseline-${testId}`);
    }
  }, [baselineData, testId, baselineTestRun?.testRunId]);

  // Cleanup: Cancel progressive loading on component unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleSetBaseline = useCallback(
    async (selectedItems: TestRun[]) => {
      if (selectedItems.length === 0) return;

      try {
        await setBaseline({ testId, testRunId: selectedItems[0].testRunId }).unwrap();
        const newBaseline = { ...selectedItems[0], isBaseline: true };
        setBaselineTestRun(newBaseline);
        localStorage.setItem(`baseline-${testId}`, JSON.stringify(newBaseline));
      } catch (error) {
        const apiError = error as ApiError;
        dispatch(addNotification({
          id: `baseline-error-${Date.now()}`,
          type: "error",
          content: `Unable to set baseline: ${apiError?.message || "Please try again"}`
        }));
      }
    },
    [setBaseline, testId]
  );

  const handleRemoveBaseline = useCallback(async () => {
    if (!baselineTestRun) return;

    try {
      await removeBaseline({ testId }).unwrap();
      setBaselineTestRun(null);
      localStorage.removeItem(`baseline-${testId}`);
    } catch (error) {
      console.error("Failed to remove baseline:", error);
    }
  }, [removeBaseline, testId, baselineTestRun]);

  const debouncedDateFilterChange = useCallback(
    (dateRange: DateRange | null) => {
      // Cancel ongoing progressive loading when filter changes
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      setDateFilter(dateRange);
      dateRange
        ? localStorage.setItem(`dateFilter-${testId}`, JSON.stringify(dateRange))
        : localStorage.removeItem(`dateFilter-${testId}`);
      // Clear existing data to trigger fresh load with new filter
      setAllTestRuns([]);
    },
    [testId]
  );

  const handleDateFilterChange = useMemo(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    return (dateRange: DateRange | null) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => debouncedDateFilterChange(dateRange), DEBOUNCE_DELAY);
    };
  }, [debouncedDateFilterChange]);

  return {
    dateFilter,
    baselineTestRun,
    allTestRuns,
    isLoadingMore,
    isLoading,
    error,
    baselineError,
    firstPageData,
    isSettingBaseline,
    isRemovingBaseline,
    handleSetBaseline,
    handleRemoveBaseline,
    handleDateFilterChange,
    refetch,
  };
};
