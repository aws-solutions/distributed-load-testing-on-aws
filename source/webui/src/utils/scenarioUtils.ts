// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { TestTypes } from "../pages/scenarios/constants";

export const isScriptTestType = (testType: string) => testType !== TestTypes.SIMPLE;

export const getFileExtension = (filename: string) => filename.split(".").pop();
