// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Reads the sidecar's kpi.csv and yields one row per request, for
// reduceKpiRows() to aggregate.
//
// The sidecar writes 11 columns; we use 7 of them. Locust doesn't measure time
// to first byte or connect time separately, so those are always 0.
//
// This parser never throws on bad input. If the container is killed while the
// sidecar is writing, the last line of the file is cut off mid-row. Throwing
// there would skip the completion marker that tells DLT the task finished, and
// the test would hang forever. So we accept short rows and drop any row we
// can't read.

import { MAX_LATENCY_US } from "@amzn/dlt-common/streaming-statistics";
import { parse } from "csv-parse";
import type { Readable } from "node:stream";

import type { KpiRow } from "./reduce-kpi-rows.js";

export async function* parseLocustKpiCsv(source: Readable): AsyncGenerator<KpiRow, void, void> {
  const parser = parse({
    columns: true,
    skip_empty_lines: true,
    trim: true,
    // Don't throw on a row with too few columns. Missing fields arrive as
    // undefined, and toRow() drops the row if it can't use them.
    relax_column_count: true,
    skip_records_with_error: true,
  });

  source.pipe(parser);
  // pipe() doesn't pass errors along, so if reading the file fails the parser
  // never ends and the loop below waits forever. Forward the error instead —
  // reduce() can handle a rejection, but it can't recover from hanging.
  source.on("error", (error: Error) => parser.destroy(error));

  try {
    for await (const raw of parser) {
      const row = toRow(raw as Record<string, string | undefined>);
      if (row !== undefined) yield row;
    }
  } finally {
    // The consumer can stop before the end of the file, and then nothing else
    // closes it. destroy() is idempotent and unpipes on its way out.
    source.destroy();
  }
}

/** Returns undefined if a required field is missing or invalid. */
function toRow(raw: Record<string, string | undefined>): KpiRow | undefined {
  const timestampSeconds = parseMeasurement(raw["timestamp"]);
  const elapsed = parseMeasurement(raw["response_time_ms"]);
  const latencyUs = Math.round((elapsed ?? -1) * 1_000);
  if (
    timestampSeconds === undefined ||
    elapsed === undefined ||
    elapsed < 0 ||
    !Number.isSafeInteger(latencyUs) ||
    latencyUs > MAX_LATENCY_US
  ) {
    return undefined;
  }

  return {
    timeStamp: Math.round(timestampSeconds * 1_000),
    elapsed,
    label: raw["name"] ?? "",
    responseCode: responseCodeOf(raw),
    success: raw["success"] === "true",
    bytes: parseOptionalNonnegativeInteger(raw["response_length_bytes"]),
    allThreads: parseMeasurement(raw["user_count"]) ?? 0,
    latency: 0,
    connect: 0,
  };
}

/**
 * The HTTP status code, or the name of whatever went wrong if there wasn't one.
 *
 * A request that never reached the server has no status code — the connection was
 * refused, or it timed out. Locust records the exception class name for those, so
 * the report says ConnectionRefusedError.
 */
function responseCodeOf(raw: Record<string, string | undefined>): string {
  const statusCode = raw["status_code"] ?? "";
  const exceptionType = raw["exception_type"] ?? "";
  if (statusCode !== "" && statusCode !== "0") return statusCode;
  return exceptionType === "" ? statusCode : exceptionType;
}

/**
 * Reads one numeric CSV field, returning undefined if there's no usable number
 * there. Callers decide what a missing value means — drop the row, or fall back
 * to zero.
 *
 * The explicit empty check is the important part. `Number("")` is 0, not NaN, so
 * without it a blank or cut-off field would look like a real measurement: a
 * response time of 0 ms, or a timestamp in 1970. Those would then be averaged
 * into the results. Better to know the value is missing than to invent one.
 *
 * The isFinite check covers the rest: text, and the `inf` / `nan` that Python
 * writes for non-finite floats.
 */
function parseMeasurement(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parseOptionalNonnegativeInteger(raw: string | undefined): number {
  const value = parseMeasurement(raw);
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
