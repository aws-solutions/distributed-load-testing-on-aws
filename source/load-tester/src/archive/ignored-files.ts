// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * True for files and directories that get added to zipped test assets by
 * accident and would otherwise get in the way — macOS metadata, editor
 * scratch files, and the like.
 *
 * Keep this list tight. Anything matched here is invisible to the rest of the
 * run, so a name that a real test script depends on must not appear. In
 * particular `__init__.py` has to survive: Locust projects need it to import
 * their own helper modules.
 */
export function isIgnoredTestFile(name: string): boolean {
  return name.startsWith(".") || name === "__MACOSX";
}
