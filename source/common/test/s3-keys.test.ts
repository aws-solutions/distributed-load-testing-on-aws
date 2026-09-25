// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
  completionMarkerKey,
  fileTypeForAssetFilename,
  frameworkExitReportKey,
  getTestAssetCandidates,
  entryNameFor,
  isControlChar
} from "../src/s3-keys.ts";

describe("completion marker keys", () => {
  const args = ["test-123", "20260514_run-456", "us-east-1", "abc123"] as const;

  it("builds the canonical natural-completion key", () => {
    expect(completionMarkerKey(...args)).toBe("results/test-123/20260514_run-456/completion/us-east-1/abc123");
  });

  it("builds the warning-completion key", () => {
    expect(completionMarkerKey(...args, true)).toBe(
      "results/test-123/20260514_run-456/completion/us-east-1/abc123.warning"
    );
  });
});

describe("framework-exit report keys", () => {
  it("builds the canonical run-level report key", () => {
    expect(frameworkExitReportKey("test-123", "20260514_run-456")).toBe(
      "results/test-123/20260514_run-456/framework-exits/framework-exits.jsonl"
    );
  });
});

describe("test asset candidates", () => {
  it.each([
    ["jmeter", "script", [{ extension: "jmx", key: "public/test-scenarios/jmeter/T1.jmx" }]],
    ["locust", "script", [{ extension: "py", key: "public/test-scenarios/locust/T1.py" }]],
    [
      "k6",
      "script",
      [
        { extension: "ts", key: "public/test-scenarios/k6/T1.ts" },
        { extension: "js", key: "public/test-scenarios/k6/T1.js" },
      ],
    ],
  ] as const)("builds ordered %s %s candidates", (framework, fileType, expected) => {
    expect(getTestAssetCandidates(framework, fileType, "T1")).toEqual(expected);
  });

  it.each(["jmeter", "k6", "locust"] as const)("builds the ZIP candidate for %s", (framework) => {
    expect(getTestAssetCandidates(framework, "zip", "T1")).toEqual([
      { extension: "zip", key: `public/test-scenarios/${framework}/T1.zip` },
    ]);
  });
});

describe("fileTypeForAssetFilename", () => {
  it.each(["abc123.zip", "ABC123.ZIP", "my.test.ZiP", "T1.zip"])("maps %s to zip", (filename) => {
    expect(fileTypeForAssetFilename(filename)).toBe("zip");
  });

  it.each(["abc123.jmx", "script.js", "test.ts", "locustfile.py", "noext", "archive.zip.bak"])(
    "maps %s to script",
    (filename) => {
      expect(fileTypeForAssetFilename(filename)).toBe("script");
    }
  );
});

describe("entryNameFor", () => {
  // Accepted names are returned verbatim — the guard validates, it never rewrites.
  it.each([
    // Real artifact layouts, at any depth.
    "results.xml",
    "us-east-1/abc123/results.xml",
    "us-east-1/task/sub/deep/x.xml", // deep nesting preserved
    "a/b/c/d/leaf.txt",
    "framework-exits/framework-exits.jsonl",
    // Legit names with "special" characters that cannot traverse.
    "2024-01-01T12:30:50.results.xml", // legacy colon timestamp
    "my data (1).csv",
    "résumé.csv",
    "load+stress.csv",
    "data#1.csv",
    ".hidden", // leading dot is a normal hidden name, not a `.`/`..` token
    "_baseline.csv",
    "us-east-1/.cache/results.xml", // dot-dir mid-path
    "uuid/..backup.csv", // leading `..` in a filename, not a standalone `..`
    "snapshot...tar", // interior dot run
    'a"b.csv', // Windows-unportable, but cannot traverse
    "a<b>c.csv",
  ])("accepts %j verbatim", (input) => {
    expect(entryNameFor(input)).toBe(input);
  });

  // Rejected (null → skip): traversal structure, absolute/UNC/drive forms, NUL.
  it.each([
    ["..", "dot-dot"],
    [".", "dot"],
    ["... ", "triple-dot-space (Windows canonicalization of ..)"],
    [".. /.. /startup-evil.lnk", "dot-dot-space bypass"],
    ["", "empty"],
    ["../..", "only traversal segments"],
    ["../../evil.sh", "leading `..` traversal"],
    ["a/../../../etc/passwd", "interior `..` traversal"],
    ["..\\..\\evil.sh", "backslash traversal"],
    ["/etc/passwd", "POSIX absolute (leading separator)"],
    ["a/b/", "trailing separator (empty final segment)"],
    ["us-east-1/ /x", "whitespace-only segment"],
    ["uuid/ ../x", "leading-whitespace dots"],
    ["C:\\Windows\\evil", "Windows drive-absolute"],
    ["C:evil.txt", "drive-relative leaf"],
    ["c:rel", "lowercase drive-relative"],
    ["Z:x", "other drive letter"],
    ["us-east-1/a:b/leaf.txt", "drive-like segment, any position"],
    ["foo/C:bar/x", "drive-like later segment"],
    ["\\\\server\\share\\x", "UNC path (leading empties)"],
    ["a\u0000b/c.csv", "NUL in a non-leaf segment"],
    ["a\u0000b.csv", "NUL in leaf"],
    ["evil.sh" + String.fromCharCode(13) + "x", "CR (terminal overwrite / S3 CR→LF normalization)"],
    ["evil.sh" + String.fromCharCode(27) + "[2K", "ESC (ANSI escape injection)"],
    ["a" + String.fromCharCode(9) + "b.csv", "tab (C0 control)"],
    ["a" + String.fromCharCode(0x7f) + "b.csv", "DEL"],
    ["a" + String.fromCharCode(0x9f) + "b.csv", "C1 control"],
  ])("rejects (%j — %s)", (input) => {
    expect(entryNameFor(input)).toBeNull();
  });
});

describe("isControlChar", () => {
  it.each([0, 0x1b, 0x7f, 0x9f])("treats %j as a control char", (codePoint) => {
    expect(isControlChar(codePoint)).toBe(true);
  });

  it.each([0x20, 0x41, 233])("treats %j as printable", (codePoint) => {
    expect(isControlChar(codePoint)).toBe(false);
  });
});
