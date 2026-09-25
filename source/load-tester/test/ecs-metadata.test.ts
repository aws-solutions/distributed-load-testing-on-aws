// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ecsDurationSeconds, fetchEcsTaskMetadata, type EcsTaskMetadata } from "../src/ecs-metadata.js";

const METADATA_URI = "http://169.254.170.2/v4/abcd";

function validResponseBody(): Record<string, unknown> {
  return {
    TaskARN: "arn:aws:ecs:us-east-1:123456789012:task/dlt-cluster/0123456789abcdef",
    Limits: { CPU: 2, Memory: 4096 },
    Containers: [{ StartedAt: "2026-05-04T20:13:00.000Z" }],
  };
}

function mockFetch(init: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  bodyThrows?: boolean;
}): void {
  const response = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    json: init.bodyThrows
      ? () => Promise.reject(new SyntaxError("Unexpected token"))
      : () => Promise.resolve(init.body),
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

describe("fetchEcsTaskMetadata", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a well-formed Fargate response", async () => {
    mockFetch({ body: validResponseBody() });

    await expect(fetchEcsTaskMetadata(METADATA_URI)).resolves.toEqual({
      taskArn: "arn:aws:ecs:us-east-1:123456789012:task/dlt-cluster/0123456789abcdef",
      taskId: "0123456789abcdef",
      taskCpu: 2,
      taskMemory: 4096,
      startedAt: "2026-05-04T20:13:00.000Z",
    });
  });

  it("calls the /task sub-path of the metadata URI", async () => {
    mockFetch({ body: validResponseBody() });

    await fetchEcsTaskMetadata(METADATA_URI);

    expect(fetch).toHaveBeenCalledWith(`${METADATA_URI}/task`);
  });

  it("throws on non-2xx HTTP status", async () => {
    mockFetch({ ok: false, status: 500, statusText: "Internal Server Error" });

    await expect(fetchEcsTaskMetadata(METADATA_URI)).rejects.toThrow(
      `ECS metadata endpoint returned 500 Internal Server Error for ${METADATA_URI}/task`
    );
  });

  it("throws when the response body is not JSON", async () => {
    mockFetch({ bodyThrows: true });

    await expect(fetchEcsTaskMetadata(METADATA_URI)).rejects.toThrow(
      `ECS metadata endpoint returned non-JSON body for ${METADATA_URI}/task`
    );
  });

  it("extracts the taskId as the ARN's last path segment", async () => {
    mockFetch({
      body: {
        ...validResponseBody(),
        TaskARN: "arn:aws:ecs:us-east-1:123456789012:task/my-cluster/deadbeef1234",
      },
    });

    const metadata = await fetchEcsTaskMetadata(METADATA_URI);
    expect(metadata.taskId).toBe("deadbeef1234");
  });

  it("rejects TaskARN without a trailing segment", async () => {
    mockFetch({
      body: {
        ...validResponseBody(),
        TaskARN: "arn:aws:ecs:us-east-1:123456789012:task/my-cluster/",
      },
    });

    await expect(fetchEcsTaskMetadata(METADATA_URI)).rejects.toThrow(/Could not extract task ID/);
  });
});

describe("ecsDurationSeconds", () => {
  function metadata(startedAt: string): EcsTaskMetadata {
    return {
      taskArn: "arn:aws:ecs:us-east-1:123456789012:task/dlt-cluster/abc123",
      taskId: "abc123",
      taskCpu: 2,
      taskMemory: 4096,
      startedAt,
    };
  }

  // Measured from container start, not test start, so it covers script download
  // and the wait for the start signal too.
  it("counts whole seconds since the container started", () => {
    const duration = ecsDurationSeconds(metadata("2026-05-04T20:13:00.000Z"), new Date("2026-05-04T20:15:30.400Z"));

    expect(duration).toBe(150);
  });

  it("rounds to the nearest second", () => {
    expect(ecsDurationSeconds(metadata("2026-05-04T20:13:00.000Z"), new Date("2026-05-04T20:13:00.600Z"))).toBe(1);
  });

  // Bad metadata must not stop a valid result and completion marker from uploading,
  // so both of these report zero rather than throwing or going negative.
  it("reports zero for an unparseable timestamp", () => {
    expect(ecsDurationSeconds(metadata("not a timestamp"), new Date("2026-05-04T20:15:00.000Z"))).toBe(0);
  });

  it("reports zero when the container start is in the future", () => {
    expect(ecsDurationSeconds(metadata("2026-05-04T20:15:00.000Z"), new Date("2026-05-04T20:13:00.000Z"))).toBe(0);
  });
});
