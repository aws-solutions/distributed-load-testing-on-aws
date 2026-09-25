// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Custom hook for managing test scenario form state

import { useCallback, useState } from "react";
import { TestMode, TestTypes } from "../constants";
import { FormData, NativeModeInput } from "../types";

// New Native mode scenarios default the safety duration to 4 hours.
export const createEmptyNativeModeInput = (): NativeModeInput => ({
  maxDuration: { value: "4", unit: "hours" },
});

const createInitialFormData = (): FormData => ({
  testName: "",
  testDescription: "",
  testId: "",
  testType: TestTypes.SIMPLE,
  executionTiming: "run-now",
  showLive: false,
  scriptFile: [],
  fileError: "",
  tags: [],
  httpEndpoint: "",
  httpMethod: { label: "GET", value: "GET" },
  requestHeaders: "",
  bodyPayload: "",
  scheduleTime: "",
  scheduleDate: "",
  cronMinutes: "",
  cronHours: "",
  cronDayOfMonth: "",
  cronMonth: "",
  cronDayOfWeek: "",
  cronExpiryDate: "",
  scheduleTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  regions: [],
  testMode: TestMode.STANDARD,
  rampUpValue: "",
  rampUpUnit: "minutes",
  holdForValue: "",
  holdForUnit: "minutes",
  nativeMode: createEmptyNativeModeInput(),
  healthyThreshold: "90",
  k6LicenseAcknowledged: false,
});

export const useFormData = () => {
  const [formData, setFormData] = useState<FormData>(createInitialFormData);

  const updateFormData = useCallback((updates: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  }, []);

  const updateNativeMode = useCallback((updates: Partial<NativeModeInput>) => {
    setFormData((prev) => ({
      ...prev,
      nativeMode: {
        ...prev.nativeMode,
        ...updates,
      },
    }));
  }, []);

  const resetFormData = useCallback(() => {
    setFormData(createInitialFormData());
  }, []);

  return {
    formData,
    setFormData,
    updateFormData,
    updateNativeMode,
    resetFormData,
  };
};
