// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import fc from "fast-check";
import { TestStatus, StatusIndicatorType, getStatusConfig } from "../pages/scenarios/constants";

const validStatusIndicatorTypes: ReadonlySet<string> = new Set(Object.values(StatusIndicatorType));
const validTestStatusValues: ReadonlySet<string> = new Set(Object.values(TestStatus));

describe("Status Badge — Property Tests", () => {
  /**
   * Property 1: Every TestStatus maps to a valid StatusIndicator config
   *
   * For any valid TestStatus enum value, getStatusConfig returns a non-null
   * StatusConfig with a valid StatusIndicatorType and non-empty label.
   *
   * **Validates: Requirements 1.1, 7.1**
   */
  it("Property 1: every TestStatus enum value maps to a valid StatusConfig", () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.values(TestStatus)), (status) => {
        const config = getStatusConfig(status);

        expect(config).not.toBeNull();
        expect(config).not.toBeUndefined();
        expect(validStatusIndicatorTypes.has(config.type)).toBe(true);
        expect(config.label.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 2: Unknown status values produce an info-type fallback
   *
   * For any string NOT in TestStatus enum, getStatusConfig returns
   * { type: "info", label: rawStatus }.
   *
   * **Validates: Requirements 7.3**
   */
  it("Property 2: unknown status strings fall back to info type with raw label", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !validTestStatusValues.has(s)),
        (unknownStatus) => {
          const config = getStatusConfig(unknownStatus);

          expect(config.type).toBe(StatusIndicatorType.INFO);
          expect(config.label).toBe(unknownStatus);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Status Badge — Unit Tests", () => {
  /**
   * Verify exact type/label for specific lifecycle states.
   *
   * **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
   */
  it("queued status returns pending type with label Queued", () => {
    const config = getStatusConfig(TestStatus.QUEUED);
    expect(config.type).toBe(StatusIndicatorType.PENDING);
    expect(config.label).toBe("Queued");
  });

  it("provisioning status returns in-progress type with label Provisioning", () => {
    const config = getStatusConfig(TestStatus.PROVISIONING);
    expect(config.type).toBe(StatusIndicatorType.IN_PROGRESS);
    expect(config.label).toBe("Provisioning");
  });

  it("parsing results status returns in-progress type with label Parsing Results", () => {
    const config = getStatusConfig(TestStatus.PARSING_RESULTS);
    expect(config.type).toBe(StatusIndicatorType.IN_PROGRESS);
    expect(config.label).toBe("Parsing Results");
  });

  it("cleaning up status returns in-progress type with label Cleaning Up", () => {
    const config = getStatusConfig(TestStatus.CLEANING_UP);
    expect(config.type).toBe(StatusIndicatorType.IN_PROGRESS);
    expect(config.label).toBe("Cleaning Up");
  });
});
