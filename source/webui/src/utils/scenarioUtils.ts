// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { TestTypes } from "../pages/scenarios/constants";

export const isScriptTestType = (testType: string) => testType !== TestTypes.SIMPLE;

export const getFileExtension = (filename: string) => filename.split(".").pop();

export const parseTimeUnit = (timeStr: string) => ({
  value: timeStr?.replace(/[a-zA-Z]/g, "") || "1",
  unit: timeStr?.match(/[a-zA-Z]+/)?.[0] === "s" ? "seconds" : "minutes",
});