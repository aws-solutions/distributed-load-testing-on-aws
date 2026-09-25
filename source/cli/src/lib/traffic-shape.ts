// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Renders the shared traffic-shape definitions for terminal help output.
 *
 * The definitions themselves live in `@amzn/dlt-common/traffic-shape` and are
 * stored unwrapped, because the same strings also feed markdown READMEs and the
 * MCP tool schema. Only the CLI needs them hard-wrapped, so the wrapping lives
 * here rather than in the shared module.
 *
 * This renders the medium tier; the shared module's header documents which tier
 * each surface takes.
 */

import {
  TRAFFIC_SHAPE_DECISION_TABLE,
  TRAFFIC_SHAPE_LABELS,
  TRAFFIC_SHAPE_MEDIUM_DEFINITIONS,
  type TrafficShapeMode,
} from "@amzn/dlt-common";

/** Fits Commander's default help output without depending on terminal width. */
const HELP_WIDTH = 76;

/**
 * Greedy word wrap. Words longer than the limit (a URL, a long flag) are left
 * intact on their own line rather than broken mid-token.
 */
function wrap(text: string, width: number, indent: string): string[] {
  const lines: string[] = [];
  let current = "";

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length + indent.length > width && current !== "") {
      lines.push(indent + current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== "") lines.push(indent + current);
  return lines;
}

/**
 * Wraps one mode's medium definition.
 *
 * Medium is a single paragraph by contract, so this needs no paragraph handling.
 * The long tier is reserved for the Implementation Guide: it ran to 74 lines here
 * and buried the flag reference underneath itself.
 */
function wrapDefinition(mode: TrafficShapeMode, indent: string): string[] {
  return wrap(TRAFFIC_SHAPE_MEDIUM_DEFINITIONS[mode], HELP_WIDTH, indent);
}

/**
 * The "Traffic shape" block for the `scenarios create` and `update` description
 * blocks: both mode names, both medium definitions, and the decision table.
 *
 * Standard is named explicitly rather than left as the unlabeled default, because
 * before v4.3.0 no CLI output named it at all.
 */
export function trafficShapeHelp(): string {
  const decisionRows = TRAFFIC_SHAPE_DECISION_TABLE.map(
    ({ need, mode }) => `    ${TRAFFIC_SHAPE_LABELS[mode].padEnd(10)}${need}`
  );

  return [
    "  Traffic shape:",
    "",
    `    ${TRAFFIC_SHAPE_LABELS.standard} (default)`,
    ...wrapDefinition("standard", "      "),
    "",
    `    ${TRAFFIC_SHAPE_LABELS.native} (--native-mode)`,
    ...wrapDefinition("native", "      "),
    "",
    "  Choosing a mode:",
    "",
    ...decisionRows,
  ].join("\n");
}
