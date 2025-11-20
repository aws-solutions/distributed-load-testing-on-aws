// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useMemo } from "react";
import { BaselineResponse, TestRunDetails } from "../types/testResults";
import { ProcessedTableData, ViewMode } from "../types/viewMode";
import {
  calculateAggregatedBaseline,
  calculateBaselineComparison,
  findMatchingBaselineData,
} from "../utils/testResultsComparators";
import { transformToTableRows } from "../utils/testResultsTransformers";

/**
 * Custom hook that encapsulates all business logic for test results data processing.
 * Separates data transformation and baseline calculations from UI presentation.
 *
 * @param testRun - Raw test run data from API
 * @param baseline - Raw baseline data from API
 * @param viewMode - Current view mode (overall, byEndpoint, byRegion)
 * @returns Processed data ready for UI consumption
 */
export function useTestResultsData(
  testRun: TestRunDetails | undefined,
  baseline: BaselineResponse | undefined,
  viewMode: ViewMode
): ProcessedTableData {
  return useMemo(() => {
    // Early return if no test run data
    if (!testRun) {
      return {
        rows: [],
        baselineComparisons: new Map(),
        aggregatedBaseline: null,
      };
    }

    // Transform raw data to table rows based on view mode
    const rows = transformToTableRows(testRun, viewMode);

    // Calculate aggregated baseline for header display
    const aggregatedBaseline = calculateAggregatedBaseline(baseline);

    // Pre-compute baseline comparisons for all rows
    const baselineComparisons = new Map<string, ReturnType<typeof calculateBaselineComparison>>();

    rows.forEach((row) => {
      const baselineData = findMatchingBaselineData(row.region, row.testLabel, baseline, viewMode);

      const comparison = calculateBaselineComparison(row, baselineData);

      baselineComparisons.set(row.id, comparison);
    });

    return {
      rows,
      baselineComparisons,
      aggregatedBaseline,
    };
  }, [testRun, baseline, viewMode]);
}
