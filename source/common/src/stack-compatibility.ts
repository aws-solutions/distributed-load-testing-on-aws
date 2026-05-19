// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

interface CompatibilitySuccess {
  readonly compatible: true;
}

interface CompatibilityFailure {
  readonly compatible: false;
  readonly reason: string;
}

export type CompatibilityResult = CompatibilitySuccess | CompatibilityFailure;

const VERSION_REGEX = /v?(\d+)\.(\d+)\.(\d+)/; // NOSONAR

/**
 * Extracts major.minor.patch from a version string.
 * Handles prefixes like "custom-v4.0.12" or "v4.1.0".
 * Returns null for un-parseable input.
 * Callers must guard against empty/undefined strings before invoking.
 */
function parseVersion(version: string): SemVer | null {
  const match = VERSION_REGEX.exec(version);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Returns true when `latestVersion` is strictly newer than `currentVersion` at
 * the MAJOR.MINOR.PATCH level. Returns false when either input is missing or
 * unparseable, when the versions are equal, or when `currentVersion` is ahead.
 *
 * Any suffix after MAJOR.MINOR.PATCH is ignored during comparison, so
 * `v4.1.0-ITL` and `v4.1.0` are treated as equal.
 *
 * Never throws.
 */
export function isUpdateAvailable(
  currentVersion: string | undefined,
  latestVersion: string | undefined,
): boolean {
  if (!currentVersion || !latestVersion) return false;
  const current = parseVersion(currentVersion);
  const latest = parseVersion(latestVersion);
  if (!current || !latest) return false;
  for (const key of ["major", "minor", "patch"] as const) {
    if (latest[key] > current[key]) return true;
    if (latest[key] < current[key]) return false;
  }
  return false;
}

/** Compares spoke against a target version (minimum or hub) to enforce compatibility bounds. */
function compareVersions(spoke: SemVer, target: SemVer): -1 | 0 | 1 {
  for (const key of ["major", "minor", "patch"] as const) {
    if (spoke[key] < target[key]) return -1;
    if (spoke[key] > target[key]) return 1;
  }
  return 0;
}

/**
 * Checks whether a regional stack version is compatible with the hub stack.
 *
 * Rules:
 *   - regional >= minimumVersion
 *   - regional <= mainVersion (hub-first upgrade order)
 */
export function checkRegionalCompatibility(
  hubVersion: string,
  spokeVersion: string,
  minimumVersion: string
): CompatibilityResult {
  const hub = parseVersion(hubVersion);
  if (!hub) return { compatible: false, reason: `Unable to parse hub stack version: ${hubVersion}` };

  const spoke = parseVersion(spokeVersion);
  if (!spoke) return { compatible: false, reason: `Unable to parse regional stack version: ${spokeVersion}` };

  const minimum = parseVersion(minimumVersion);
  if (!minimum) return { compatible: false, reason: `Unable to parse minimum compatible version: ${minimumVersion}` };

  if (compareVersions(spoke, minimum) < 0) {
    return {
      compatible: false,
      reason: `Regional stack version ${spokeVersion} is below minimum required version ${minimumVersion}`,
    };
  }

  if (compareVersions(spoke, hub) > 0) {
    return {
      compatible: false,
      reason: `Regional stack version ${spokeVersion} is newer than hub version ${hubVersion}. Upgrade the hub stack first.`,
    };
  }

  return { compatible: true };
}
