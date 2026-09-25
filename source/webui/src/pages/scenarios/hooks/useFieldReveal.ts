// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";

/**
 * Per-component touched tracking: each call owns its own state. Marks a field
 * touched (focused then left) so its error reveals on blur, and reveals every
 * field once a submit is attempted. Fields are keyed by an arbitrary string, so
 * fixed inputs ("testName") and dynamic ones ("us-east-1:taskCount") share one
 * mechanism.
 * @param submitAttempted whether the form submit has been attempted
 */
export const useFieldReveal = (submitAttempted: boolean) => {
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const markTouched = (key: string) => setTouched((prev) => new Set(prev).add(key));
  const isRevealed = (key: string) => touched.has(key) || submitAttempted;
  const resetTouched = () => setTouched(new Set());
  return { markTouched, isRevealed, resetTouched };
};
