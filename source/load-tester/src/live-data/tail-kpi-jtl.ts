// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Tails the CSV JTL that JMeter writes while a test is running.
//
// JMeter creates the file when the first sample completes and flushes each row as
// it goes (autoflush=true, pinned in jmeter-args.ts), so we keep one FileHandle
// open, remember the byte offset between polls, and drain once more after the
// signal says JMeter has exited.
//
// Rows are mapped by the same toKpiRow() the final reducer uses, so live data and
// the uploaded result cannot disagree about what a column means.

import { open, type FileHandle } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { parse, type Parser } from "csv-parse";

import { toKpiRow } from "../results/jmeter-reducer.js";
import type { JMeterLiveDataAggregator } from "./jmeter-aggregator.js";

const DEFAULT_POLL_INTERVAL_MILLISECONDS = 250;
const READ_BUFFER_BYTES = 64 * 1024;

export interface TailJMeterKpiJtlInput {
  readonly kpiJtlPath: string;
  readonly aggregator: JMeterLiveDataAggregator;
  /** Fires after JMeter has stopped writing, triggering one final file drain. */
  readonly signal: AbortSignal;
  readonly pollIntervalMilliseconds?: number;
}

export interface TailJMeterKpiJtlStats {
  /** Rows that reached the aggregator. */
  readonly parsedRowCount: number;
  /** Rows with no usable timestamp or response time, e.g. a truncated last line. */
  readonly unreadableRowCount: number;
  /** Rows the aggregator refused because their second was already emitted. */
  readonly lateRowCount: number;
  /** 1 if malformed CSV ended the live feed early. Results are unaffected. */
  readonly parseErrorCount: number;
}

interface MutableStats {
  parsedRowCount: number;
  unreadableRowCount: number;
  lateRowCount: number;
  parseErrorCount: number;
}

/**
 * Follows the JTL until the signal says JMeter has stopped writing. Abort starts
 * one final drain rather than cancelling it, so the samples JMeter flushed on its
 * way out still reach live data.
 */
export async function tailJMeterKpiJtl(input: TailJMeterKpiJtlInput): Promise<TailJMeterKpiJtlStats> {
  const interval = input.pollIntervalMilliseconds ?? DEFAULT_POLL_INTERVAL_MILLISECONDS;
  const stats: MutableStats = { parsedRowCount: 0, unreadableRowCount: 0, lateRowCount: 0, parseErrorCount: 0 };
  const file = await waitForFile(input.kpiJtlPath, interval, input.signal);

  if (file === undefined) return stats;

  const parser = newParser();
  // Consume in parallel with the polling below. csv-parse emits records on its own
  // schedule, not inside write(), so awaiting this before the final flush is what
  // guarantees every row is in a bucket before the last bucket is emitted.
  const consuming = consumeRows(parser, input.aggregator, stats);

  let position = 0;
  try {
    while (!input.signal.aborted) {
      position = await readAvailable(file, position, parser);
      input.aggregator.tick(Date.now());
      await wait(interval, input.signal);
    }

    await readAvailable(file, position, parser);
  } finally {
    // end() releases whatever csv-parse is still holding — a final row with no
    // trailing newline is complete data and has to be counted.
    parser.end();
    await consuming;
    try {
      await file.close();
    } finally {
      input.aggregator.flush(Date.now());
    }
  }

  return stats;
}

/**
 * One parser for the whole run, because the header arrives once and its column
 * order defines every row after it.
 */
function newParser(): Parser {
  return parse({
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
}

/**
 * Drains the parser until it ends. A parse error stops the live feed and is
 * counted, never thrown: live data is best-effort, and the uploaded result comes
 * from reading the same file again in reduce().
 */
async function consumeRows(parser: Parser, aggregator: JMeterLiveDataAggregator, stats: MutableStats): Promise<void> {
  try {
    for await (const raw of parser) {
      const row = toKpiRow(raw as Record<string, string | undefined>);
      if (row === undefined) {
        stats.unreadableRowCount += 1;
        continue;
      }
      if (aggregator.add(row)) stats.parsedRowCount += 1;
      else stats.lateRowCount += 1;
    }
  } catch {
    stats.parseErrorCount += 1;
  }
}

/**
 * Waits because JMeter only creates the JTL once it has something to write. A
 * missing file is normal while the test is starting; after abort, the last open
 * attempt decides whether there is anything to drain.
 */
async function waitForFile(
  path: string,
  intervalMilliseconds: number,
  signal: AbortSignal
): Promise<FileHandle | undefined> {
  for (;;) {
    try {
      // Try before checking the signal so a test that is aborted the moment the
      // file appears still gets one final read.
      return await open(path, "r");
    } catch {
      if (signal.aborted) return undefined;
      await wait(intervalMilliseconds, signal);
    }
  }
}

/**
 * Reads everything available after the saved byte offset and returns the new
 * offset. Chunks are handed to the parser as Buffers, which is also what makes a
 * multi-byte character split across two reads safe: csv-parse joins the bytes
 * before decoding a field.
 */
async function readAvailable(file: FileHandle, position: number, parser: Parser): Promise<number> {
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  let offset = position;

  for (;;) {
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    if (bytesRead === 0) return offset;

    offset += bytesRead;
    // Copy: write() is asynchronous internally, and the next read would otherwise
    // overwrite these bytes underneath the parser.
    parser.write(Buffer.from(buffer.subarray(0, bytesRead)));
  }
}

async function wait(intervalMilliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;

  try {
    await sleep(intervalMilliseconds, undefined, { signal });
  } catch {
    // Abort is the normal way the runner ends a long poll.
  }
}
