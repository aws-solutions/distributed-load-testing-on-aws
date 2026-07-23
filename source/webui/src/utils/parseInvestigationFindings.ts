// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { InvestigationFindingsResponse, InvestigationStructuredFindings } from "../models/investigation";

/**
 * Parses the findings response into a structured findings object.
 *
 * The DevOps Agent API returns journal records where `content` is a JSON document.
 * For `investigation_summary` records, the content follows a structure with:
 *   - type: string (e.g., "investigation_summary")
 *   - symptoms: array of { title, description, start_time?, end_time?, related_resources? }
 *   - findings: array of { id?, title, description, type, cascades_to?, related_resources? }
 *   - investigation_gaps: array of { title, description }
 *
 * This parser is intentionally lenient:
 *   - Accepts any recordType containing "summary" (forward-compatible with versioned types)
 *   - Preserves all finding types (not just root_cause/cause)
 *   - Returns a valid result even when only investigation_gaps are present
 *   - Returns null only when content is truly empty or unparseable
 */
export function parseStructuredFindings(
  data: InvestigationFindingsResponse | undefined,
): InvestigationStructuredFindings | null {
  if (!data?.findings) {
    return null;
  }

  // Accept any record type that looks like a structured summary
  if (data.recordType && !data.recordType.includes("summary")) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(data.findings);

    if (!isObject(parsed)) {
      return null;
    }

    const findings: InvestigationStructuredFindings = {
      type: typeof parsed.type === "string" ? parsed.type : "investigation_summary",
      symptoms: [],
      findings: [],
      investigation_gaps: [],
    };

    if (Array.isArray(parsed.symptoms)) {
      for (const s of parsed.symptoms) {
        if (isObject(s) && typeof s.title === "string") {
          findings.symptoms.push({
            title: s.title,
            description: typeof s.description === "string" ? s.description : "",
            start_time: typeof s.start_time === "string" ? s.start_time : undefined,
            end_time: typeof s.end_time === "string" ? s.end_time : undefined,
            related_resources: Array.isArray(s.related_resources)
              ? s.related_resources.filter((r): r is string => typeof r === "string")
              : undefined,
          });
        }
      }
    }

    if (Array.isArray(parsed.findings)) {
      for (const f of parsed.findings) {
        if (isObject(f) && typeof f.title === "string") {
          findings.findings.push({
            id: typeof f.id === "string" ? f.id : `finding-${findings.findings.length}`,
            title: f.title,
            description: typeof f.description === "string" ? f.description : "",
            type: typeof f.type === "string" ? f.type : "cause",
            cascades_to: Array.isArray(f.cascades_to)
              ? f.cascades_to.filter((c): c is string => typeof c === "string")
              : undefined,
            related_resources: Array.isArray(f.related_resources)
              ? f.related_resources.filter((r): r is string => typeof r === "string")
              : undefined,
          });
        }
      }
    }

    if (Array.isArray(parsed.investigation_gaps)) {
      for (const g of parsed.investigation_gaps) {
        if (isObject(g) && typeof g.title === "string") {
          findings.investigation_gaps.push({
            title: g.title,
            description: typeof g.description === "string" ? g.description : "",
          });
        }
      }
    }

    // Return the parsed result as long as there is any content at all.
    // A valid investigation_summary with all empty arrays still represents
    // a completed analysis (healthy run with no issues).
    const hasContent =
      findings.findings.length > 0 || findings.symptoms.length > 0 || findings.investigation_gaps.length > 0;

    return hasContent ? findings : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
