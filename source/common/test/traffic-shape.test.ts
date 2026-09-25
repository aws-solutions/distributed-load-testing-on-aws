// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  TRAFFIC_SHAPE_DECISION_TABLE,
  TRAFFIC_SHAPE_LABELS,
  TRAFFIC_SHAPE_LONG_DEFINITIONS,
  TRAFFIC_SHAPE_MEDIUM_DEFINITIONS,
  TRAFFIC_SHAPE_SHORT_DEFINITIONS,
  type TrafficShapeMode,
} from "../src/traffic-shape.ts";

const MODES: readonly TrafficShapeMode[] = ["standard", "native"];
const TIERS = ["short", "medium", "long"] as const;
type Tier = (typeof TIERS)[number];

const BY_TIER: Record<Tier, Record<TrafficShapeMode, string>> = {
  short: TRAFFIC_SHAPE_SHORT_DEFINITIONS,
  medium: TRAFFIC_SHAPE_MEDIUM_DEFINITIONS,
  long: TRAFFIC_SHAPE_LONG_DEFINITIONS,
};

const everyDefinition = TIERS.flatMap((tier) => MODES.map((mode) => BY_TIER[tier][mode]));

describe("TRAFFIC_SHAPE_LABELS", () => {
  it("names the two modes exactly as every surface must show them", () => {
    expect(TRAFFIC_SHAPE_LABELS).toEqual({ standard: "Standard", native: "Native" });
  });
});

describe("definition tiers", () => {
  it.each(TIERS)("provides a %s definition for both modes", (tier) => {
    for (const mode of MODES) {
      expect(BY_TIER[tier][mode].length).toBeGreaterThan(0);
    }
  });

  // The whole point of three tiers is that they differ in length. A careless edit
  // that grows medium past long, or shrinks it to short, defeats the routing.
  it.each(MODES)("orders the tiers short < medium < long for %s", (mode) => {
    const short = TRAFFIC_SHAPE_SHORT_DEFINITIONS[mode].length;
    const medium = TRAFFIC_SHAPE_MEDIUM_DEFINITIONS[mode].length;
    const long = TRAFFIC_SHAPE_LONG_DEFINITIONS[mode].length;
    expect(short).toBeLessThan(medium);
    expect(medium).toBeLessThan(long);
  });

  it.each(MODES)("keeps the medium definition of %s to a single paragraph", (mode) => {
    expect(TRAFFIC_SHAPE_MEDIUM_DEFINITIONS[mode]).not.toContain("\n\n");
  });

  it.each(MODES)("splits the long definition of %s into two paragraphs", (mode) => {
    expect(TRAFFIC_SHAPE_LONG_DEFINITIONS[mode].split("\n\n")).toHaveLength(2);
  });

  // The same strings reach markdown, plain-text CLI help, and JSON tool schemas,
  // so markup would render literally on two of the three surfaces.
  it("keeps every definition free of markdown", () => {
    for (const text of everyDefinition) {
      expect(text).not.toMatch(/[`*_]/);
    }
  });

  // Standard is the default and is not deprecated. See the module header.
  it("never describes a mode as legacy or classic", () => {
    for (const text of everyDefinition) {
      expect(text).not.toMatch(/\b(legacy|classic)\b/i);
    }
  });

  // Medium and long are read standalone, so each has to name the mode it defines.
  // Short is exempt on purpose: it renders directly beneath the control label, and
  // repeating the name there would just be noise.
  it.each(["medium", "long"] as const)("names its own mode in each %s definition", (tier) => {
    expect(BY_TIER[tier].standard).toContain("Standard");
    expect(BY_TIER[tier].native).toContain("Native");
  });

  // These are the two facts reviewers found people get wrong, so they have to
  // survive the drop from long to medium.
  it("keeps the task-multiplication arithmetic in the medium Native definition", () => {
    expect(TRAFFIC_SHAPE_MEDIUM_DEFINITIONS.native).toContain("1,000 virtual users");
  });

  it("keeps the safety-duration outcome in the medium Native definition", () => {
    expect(TRAFFIC_SHAPE_MEDIUM_DEFINITIONS.native).toContain("records the run as completed");
  });

  // Reassurance for upgrading customers, and the reason Standard is not "legacy".
  it("keeps the pre-v4.3.0 reassurance in the medium Standard definition", () => {
    expect(TRAFFIC_SHAPE_MEDIUM_DEFINITIONS.standard).toContain("before v4.3.0");
  });
});

describe("TRAFFIC_SHAPE_DECISION_TABLE", () => {
  it("resolves every row to a known mode", () => {
    for (const row of TRAFFIC_SHAPE_DECISION_TABLE) {
      expect(MODES).toContain(row.mode);
      expect(row.need.length).toBeGreaterThan(0);
    }
  });

  it("covers both modes", () => {
    const modes = new Set(TRAFFIC_SHAPE_DECISION_TABLE.map((row) => row.mode));
    expect(modes).toEqual(new Set(MODES));
  });

  it("lists no duplicate needs", () => {
    const needs = TRAFFIC_SHAPE_DECISION_TABLE.map((row) => row.need);
    expect(new Set(needs).size).toBe(needs.length);
  });

  // Native scales load by task count too, so a row phrased that loosely would not
  // discriminate between the modes. This is the review feedback that produced the
  // current Standard rows.
  it("does not claim Standard is the only way to change load levels", () => {
    for (const row of TRAFFIC_SHAPE_DECISION_TABLE) {
      expect(row.need).not.toMatch(/change load levels/i);
    }
  });
});
