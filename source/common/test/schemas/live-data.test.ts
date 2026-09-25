// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { LIVE_DATA_FILTER_MARKER, LIVE_DATA_V1_SCHEMA, parseLiveDataPoint } from "../../src/schemas/live-data";

/** A well-formed line, matching what `sidecar.py` prints. */
const validPoint = {
  _filter: LIVE_DATA_FILTER_MARKER,
  schema: LIVE_DATA_V1_SCHEMA,
  testId: "abc123",
  region: "us-east-1",
  timestamp: 1735689600000,
  vu: 10,
  succ: 137,
  fail: 3,
  avgRt: 0.04566666666666666,
};

describe("live-data", () => {
  describe("LIVE_DATA_FILTER_MARKER", () => {
    it("should contain both terms of the CloudWatch Logs subscription filter", () => {
      expect(LIVE_DATA_FILTER_MARKER).toContain("INFO: Current:");
      expect(LIVE_DATA_FILTER_MARKER).toContain("live=true");
    });
  });

  describe("parseLiveDataPoint", () => {
    it("should accept a line produced by the sidecar and pass values through unconverted", () => {
      const result = parseLiveDataPoint(JSON.stringify(validPoint));

      expect(result).toEqual(validPoint);
      // avgRt stays in seconds — converting to ms and back is not lossless.
      expect(result?.avgRt).toBe(0.04566666666666666);
    });

    it("should ignore unknown extra fields", () => {
      const result = parseLiveDataPoint(JSON.stringify({ ...validPoint, futureField: "ignored" }));

      expect(result).toEqual(validPoint);
    });

    it("should return undefined for a Taurus-format log line", () => {
      const legacyLine =
        "2025-01-01 00:00:00,000 INFO: Current: 10 vu\t140 succ\t3 fail\t0.046 avg rt\t/\tCumulative: 0.046 avg rt, 0 failures";

      expect(parseLiveDataPoint(legacyLine)).toBeUndefined();
    });

    it("should return undefined for malformed JSON", () => {
      expect(parseLiveDataPoint("{not json")).toBeUndefined();
      expect(parseLiveDataPoint("")).toBeUndefined();
    });

    it("should return undefined for JSON that is not an object", () => {
      expect(parseLiveDataPoint("null")).toBeUndefined();
      expect(parseLiveDataPoint("42")).toBeUndefined();
      expect(parseLiveDataPoint('"a string"')).toBeUndefined();
      expect(parseLiveDataPoint("[]")).toBeUndefined();
    });

    it("should return undefined for a different schema identifier", () => {
      expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, schema: "dlt.live-data.v2" }))).toBeUndefined();
      expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, schema: undefined }))).toBeUndefined();
    });

    it.each(["_filter", "testId", "region", "timestamp", "vu", "succ", "fail", "avgRt"])(
      "should return undefined when %s is missing",
      (field) => {
        const incomplete: Record<string, unknown> = { ...validPoint };
        delete incomplete[field];

        expect(parseLiveDataPoint(JSON.stringify(incomplete))).toBeUndefined();
      }
    );

    it("should return undefined when testId is not a non-empty string", () => {
      expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, testId: "" }))).toBeUndefined();
      expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, testId: "  " }))).toBeUndefined();
      expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, testId: 123 }))).toBeUndefined();
      expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, testId: null }))).toBeUndefined();
    });

    it("should return undefined when _filter is not the subscription marker", () => {
      expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, _filter: "live=true" }))).toBeUndefined();
      expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, _filter: 123 }))).toBeUndefined();
    });

    it("should return undefined when region is not a non-empty string", () => {
      expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, region: "" }))).toBeUndefined();
      expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, region: "  " }))).toBeUndefined();
      expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, region: 123 }))).toBeUndefined();
    });

    it.each(["timestamp", "vu", "succ", "fail", "avgRt"])(
      "should return undefined when %s is not a number",
      (field) => {
        expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, [field]: "10" }))).toBeUndefined();
        expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, [field]: null }))).toBeUndefined();
      }
    );

    it.each(["timestamp", "vu", "succ", "fail", "avgRt"])(
      "should return undefined when %s overflows to Infinity",
      (field) => {
        // JSON has no Infinity literal, but an out-of-range exponent parses to one.
        const raw = JSON.stringify({ ...validPoint, [field]: 0 }).replace(`"${field}":0`, `"${field}":1e999`);
        expect(JSON.parse(raw)[field]).toBe(Infinity);

        expect(parseLiveDataPoint(raw)).toBeUndefined();
      }
    );

    it.each(["timestamp", "vu", "succ", "fail", "avgRt"])(
      "should return undefined when %s is negative",
      (field) => {
        expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, [field]: -1 }))).toBeUndefined();
      }
    );

    it.each(["timestamp", "vu", "succ", "fail"])(
      "should return undefined when %s is fractional",
      (field) => {
        expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, [field]: 1.5 }))).toBeUndefined();
      }
    );

    it("should return undefined when timestamp is not aligned to a one-second bucket", () => {
      expect(parseLiveDataPoint(JSON.stringify({ ...validPoint, timestamp: validPoint.timestamp + 1 }))).toBeUndefined();
    });

    it("should accept zero values for a second with no requests", () => {
      const idle = { ...validPoint, vu: 0, succ: 0, fail: 0, avgRt: 0 };

      expect(parseLiveDataPoint(JSON.stringify(idle))).toEqual(idle);
    });
  });
});
