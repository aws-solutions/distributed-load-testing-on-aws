// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef } from "react";
import { sendConsoleMetric } from "../utils/consoleMetrics.ts";

/**
 * Emits two one-shot console metrics for page load performance:
 *
 * - **PageInitialLoad** – fired on first render (before async data).
 *   Includes only `Page`, `LatencyMs`, and optionally `TestId`.
 * - **PageDataReady** – fired once `dataReady` flips to `true`.
 *   Includes everything from PageInitialLoad plus any `extra` fields.
 *
 * @param page - Logical page name used as the `Page` dimension in both metrics.
 * @param options.dataReady - Set to `true` once async data has loaded successfully.
 *        Gate on `!error` as well as `!isLoading` so a failed query does not
 *        trigger a PageDataReady metric.
 * @param options.testId - Optional test/scenario ID appended as `TestId`.
 * @param options.extra - Optional parameter that allows callers to attach 
 *        page-specific metadata to the data-ready metric. The specified 
 *        key-value pairs spread into the PageDataReady metric only (omitted from 
 *        PageInitialLoad because data-dependent values would be stale on first 
 *        render).
 */
export function usePageLoadMetric(
  page: string,
  { dataReady, testId, extra }: { dataReady: boolean; testId?: string; extra?: Record<string, unknown> },
) {
  const startTime = useRef(performance.now());
  const initialSent = useRef(false);
  const dataSent = useRef(false);
  const extraRef = useRef(extra);
  extraRef.current = extra;

  // The following effects omit extras (e.g. BaselineEnabled, McpEnabled) from PageInitialLoad.
  // Extra is only included in PageDataReady, where dataReady gates on the extra data actually being available.
  useEffect(() => {
    if (initialSent.current) return;
    initialSent.current = true;
    const elapsed = Math.round(performance.now() - startTime.current);
    sendConsoleMetric("PageInitialLoad", { Page: page, LatencyMs: elapsed, ...(testId && { TestId: testId }) });
  }, [page, testId]);

  useEffect(() => {
    if (!dataReady || dataSent.current) return;
    dataSent.current = true;
    const elapsed = Math.round(performance.now() - startTime.current);
    sendConsoleMetric("PageDataReady", { Page: page, LatencyMs: elapsed, ...(testId && { TestId: testId }), ...extraRef.current });
  }, [dataReady, page, testId]);
}
