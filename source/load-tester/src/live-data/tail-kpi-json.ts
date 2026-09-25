// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Tails the NDJSON file k6 writes while a test is running.
//
// k6 may create the file after the process starts and may stop with its final
// JSON object lacking a newline. We therefore keep one FileHandle open, remember
// the byte offset and unfinished trailing bytes between polls, and perform one
// final drain after the signal says k6 has exited.
//
// Format: https://grafana.com/docs/k6/v1.5.x/results-output/real-time/json/

import { open, type FileHandle } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import type { K6LiveDataAggregator, K6LiveDataPoint } from "./k6-aggregator.js";

const DEFAULT_POLL_INTERVAL_MILLISECONDS = 250;
const READ_BUFFER_BYTES = 64 * 1024;

export interface TailK6KpiJsonInput {
  readonly kpiJsonPath: string;
  readonly aggregator: K6LiveDataAggregator;
  /** Fires after k6 has stopped writing, triggering one final file drain. */
  readonly signal: AbortSignal;
  readonly pollIntervalMilliseconds?: number;
}

export interface TailK6KpiJsonStats {
  readonly parsedPointCount: number;
  readonly malformedLineCount: number;
  readonly unsupportedLineCount: number;
}

interface MutableStats {
  parsedPointCount: number;
  malformedLineCount: number;
  unsupportedLineCount: number;
}

interface ReadState {
  readonly position: number;
  readonly partial: Buffer;
}

/**
 * Follows k6's output until the signal says the process has stopped writing.
 * Abort starts one final drain rather than cancelling it, so the last complete
 * Point and a complete final line without a newline still reach live data.
 */
export async function tailK6KpiJson(input: TailK6KpiJsonInput): Promise<TailK6KpiJsonStats> {
  const interval = input.pollIntervalMilliseconds ?? DEFAULT_POLL_INTERVAL_MILLISECONDS;
  const stats: MutableStats = {
    parsedPointCount: 0,
    malformedLineCount: 0,
    unsupportedLineCount: 0,
  };
  const file = await waitForFile(input.kpiJsonPath, interval, input.signal);

  if (file === undefined) return stats;

  let state: ReadState = { position: 0, partial: Buffer.alloc(0) };
  try {
    while (!input.signal.aborted) {
      state = await readAvailable(file, state, input.aggregator, stats);
      input.aggregator.tick(Date.now());
      await wait(interval, input.signal);
    }

    state = await readAvailable(file, state, input.aggregator, stats);
    if (state.partial.length > 0) {
      consumeLine(state.partial.toString("utf8"), input.aggregator, stats);
    }
  } finally {
    try {
      await file.close();
    } finally {
      input.aggregator.flush(Date.now());
    }
  }

  return stats;
}

/**
 * Waits because k6 creates its output lazily. A missing file is normal while
 * the process is running; after abort, the last open attempt decides whether
 * there is anything to drain.
 */
async function waitForFile(
  path: string,
  intervalMilliseconds: number,
  signal: AbortSignal
): Promise<FileHandle | undefined> {
  for (;;) {
    try {
      // Try before checking the signal so a fast k6 run still gets one final
      // read when the file appears at the same time as process exit.
      return await open(path, "r");
    } catch {
      if (signal.aborted) return undefined;
      await wait(intervalMilliseconds, signal);
    }
  }
}

/**
 * Reads everything currently available after the saved byte offset. Complete
 * lines are consumed immediately; only bytes from the unfinished final line
 * are returned for the next poll.
 */
async function readAvailable(
  file: FileHandle,
  state: ReadState,
  aggregator: K6LiveDataAggregator,
  stats: MutableStats
): Promise<ReadState> {
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  let position = state.position;
  let partial = state.partial;

  for (;;) {
    const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;

    position += bytesRead;
    // Process each read now so a delayed poll does not copy the entire unread
    // file into memory. Only an unfinished line carries into the next read.
    const contents = Buffer.concat([partial, buffer.subarray(0, bytesRead)]);
    partial = consumeCompleteLines(contents, aggregator, stats);
  }

  return position === state.position ? state : { position, partial };
}

function consumeCompleteLines(contents: Buffer, aggregator: K6LiveDataAggregator, stats: MutableStats): Buffer {
  let lineStart = 0;

  for (let index = 0; index < contents.length; index += 1) {
    if (contents[index] !== 0x0a) continue;

    let lineEnd = index;
    if (lineEnd > lineStart && contents[lineEnd - 1] === 0x0d) lineEnd -= 1;
    if (lineEnd > lineStart) {
      consumeLine(contents.subarray(lineStart, lineEnd).toString("utf8"), aggregator, stats);
    }
    lineStart = index + 1;
  }

  // Keep trailing bytes as bytes. A read can split a UTF-8 character, and
  // decoding each half separately would corrupt otherwise valid JSON.
  return Buffer.from(contents.subarray(lineStart));
}

/**
 * Classifies one complete NDJSON line for end-of-run logging. Valid k6 records
 * that have no live-data meaning are unsupported, not malformed.
 */
function consumeLine(line: string, aggregator: K6LiveDataAggregator, stats: MutableStats): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    stats.malformedLineCount += 1;
    return;
  }

  const record = parsed as {
    readonly type?: unknown;
    readonly metric?: unknown;
    readonly data?: {
      readonly time?: unknown;
      readonly value?: unknown;
    };
  } | null;

  if (record === null || typeof record !== "object") {
    stats.malformedLineCount += 1;
    return;
  }

  // Metric declarations and future line types are valid k6 output, but they do
  // not add anything to dlt.live-data.v1.
  if (record.type !== "Point") {
    stats.unsupportedLineCount += 1;
    return;
  }

  const timestamp = typeof record.data?.time === "string" ? new Date(record.data.time).getTime() : Number.NaN;
  const value = record.data?.value;
  if (
    typeof record.metric !== "string" ||
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isFinite(timestamp)
  ) {
    stats.malformedLineCount += 1;
    return;
  }

  if (
    (record.metric === "http_reqs" || record.metric === "http_req_failed" || record.metric === "vus") &&
    !Number.isInteger(value)
  ) {
    stats.malformedLineCount += 1;
    return;
  }

  const point: K6LiveDataPoint = {
    metric: record.metric,
    timestampMilliseconds: timestamp,
    value,
  };
  if (aggregator.add(point)) stats.parsedPointCount += 1;
  else stats.unsupportedLineCount += 1;
}

async function wait(intervalMilliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;

  try {
    await sleep(intervalMilliseconds, undefined, { signal });
  } catch {
    // Abort is the normal way the runner ends a long poll.
  }
}
