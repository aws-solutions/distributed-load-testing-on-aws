// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { parseLocustKpiCsv } from "../../src/results/locust-reducer.js";
import type { KpiResultContext, KpiRow } from "../../src/results/reduce-kpi-rows.js";
import { reduceKpiRows } from "../../src/results/reduce-kpi-rows.js";

// The columns the sidecar writes, in order.
const HEADER =
  "timestamp,method,name,response_time_ms,response_length_bytes,status_code,success," +
  "exception_type,exception_message,user_count,context_json";

const CONTEXT: KpiResultContext = {
  testId: "test-123",
  taskId: "task-1",
  region: "us-east-1",
  startedAt: new Date("2026-08-26T12:00:00.000Z"),
  endedAt: new Date("2026-08-26T12:01:00.000Z"),
  task: { vcpus: 2, memoryMiB: 4096, ecsDurationSeconds: 70 },
};

function csvStream(...lines: readonly string[]): Readable {
  return Readable.from([`${lines.join("\n")}\n`]);
}

async function collect(source: Readable): Promise<KpiRow[]> {
  const rows: KpiRow[] = [];
  for await (const row of parseLocustKpiCsv(source)) rows.push(row);
  return rows;
}

describe("parseLocustKpiCsv", () => {
  it("maps a successful request row", async () => {
    const rows = await collect(csvStream(HEADER, "1700000000.5,GET,/api,123.4,2048,200,true,,,25,"));

    expect(rows).toEqual([
      {
        timeStamp: 1_700_000_000_500,
        elapsed: 123.4,
        label: "/api",
        responseCode: "200",
        success: true,
        bytes: 2048,
        allThreads: 25,
        latency: 0,
        connect: 0,
      },
    ]);
  });

  it("converts the timestamp from seconds to milliseconds", async () => {
    const rows = await collect(csvStream(HEADER, "1700000001,GET,/,10,0,200,true,,,1,"));

    expect(rows[0]?.timeStamp).toBe(1_700_000_001_000);
  });

  // The rows below were captured from real Locust runs against a closed port and
  // against a local server returning 503 — not hand-written. An earlier version of
  // this test put "ConnectionError" in the status_code column, which the sidecar
  // never does, and so it passed while the code was wrong.
  it("falls back to the exception name when a request never got a status code", async () => {
    const rows = await collect(
      csvStream(
        HEADER,
        "1785470860.7180502,GET,/dead,0.7332919999498699,0,0,false,ConnectionRefusedError,[Errno 111] Connection refused,2,"
      )
    );

    expect(rows[0]?.success).toBe(false);
    expect(rows[0]?.responseCode).toBe("ConnectionRefusedError");
  });

  it("keeps the status code when the server answered with an error", async () => {
    const rows = await collect(
      csvStream(
        HEADER,
        "1785470876.3995316,GET,/bad,1.157833999968716,3,503,false,HTTPError,503 Server Error: Service Unavailable for url: /bad,2,"
      )
    );

    expect(rows[0]?.success).toBe(false);
    expect(rows[0]?.responseCode).toBe("503");
  });

  it('treats any success value other than "true" as a failure', async () => {
    const rows = await collect(
      csvStream(
        HEADER,
        "1700000000,GET,/,10,0,200,false,,,1,",
        "1700000000,GET,/,10,0,200,TRUE,,,1,",
        "1700000000,GET,/,10,0,200,,,,1,"
      )
    );

    expect(rows.map((r) => r.success)).toEqual([false, false, false]);
  });

  it("always reports latency and connect as 0", async () => {
    const rows = await collect(csvStream(HEADER, "1700000000,GET,/,10,0,200,true,,,1,"));

    expect(rows[0]?.latency).toBe(0);
    expect(rows[0]?.connect).toBe(0);
  });

  it("yields nothing for a header-only file", async () => {
    expect(await collect(csvStream(HEADER))).toEqual([]);
  });

  it("yields nothing for a completely empty file", async () => {
    expect(await collect(Readable.from([]))).toEqual([]);
  });

  it("drops a malformed final row without throwing", async () => {
    // This is what the file looks like when the container is killed while the
    // sidecar is writing — the last line just stops. csv-parse would throw on
    // it by default.
    const rows = await collect(csvStream(HEADER, "1700000000,GET,/,10,0,200,true,,,1,", '"unterminated'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.timeStamp).toBe(1_700_000_000_000);
  });

  it("keeps a short row that still has a timestamp and response time", async () => {
    const rows = await collect(csvStream(HEADER, "1700000000,GET,/api,75"));

    expect(rows).toEqual([
      {
        timeStamp: 1_700_000_000_000,
        elapsed: 75,
        label: "/api",
        responseCode: "",
        success: false,
        bytes: 0,
        allThreads: 0,
        latency: 0,
        connect: 0,
      },
    ]);
  });

  it("skips rows whose timestamp or response time isn't a number", async () => {
    const rows = await collect(
      csvStream(
        HEADER,
        "not-a-number,GET,/,10,0,200,true,,,1,",
        "1700000000,GET,/,not-a-number,0,200,true,,,1,",
        ",GET,/,10,0,200,true,,,1,",
        "1700000002,GET,/ok,10,0,200,true,,,1,"
      )
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("/ok");
  });

  it("drops a row with a blank timestamp instead of reading it as 1970", async () => {
    // Number("") is 0, so a blank field would otherwise look like a real
    // measurement and get averaged into the results.
    const rows = await collect(csvStream(HEADER, ",GET,/,10,0,200,true,,,1,", "1700000000,GET,/,,0,200,true,,,1,"));

    expect(rows).toEqual([]);
  });

  it("drops rows with the inf and nan values Python writes for non-finite floats", async () => {
    const rows = await collect(
      csvStream(HEADER, "inf,GET,/,10,0,200,true,,,1,", "1700000000,GET,/,nan,0,200,true,,,1,")
    );

    expect(rows).toEqual([]);
  });

  it("drops response times the accumulator cannot represent", async () => {
    const rows = await collect(
      csvStream(
        HEADER,
        "1700000000,GET,/negative,-1,0,200,true,,,1,",
        "1700000000,GET,/too-large,86400001,0,200,true,,,1,"
      )
    );

    expect(rows).toEqual([]);
  });

  it("falls back to 0 when byte and user counts aren't numbers", async () => {
    const rows = await collect(csvStream(HEADER, "1700000000,GET,/,10,garbage,200,true,,,garbage,"));

    expect(rows[0]?.bytes).toBe(0);
    expect(rows[0]?.allThreads).toBe(0);
  });

  it("does not throw on non-CSV garbage", async () => {
    // The header line is nonsense, so no column names match and every row gets
    // dropped. What matters is that reduce() sees an empty file, not an error.
    const rows = await collect(Readable.from(["this is not a csv file at all\n\x00\x01binary\n"]));

    expect(rows).toEqual([]);
  });

  it("skips blank lines between rows", async () => {
    const rows = await collect(
      csvStream(HEADER, "1700000000,GET,/a,10,0,200,true,,,1,", "", "1700000001,GET,/b,20,0,200,true,,,1,")
    );

    expect(rows.map((r) => r.label)).toEqual(["/a", "/b"]);
  });

  it("trims surrounding whitespace in fields", async () => {
    const rows = await collect(csvStream(HEADER, " 1700000000 ,GET, /api , 10 ,0,200,true,,,1,"));

    expect(rows[0]?.timeStamp).toBe(1_700_000_000_000);
    expect(rows[0]?.label).toBe("/api");
    expect(rows[0]?.elapsed).toBe(10);
  });

  it("propagates a stream error rather than hanging", async () => {
    const failing = new Readable({
      read() {
        this.destroy(new Error("disk read failure"));
      },
    });

    await expect(collect(failing)).rejects.toThrow(/disk read failure/);
  });

  it("preserves valid rows when the source fails later", async () => {
    const source = new PassThrough();
    let markRowConsumed!: () => void;
    const rowConsumed = new Promise<void>((resolve) => {
      markRowConsumed = resolve;
    });
    async function* observedRows(): AsyncGenerator<KpiRow> {
      for await (const row of parseLocustKpiCsv(source)) {
        yield row;
        markRowConsumed();
      }
    }

    const reduction = reduceKpiRows(observedRows(), CONTEXT);
    // Two rows: the parser holds the last record it has seen until more data
    // arrives or the stream ends, so a single row would never reach reduce().
    source.write(`${HEADER}\n1700000000,GET,/api,100,1024,200,true,,,10,\n1700000001,GET,/cut-off,`);
    await rowConsumed;
    source.destroy(new Error("disk read failure"));
    const result = await reduction;

    expect(result.summary.totalRequestCount).toBe(1);
    expect(result.labels).toHaveLength(1);
    expect(result.labels[0]?.label).toBe("/api");
  });

  it("destroys the source when the consumer stops before EOF", async () => {
    const source = new PassThrough();
    const rows = parseLocustKpiCsv(source);
    const firstRow = rows.next();
    source.write(`${HEADER}\n1700000000,GET,/api,100,1024,200,true,,,10,\n1700000001,GET,/next,`);

    expect((await firstRow).done).toBe(false);
    await rows.return();

    expect(source.destroyed).toBe(true);
  });
});
