// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestVersionFromRss } from "../src/latest-version.js";

const buildRssBody = (titleVersion: string): string => `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>DLT Releases</title>
    <item>
      <title>distributed-load-testing-on-aws ${titleVersion}</title>
      <pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>distributed-load-testing-on-aws v4.0.14</title>
    </item>
  </channel>
</rss>`;

const mockOkResponse = (body: string): Response =>
  ({
    ok: true,
    status: 200,
    text: async () => body,
  }) as Response;

const mockNotOkResponse = (status: number): Response =>
  ({
    ok: false,
    status,
    text: async () => "",
  }) as Response;

describe("getLatestVersionFromRss", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the bare semver from the first item title", async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse(buildRssBody("v4.0.15")));
    await expect(getLatestVersionFromRss()).resolves.toBe("4.0.15");
  });

  it("ignores suffixes after MAJOR.MINOR.PATCH", async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse(buildRssBody("v4.1.0-ITL")));
    await expect(getLatestVersionFromRss()).resolves.toBe("4.1.0");
  });

  it("returns undefined on non-200 response", async () => {
    vi.mocked(fetch).mockResolvedValue(mockNotOkResponse(403));
    await expect(getLatestVersionFromRss()).resolves.toBeUndefined();
  });

  it("returns undefined on 500 response", async () => {
    vi.mocked(fetch).mockResolvedValue(mockNotOkResponse(500));
    await expect(getLatestVersionFromRss()).resolves.toBeUndefined();
  });

  it("returns undefined when body has no parseable version", async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse("<rss><channel><item><title>no version here</title></item></channel></rss>"));
    await expect(getLatestVersionFromRss()).resolves.toBeUndefined();
  });

  it("returns undefined when body is empty", async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse(""));
    await expect(getLatestVersionFromRss()).resolves.toBeUndefined();
  });

  it("returns undefined on network error (fetch rejects)", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    await expect(getLatestVersionFromRss()).resolves.toBeUndefined();
  });

  it("returns undefined on timeout abort", async () => {
    const abortError = new DOMException("The operation was aborted.", "TimeoutError");
    vi.mocked(fetch).mockRejectedValue(abortError);
    await expect(getLatestVersionFromRss()).resolves.toBeUndefined();
  });

  it("calls fetch with an abort signal", async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse(buildRssBody("v4.0.1")));
    await getLatestVersionFromRss();
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call).toBeDefined();
    const init = call?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("targets the first item's title, ignoring text before the first <item>", async () => {
    const body = `<?xml version="1.0"?>
<rss><channel>
  <title>Something mentioning v3.0.0 in the channel description</title>
  <description>Older build v2.0.0</description>
  <item><title>distributed-load-testing-on-aws v4.0.15</title></item>
</channel></rss>`;
    vi.mocked(fetch).mockResolvedValue(mockOkResponse(body));
    await expect(getLatestVersionFromRss()).resolves.toBe("4.0.15");
  });
});
