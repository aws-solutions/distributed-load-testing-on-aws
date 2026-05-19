// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Fetches the latest published DLT version from the AWS Solutions RSS feed.
 *
 * The feed is a small public S3 object behind CloudFront that lists every
 * published release newest-first. We parse the first `<item>`'s `<title>`
 * value, extract the MAJOR.MINOR.PATCH portion, and return it as a bare
 * semver string (without the `v` prefix or any suffix).
 *
 * Never throws. Returns `undefined` on timeout, non-200 response, malformed
 * body, or network error so callers can treat the data as optional.
 *
 * @example
 * ```ts
 * const latest = await getLatestVersionFromRss();
 * // latest === "4.0.15" or undefined
 * ```
 */

const DLT_RSS_FEED_URL =
  "https://solutions-reference.s3.us-east-1.amazonaws.com/distributed-load-testing-on-aws/latest/rss.xml";

const FETCH_TIMEOUT_MS = 1_000; // 1 second

// Matches the first `<item>` block's `<title>` content, capturing the
// MAJOR.MINOR.PATCH portion of the version string (e.g. "4.0.15").
const FIRST_ITEM_TITLE_VERSION_REGEX = /<item>[\s\S]*?<title>[^<]*?v(\d+\.\d+\.\d+)/;

export async function getLatestVersionFromRss(): Promise<string | undefined> {
  try {
    const response = await fetch(DLT_RSS_FEED_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[latest-version] RSS feed returned non-OK status: ${response.status}`);
      return undefined;
    }
    const body = await response.text();
    const match = FIRST_ITEM_TITLE_VERSION_REGEX.exec(body);
    if (!match?.[1]) {
      console.warn("[latest-version] Could not locate version in RSS feed body");
      return undefined;
    }
    return match[1];
  } catch (error) {
    console.warn("[latest-version] Failed to fetch RSS feed:", error);
    return undefined;
  }
}
