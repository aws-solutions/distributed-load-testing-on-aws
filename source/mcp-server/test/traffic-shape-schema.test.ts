// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Guards the traffic-shape wording in the tool schemas against drift.
 *
 * `toolSchema.write.json` is static JSON consumed by CDK
 * (`source/infrastructure/lib/mcp/mcp-infra.ts` inlines it into the template), so
 * unlike every other surface it cannot import the shared constants at runtime.
 * These assertions are the only thing keeping the six duplicated copies in step
 * with `@amzn/dlt-common/traffic-shape`. Before v4.3.0 shipped, five surfaces had
 * each invented their own name for this mode; the JSON is the one that can still
 * silently diverge.
 */

import { describe, expect, it } from "vitest";
import {
  TRAFFIC_SHAPE_DECISION_TABLE,
  TRAFFIC_SHAPE_LABELS,
  TRAFFIC_SHAPE_LONG_DEFINITIONS,
  TRAFFIC_SHAPE_MEDIUM_DEFINITIONS,
  TRAFFIC_SHAPE_SHORT_DEFINITIONS,
} from "@amzn/dlt-common";
import guides from "../src/workflows/guides.json" with { type: "json" };
import readSchema from "../toolSchema.json" with { type: "json" };
import writeSchema from "../toolSchema.write.json" with { type: "json" };

/** Collects every `native_run_mode` description in a schema document. */
function nativeRunModeDescriptions(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(nativeRunModeDescriptions);
  if (node === null || typeof node !== "object") return [];

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => {
    if (key === "native_run_mode" && value !== null && typeof value === "object") {
      const description = (value as { description?: unknown }).description;
      return typeof description === "string" ? [description] : [];
    }
    return nativeRunModeDescriptions(value);
  });
}

const descriptions = nativeRunModeDescriptions(writeSchema);

describe("native_run_mode descriptions in toolSchema.write.json", () => {
  it("appears on every write tool that accepts a test configuration", () => {
    expect(descriptions).toHaveLength(6);
  });

  it("uses one identical string across all six copies", () => {
    expect(new Set(descriptions).size).toBe(1);
  });

  it.each([0, 1, 2, 3, 4, 5])("carries both shared medium definitions verbatim (copy %i)", (index) => {
    expect(descriptions[index]).toContain(TRAFFIC_SHAPE_MEDIUM_DEFINITIONS.standard);
    expect(descriptions[index]).toContain(TRAFFIC_SHAPE_MEDIUM_DEFINITIONS.native);
  });

  // Long is reserved for the Implementation Guide. It was used here until reviewers
  // judged it too long for a tool description, which is why medium exists.
  it("does not carry the long definitions", () => {
    for (const description of descriptions) {
      expect(description).not.toContain(TRAFFIC_SHAPE_LONG_DEFINITIONS.standard);
      expect(description).not.toContain(TRAFFIC_SHAPE_LONG_DEFINITIONS.native);
    }
  });

  it("names both modes", () => {
    for (const description of descriptions) {
      expect(description).toContain(TRAFFIC_SHAPE_LABELS.standard);
      expect(description).toContain(TRAFFIC_SHAPE_LABELS.native);
    }
  });

  // The pre-4.3.0 wording listed only "(locust/k6)" and "(k6, locust)", so an agent
  // was told Native did not support JMeter. The runner has always supported it.
  it("names all three frameworks that support Native", () => {
    for (const description of descriptions) {
      for (const framework of ["jmeter", "k6", "locust"]) {
        expect(description.toLowerCase()).toContain(framework);
      }
    }
  });

  // Standard is the default, not a deprecated path.
  it("never calls Standard legacy or classic", () => {
    for (const description of descriptions) {
      expect(description).not.toMatch(/\b(legacy|classic)\b/i);
    }
  });
});

describe("Standard-only fields", () => {
  const raw = JSON.stringify(writeSchema);

  it("no longer describes concurrency, ramp-up, or hold-for without naming a mode", () => {
    expect(raw).not.toContain('"Number of concurrent virtual users per task."');
    expect(raw).not.toContain('"Number of concurrent virtual users per task in this region."');
    expect(raw).not.toContain('"Ramp-up time (e.g., \'30s\', \'2m\')"');
    expect(raw).not.toContain('"Hold duration (e.g., \'5m\', \'300s\')"');
  });
});

describe("traffic-shape copy in guides.json", () => {
  // guides.json is static JSON loaded by get-workflow-guides, so like the tool
  // schemas it cannot import the shared constants. It holds verbatim copies of the
  // short definitions and of the rendered decision table, which is the same drift
  // risk the schema guards above exist for.
  interface TrafficShapeBlock {
    standard?: string;
    native?: string;
    choosing?: string[];
  }
  interface Guide {
    steps?: { details?: string }[];
    traffic_shape?: TrafficShapeBlock;
  }

  const guideMap: Record<string, Guide> = guides;
  const trafficShape = guideMap["create_native_and_run"]?.traffic_shape;

  it("ships a create_native_and_run guide carrying the traffic-shape block", () => {
    expect(trafficShape).toBeDefined();
  });

  it("copies the short definitions verbatim", () => {
    expect(trafficShape?.standard).toBe(TRAFFIC_SHAPE_SHORT_DEFINITIONS.standard);
    expect(trafficShape?.native).toBe(TRAFFIC_SHAPE_SHORT_DEFINITIONS.native);
  });

  it("renders the decision table exactly as the shared data orders it", () => {
    const expected = TRAFFIC_SHAPE_DECISION_TABLE.map((row) => `${TRAFFIC_SHAPE_LABELS[row.mode]}: ${row.need}`);
    expect(trafficShape?.choosing).toEqual(expected);
  });

  // The traffic-shape sentence was added to every guide that composes a test
  // configuration, so an agent is told about the choice wherever it could make one.
  it.each(["create_and_run", "schedule_test", "update_and_run"])("names both modes in the %s guide", (workflow) => {
    const details = (guideMap[workflow]?.steps ?? []).map((step) => step.details ?? "").join(" ");
    expect(details).toContain(TRAFFIC_SHAPE_LABELS.standard);
    expect(details).toContain(TRAFFIC_SHAPE_LABELS.native);
  });
});

describe("get_scenario_details in toolSchema.json", () => {
  it("tells an agent the response reports the traffic-shape mode", () => {
    const tool = (readSchema as { name: string; description: string }[]).find(
      (entry) => entry.name === "get_scenario_details"
    );
    expect(tool).toBeDefined();
    expect(tool?.description).toContain("nativeRunMode");
    expect(tool?.description).toContain(TRAFFIC_SHAPE_LABELS.standard);
    expect(tool?.description).toContain(TRAFFIC_SHAPE_LABELS.native);
  });
});
