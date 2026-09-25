// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Reads JMeter's kpi.jtl and yields one row per sample, for reduceKpiRows() to
// aggregate.
//
// https://jmeter.apache.org/usermanual/listeners.html#csvlogformat

import { MAX_LATENCY_US } from "@amzn/dlt-common/streaming-statistics";
import { parse } from "csv-parse";
import type { Readable } from "node:stream";
import type { KpiRow } from "./reduce-kpi-rows.js";

export async function* parseJmeterKpiJtl(source: Readable): AsyncGenerator<KpiRow, void, void> {
  const parser = parse({
    columns: true,
    skip_empty_lines: true,
    trim: true,
    // Don't throw on a row with too few columns. Missing fields arrive as
    // undefined, and toRow() drops the row if it can't use them.
    relax_column_count: true,
  });

  source.pipe(parser);
  // pipe() doesn't pass errors along, so if reading the file fails the parser
  // never ends and the loop below waits forever. Forward the error instead —
  // reduce() can handle a rejection, but it can't recover from hanging.
  source.on("error", (error: Error) => parser.destroy(error));

  for await (const raw of parser) {
    const row = toKpiRow(raw as Record<string, string | undefined>);
    if (row !== undefined) yield row;
  }
}

/**
 * Maps one parsed JTL record to a KpiRow.
 *
 * Returns undefined if the timestamp or the response time is missing or
 * unreadable, which in practice means a row cut in half by a SIGKILL.
 *
 * Those two are the only fields worth dropping a row over: `elapsed` goes
 * straight into the percentiles, and `timeStamp` is what the live-data path
 * buckets on. The rest fall back to 0, the same value KpiRow already uses for a
 * measurement the framework does not report.
 */
export function toKpiRow(raw: Record<string, string | undefined>): KpiRow | undefined {
  const timeStamp = parseMeasurement(raw["timeStamp"]);
  const elapsed = parseDurationMilliseconds(raw["elapsed"]);
  if (timeStamp === undefined || elapsed === undefined) return undefined;

  return {
    timeStamp,
    elapsed,
    label: raw["label"] ?? "",
    // Passed through as written. JMeter puts an HTTP status here when there was
    // one and a description when there wasn't, e.g. "Non HTTP response code:
    // java.net.ConnectException" — dlt.result.v1's responseCodes is typed as a
    // string for exactly this reason, and the console groups by whatever it says.
    responseCode: raw["responseCode"] ?? "",
    // JMeter writes the literal "true" or "false"; anything else is a row we did
    // not read correctly, so treat it as a failure rather than a success.
    success: raw["success"] === "true",
    bytes: parseNonnegativeInteger(raw["bytes"]) ?? 0,
    // Threads live in the whole engine, not one thread group: allThreads is the
    // count reduceKpiRows reports as concurrency.
    allThreads: Math.max(parseMeasurement(raw["allThreads"]) ?? 0, 0),
    latency: parseDurationMilliseconds(raw["Latency"]) ?? 0,
    connect: parseDurationMilliseconds(raw["Connect"]) ?? 0,
  };
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
 */
function parseMeasurement(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parseDurationMilliseconds(raw: string | undefined): number | undefined {
  const value = parseMeasurement(raw);
  const microseconds = Math.round((value ?? -1) * 1_000);
  return value !== undefined && value >= 0 && Number.isSafeInteger(microseconds) && microseconds <= MAX_LATENCY_US
    ? value
    : undefined;
}

function parseNonnegativeInteger(raw: string | undefined): number | undefined {
  const value = parseMeasurement(raw);
  return value !== undefined && value >= 0 && Number.isSafeInteger(value) ? value : undefined;
}
