// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Custom hook for managing test scenario form state

import { useCallback, useState } from "react";
import { TestTypes } from "../constants";
import { FormData } from "../types";

const INITIAL_FORM_DATA: FormData = {
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
  regions: [],
  rampUpValue: "",
  rampUpUnit: "minutes",
  holdForValue: "",
  holdForUnit: "minutes"
};

export const useFormData = () => {
  const [formData, setFormData] = useState<FormData>(() => ({ ...INITIAL_FORM_DATA }));

  const updateFormData = useCallback((updates: Partial<FormData>) => {
    setFormData(prev => {
      const newData = { ...prev, ...updates };
      try {
        const dataToSave = { ...newData, scriptFile: [] };
        localStorage.setItem('dlt-current-draft', JSON.stringify(dataToSave));
      } catch (error) {
        console.warn('Failed to save form data:', error);
      }
      return newData;
    });
  }, []);

  const resetFormData = useCallback(() => {
    localStorage.removeItem('dlt-current-draft');
    setFormData({ ...INITIAL_FORM_DATA });
  }, []);

  return { formData, setFormData, updateFormData, resetFormData };
};
