// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { parseJmeterKpiJtl } from "../../src/results/jmeter-reducer.js";
import type { KpiRow } from "../../src/results/reduce-kpi-rows.js";

// The header a real JMeter 5.6.3 run wrote with the properties jmeter-args.ts
// pins, copied from that run verbatim. Latency, IdleTime and Connect sit at the
// end here, but the parser reads by name because that order is not guaranteed.
const HEADER =
  "timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success," +
  "failureMessage,bytes,sentBytes,grpThreads,allThreads,URL,Latency,IdleTime,Connect";

/** Two consecutive samples from that same run. */
const REAL_ROWS = [
  "1787014652524,762,Sleep,200,OK,TG 1-1,text,true,,2,0,2,2,null,0,0,0",
  "1787014653025,508,Sleep,200,OK,TG 1-2,text,true,,2,0,3,3,null,0,0,0",
] as const;

function jtlStream(...lines: readonly string[]): Readable {
  return Readable.from([`${lines.join("\n")}\n`]);
}

async function collect(source: Readable): Promise<KpiRow[]> {
  const rows: KpiRow[] = [];
  for await (const row of parseJmeterKpiJtl(source)) rows.push(row);
  return rows;
}

describe("parseJmeterKpiJtl", () => {
  it("maps a real sample row", async () => {
    const rows = await collect(jtlStream(HEADER, REAL_ROWS[0]));

    expect(rows).toEqual([
      {
        timeStamp: 1_787_014_652_524,
        elapsed: 762,
        label: "Sleep",
        responseCode: "200",
        success: true,
        bytes: 2,
        allThreads: 2,
        latency: 0,
        connect: 0,
      },
    ]);
  });

  it("yields one row per sample", async () => {
    const rows = await collect(jtlStream(HEADER, ...REAL_ROWS));

    expect(rows.map((row) => row.timeStamp)).toEqual([1_787_014_652_524, 1_787_014_653_025]);
  });

  it("reads the timestamp as milliseconds, the way saveservice is configured", async () => {
    const rows = await collect(jtlStream(HEADER, "1787014652524,10,/api,200,OK,TG 1-1,text,true,,0,0,1,1,null,0,0,0"));

    expect(rows[0]?.timeStamp).toBe(1_787_014_652_524);
  });

  it("reads latency and connect time when the sampler measures them", async () => {
    const rows = await collect(
      jtlStream(HEADER, "1787014652524,120,/api,200,OK,TG 1-1,text,true,,512,64,4,9,http://x/,45,0,12")
    );

    expect(rows[0]).toMatchObject({ elapsed: 120, latency: 45, connect: 12, bytes: 512, allThreads: 9 });
  });

  // allThreads is the engine-wide count reduceKpiRows turns into concurrency;
  // grpThreads only counts one thread group and must not be read instead.
  it("reads allThreads, not grpThreads", async () => {
    const rows = await collect(jtlStream(HEADER, "1787014652524,10,/api,200,OK,TG 1-1,text,true,,0,0,3,17,null,0,0,0"));

    expect(rows[0]?.allThreads).toBe(17);
  });

  it("reads columns by name, whatever order they arrive in", async () => {
    const rows = await collect(
      jtlStream("elapsed,Connect,label,timeStamp,success,Latency", "99,7,/reordered,5,true,8")
    );

    expect(rows[0]).toMatchObject({ timeStamp: 5, elapsed: 99, label: "/reordered", latency: 8, connect: 7 });
  });

  describe("response codes", () => {
    it("keeps an HTTP status as written", async () => {
      const rows = await collect(
        jtlStream(HEADER, "1787014652524,10,/api,503,Service Unavailable,TG 1-1,text,false,,0,0,1,1,null,0,0,0")
      );

      expect(rows[0]).toMatchObject({ responseCode: "503", success: false });
    });

    // A request that never reached the server has no status code. JMeter writes a
    // description instead, and dlt.result.v1 types responseCodes as a string so
    // the console can group by it unchanged.
    it("keeps JMeter's text code for a request that never got a response", async () => {
      const rows = await collect(
        jtlStream(
          HEADER,
          '1787014652524,20,/api,"Non HTTP response code: java.net.ConnectException",' +
            '"Non HTTP response message: Connection refused",TG 1-1,text,false,,0,0,1,1,null,0,0,0'
        )
      );

      expect(rows[0]?.responseCode).toBe("Non HTTP response code: java.net.ConnectException");
    });

    it("survives a quoted field containing commas", async () => {
      const rows = await collect(
        jtlStream(HEADER, '1787014652524,20,"Checkout, then pay",200,OK,TG 1-1,text,true,,0,0,1,1,null,0,0,0')
      );

      expect(rows[0]).toMatchObject({ label: "Checkout, then pay", responseCode: "200" });
    });
  });

  describe("success", () => {
    it.each([
      ["true", true],
      ["false", false],
      ["", false],
      ["TRUE", false],
    ])("reads %p as %p", async (written, expected) => {
      const rows = await collect(
        jtlStream(HEADER, `1787014652524,10,/api,200,OK,TG 1-1,text,${written},,0,0,1,1,null,0,0,0`)
      );

      expect(rows[0]?.success).toBe(expected);
    });
  });

  describe("when the file is not intact", () => {
    // The abort path SIGKILLs JMeter, so the last line can stop anywhere.
    it("keeps the rows before a line cut off mid-write", async () => {
      const rows = await collect(jtlStream(HEADER, REAL_ROWS[0], "1787014653289,506,Sleep,200,OK,TG 1"));

      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ elapsed: 506, label: "Sleep", allThreads: 0, success: false });
    });

    it("drops a row with no response time rather than counting it as 0ms", async () => {
      const rows = await collect(jtlStream(HEADER, "1787014652524,,/api,200,OK,TG 1-1,text,true,,0,0,1,1,null,0,0,0"));

      expect(rows).toEqual([]);
    });

    it("drops a row with no timestamp rather than dating it to 1970", async () => {
      const rows = await collect(jtlStream(HEADER, ",10,/api,200,OK,TG 1-1,text,true,,0,0,1,1,null,0,0,0"));

      expect(rows).toEqual([]);
    });

    it.each([["nan"], ["inf"], ["not-a-number"]])("drops a row whose response time reads %p", async (elapsed) => {
      const rows = await collect(
        jtlStream(HEADER, `1787014652524,${elapsed},/api,200,OK,TG 1-1,text,true,,0,0,1,1,null,0,0,0`)
      );

      expect(rows).toEqual([]);
    });

    it.each([["-1"], ["86400001"]])("drops an out-of-range response time %p", async (elapsed) => {
      const rows = await collect(
        jtlStream(HEADER, `1787014652524,${elapsed},/api,200,OK,TG 1-1,text,true,,0,0,1,1,null,0,0,0`)
      );

      expect(rows).toEqual([]);
    });

    it("falls back to 0 for measurements it cannot read", async () => {
      const rows = await collect(
        jtlStream(HEADER, "1787014652524,10,/api,200,OK,TG 1-1,text,true,,-1,0,1,-1,null,-1,0,86400001")
      );

      expect(rows[0]).toMatchObject({ bytes: 0, allThreads: 0, latency: 0, connect: 0 });
    });

    it("yields nothing for an empty file", async () => {
      expect(await collect(Readable.from([]))).toEqual([]);
    });

    it("yields nothing for a file with only a header", async () => {
      expect(await collect(jtlStream(HEADER))).toEqual([]);
    });

    // A read failure has to reach the caller. pipe() does not forward it, and a
    // parser that never ends would hang reduce() and with it the whole test.
    it("rejects when the source fails instead of hanging", async () => {
      const source = new Readable({
        read() {
          this.destroy(new Error("EIO: i/o error"));
        },
      });

      await expect(collect(source)).rejects.toThrow("EIO: i/o error");
    });
  });
});
