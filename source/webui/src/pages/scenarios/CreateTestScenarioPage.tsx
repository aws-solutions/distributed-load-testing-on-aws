// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Alert, Box, ContentLayout, Header, Link, Wizard } from "@cloudscape-design/components";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { GeneralSettingsStep } from "./components/GeneralSettingsStep";
import { ReviewAndCreateStep } from "./components/ReviewAndCreateStep";
import { ScenarioConfigurationStep } from "./components/ScenarioConfigurationStep";
import { TrafficShapeStep } from "./components/TrafficShapeStep";
import { useFormData } from "./hooks/useFormData";

import { get } from "aws-amplify/api";
import { uploadData } from "aws-amplify/storage";
import cronParser from "cron-parser";
import { useCreateScenarioMutation } from "../../store/scenariosApiSlice";
import { generateUniqueId } from "../../utils/generateUniqueId.ts";
import { isValidJSON } from "../../utils/jsonValidator";
import { transformScenarioToFormData } from "../../utils/scenarioTransformer";
import { getFileExtension, isScriptTestType } from "../../utils/scenarioUtils";
import { STEPS, TestTypes, VALIDATION_LIMITS } from "./constants";
import { extractErrorMessage } from "../../utils/errorUtils";
import { CreateScenarioRequest } from "./types/createTest.ts";

export default function CreateTestScenarioPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const stepFromUrl = parseInt(searchParams.get("step") || "0");
  const [activeStepIndex, setActiveStepIndex] = useState(stepFromUrl);
  const { formData, updateFormData, resetFormData } = useFormData();
  const [createScenario, { isLoading }] = useCreateScenarioMutation();
  const [error, setError] = useState<string | null>(null);

  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  // Controls whether validation error messages are displayed in form fields and wizard steps
  const [showValidationErrors, setShowValidationErrors] = useState<boolean>(false);
  const copyDataProcessed = useRef(false);
  const originalScriptFilename = useRef<string | null>(null);

  const handleStepChange = useCallback(
    (newStepIndex: number) => {
      setActiveStepIndex(newStepIndex);
      navigate(`?step=${newStepIndex}`);
    },
    [navigate]
  );

  useEffect(() => {
    setActiveStepIndex(stepFromUrl);
    setError(null);
    // Mark as page refresh for draft loading
    if (stepFromUrl > 0) {
      sessionStorage.setItem("dlt-page-refresh", "true");
    }
  }, [stepFromUrl]);

  const loadDraftIfRefresh = useCallback(() => {
    const isRefresh = sessionStorage.getItem("dlt-page-refresh") === "true";
    sessionStorage.removeItem("dlt-page-refresh");

    if (isRefresh) {
      try {
        const saved = localStorage.getItem("dlt-current-draft");
        if (saved) {
          return JSON.parse(saved);
        }
      } catch (error) {
        console.warn("Failed to load saved form data:", error);
      }
    } else {
      localStorage.removeItem("dlt-current-draft");
    }
    return null;
  }, []);

  useEffect(() => {
    const copyData = searchParams.get("copyData");
    const editData = searchParams.get("editData");

    if ((copyData || editData) && !copyDataProcessed.current) {
      try {
        const scenario = JSON.parse(decodeURIComponent(copyData || editData!));
        const testScenario = scenario.testScenario || {};
        const scenarios = testScenario.scenarios || {};
        const scenarioKey = Object.keys(scenarios)[0];
        const scenarioConfig = scenarios[scenarioKey] || {};
        originalScriptFilename.current = scenarioConfig.script || null;
        const transformedData = transformScenarioToFormData(scenario, !copyData);
        updateFormData(transformedData);
        copyDataProcessed.current = true;
      } catch (error) {
        console.error("Failed to parse scenario data:", error);
      }
    } else if (!formData.testId && !copyData && !editData) {
      const draftData = loadDraftIfRefresh();
      if (draftData) {
        updateFormData(draftData);
      } else {
        updateFormData({ testId: generateUniqueId(VALIDATION_LIMITS.TEST_ID_LENGTH) });
      }
    }
  }, [searchParams, updateFormData, formData.testId, loadDraftIfRefresh]);

  /**
   * Validates if the expiry date is valid (not in the past).
   * 
   * @param cronExpiryDate - The expiry date string in YYYY/MM/DD or YYYY-MM-DD format
   * @returns true if the date is valid and not in the past, false otherwise
   */
  const isValidExpiryDate = (cronExpiryDate: string | undefined): boolean => {
    if (!cronExpiryDate?.trim()) {
      return false;
    }

    const dateParts = cronExpiryDate.split(/[-/]/);
    if (dateParts.length !== 3) {
      return false;
    }

    const year = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]);
    const day = parseInt(dateParts[2]);

    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      return false;
    }

    const expiryDate = new Date(year, month - 1, day, 23, 59, 59, 999);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return expiryDate >= today;
  };

  /**
   * Checks if the Scenario Configuration step has valid input data.
   *
   * @returns {boolean} True if all required fields are valid, false otherwise
   *
   * Validates:
   * - For script tests: ensures a script file is uploaded
   * - For HTTP tests: ensures endpoint URL is provided and JSON is valid for headers and body payload
   *
   * Used to determine if the wizard step can proceed to the next step.
   */
  const isScenarioConfigurationStepValid = () => {
    const isScriptTest = isScriptTestType(formData.testType);
    const hasRequiredFile = isScriptTest ? formData.scriptFile?.length > 0 : true;
    const hasHttpEndpoint = !isScriptTest ? Boolean(formData.httpEndpoint?.trim()) : true;
    const hasValidJSON = !isScriptTest
      ? isValidJSON(formData.requestHeaders || "") && isValidJSON(formData.bodyPayload || "")
      : true;
    return hasRequiredFile && hasHttpEndpoint && hasValidJSON;
  };

  const isGeneralSettingsStepValid = () => {
    const hasNameAndDesc = Boolean(formData.testName?.trim() && formData.testDescription?.trim());

    let hasValidSchedule = true;
    if (formData.executionTiming === "run-once") {
      hasValidSchedule = Boolean(formData.scheduleTime?.trim() && formData.scheduleDate?.trim());
    } else if (formData.executionTiming === "run-schedule") {
      try {
        const dayOfMonth = formData.cronDayOfMonth === "?" ? "*" : formData.cronDayOfMonth;
        const dayOfWeek = formData.cronDayOfWeek === "?" ? "*" : formData.cronDayOfWeek;
        const validCron = `${formData.cronMinutes} ${formData.cronHours} ${dayOfMonth} ${formData.cronMonth} ${dayOfWeek}`;
        cronParser.parse(validCron);
        hasValidSchedule = isValidExpiryDate(formData.cronExpiryDate);
      } catch {
        hasValidSchedule = false;
      }
    }

    return hasNameAndDesc && hasValidSchedule;
  };

  const isTrafficShapeStepValid = () => {
    const hasRegions = formData.regions?.length > 0;
    const hasValidRegions = formData.regions?.every(
      (region) =>
        region.taskCount &&
        Number(region.taskCount) >= VALIDATION_LIMITS.TASK_COUNT.MIN &&
        region.concurrency &&
        Number(region.concurrency) >= VALIDATION_LIMITS.CONCURRENCY.MIN
    );
    const hasValidDuration = formData.rampUpValue && formData.holdForValue;
    const hasValidRegionCount = formData.regions?.length <= VALIDATION_LIMITS.MAX_REGIONS;

    return hasRegions && hasValidRegions && hasValidDuration && hasValidRegionCount;
  };

  /**
   * Validates the Scenario Configuration step and returns wizard-level error messages.
   *
   * @returns {string | undefined} Error message for wizard display, or undefined if step is valid
   *
   * Checks:
   * - For script tests: validates that a script file has been uploaded
   * - For HTTP tests: validates endpoint URL and JSON format of headers/payload
   *
   * Note: Field-level validation errors are handled by individual form components,
   * this function only returns errors that should be displayed at the wizard level.
   */
  const getScenarioConfigurationError = () => {
    if (activeStepIndex !== STEPS.SCENARIO_CONFIG || !showValidationErrors || isScenarioConfigurationStepValid()) {
      return undefined;
    }
    const isScriptTest = isScriptTestType(formData.testType);
    if (isScriptTest && !formData.scriptFile?.[0]) {
      return "Please upload a test script file.";
    }
    return undefined;
  };

  const getTrafficShapeError = () => {
    if (formData.regions.length > VALIDATION_LIMITS.MAX_REGIONS) {
      return `Maximum ${VALIDATION_LIMITS.MAX_REGIONS} regions allowed`;
    }
    if (!formData.rampUpValue || !formData.holdForValue) {
      return "Ramp up and hold for times are required";
    }
    const hasInvalidRegions = formData.regions.some(
      (region) =>
        !region.taskCount ||
        Number(region.taskCount) < VALIDATION_LIMITS.TASK_COUNT.MIN ||
        !region.concurrency ||
        Number(region.concurrency) < VALIDATION_LIMITS.CONCURRENCY.MIN
    );
    if (hasInvalidRegions) {
      return `Please ensure all regions have valid task count (≥${VALIDATION_LIMITS.TASK_COUNT.MIN}) and concurrency (≥${VALIDATION_LIMITS.CONCURRENCY.MIN})`;
    }
    return undefined;
  };

  /**
   * Validates the General Settings step and returns wizard-level error messages.
   *
   * @returns {string | undefined} Error message for wizard display, or undefined if step is valid
   *
   * Checks:
   * - For run-once tests: validates that both run time and run date are provided
   * - For scheduled tests: validates cron expression syntax and future expiry date
   * - Ensures expiry date is provided and not in the past
   *
   * Note: Name and description validation is handled by individual form fields,
   * this function focuses on schedule-specific validation errors.
   */
  const getGeneralSettingsError = () => {
    if (formData.executionTiming === "run-once") {
      const missingTime = !formData.scheduleTime?.trim();
      const missingDate = !formData.scheduleDate?.trim();
      if (missingTime && missingDate) {
        return "Run time and Run date are required";
      }
      if (missingTime) {
        return "Run time is required";
      }
      if (missingDate) {
        return "Run date is required";
      }
    } else if (formData.executionTiming === "run-schedule") {
      try {
        const dayOfMonth = formData.cronDayOfMonth === "?" ? "*" : formData.cronDayOfMonth;
        const dayOfWeek = formData.cronDayOfWeek === "?" ? "*" : formData.cronDayOfWeek;
        const validCron = `${formData.cronMinutes} ${formData.cronHours} ${dayOfMonth} ${formData.cronMonth} ${dayOfWeek}`;
        cronParser.parse(validCron);
      } catch {
        return "Invalid cron expression";
      }
      if (!formData.cronExpiryDate?.trim()) {
        return "Expiry date is required for scheduled tests";
      }
      if (!isValidExpiryDate(formData.cronExpiryDate)) {
        return "Expiry date must be in the future";
      }
    }
    return undefined;
  };

  const createApiPayload = async () => {
    const regionalTaskDetails: any = {};

    try {
      const [vCPUResponse, tasksResponse] = await Promise.all([
        get({ apiName: "solution-api", path: "/vCPUDetails" }).response.then((r) => r.body.json()),
        get({ apiName: "solution-api", path: "/tasks" }).response.then((r) => r.body.json()),
      ]);

      const tasksByRegion = Array.isArray(tasksResponse)
        ? tasksResponse.reduce((acc: any, task: any) => {
            acc[task.region] = task.taskArns?.length || 0;
            return acc;
          }, {})
        : {};

      if (vCPUResponse) {
        Object.keys(vCPUResponse).forEach((region) => {
          const vCPUData = (vCPUResponse as any)[region];
          if (vCPUData) {
            const runningTasks = (tasksByRegion as any)[region] || 0;
            const dltTaskLimit = Math.floor(vCPUData.vCPULimit / vCPUData.vCPUsPerTask);

            regionalTaskDetails[region] = {
              vCPULimit: vCPUData.vCPULimit,
              vCPUsPerTask: vCPUData.vCPUsPerTask,
              vCPUsInUse: vCPUData.vCPUsInUse,
              dltTaskLimit,
              dltAvailableTasks: dltTaskLimit - runningTasks,
            };
          }
        });
      }
    } catch (error) {
      console.error("Failed to fetch regional task details:", error);
    }
    // For test types other than simple, a test script is required
    const isScriptTest = isScriptTestType(formData.testType);
    // Get file extension (e.g. jmx, js, py, zip)
    const scriptFileType = isScriptTest ? getFileExtension(formData.scriptFile?.[0].name) : "none";
    const fileTypeCategory = scriptFileType === "zip" ? "zip" : scriptFileType === "none" ? "none" : "script";
    // Build file name using the test id + correct file type (e.g. <test_id>.<file_type> -> ABCDE12345.zip)
    const scriptFileName = formData.scriptFile?.[0]?.name ? `${formData.testId}.${scriptFileType}` : "";

    const payload: CreateScenarioRequest = {
      testId: formData.testId,
      testName: formData.testName,
      testDescription: formData.testDescription,
      testTaskConfigs:
        formData.regions?.map((region) => ({
          concurrency: parseInt(region.concurrency),
          taskCount: parseInt(region.taskCount),
          region: region.region,
        })) || [],
      testScenario: {
        execution: [
          {
            "ramp-up": `${formData.rampUpValue}${formData.rampUpUnit?.charAt(0) || "m"}`,
            "hold-for": `${formData.holdForValue}${formData.holdForUnit?.charAt(0) || "m"}`,
            scenario: formData.testName,
            executor: formData.testType === TestTypes.SIMPLE ? undefined : formData.testType,
          },
        ],
        scenarios: {
          [formData.testName]: isScriptTest
            ? {
                script: scriptFileName,
              }
            : {
                requests: [
                  {
                    url: formData.httpEndpoint,
                    method: formData.httpMethod?.value || "GET",
                    headers: formData.requestHeaders ? JSON.parse(formData.requestHeaders) : {},
                    ...(formData.bodyPayload?.trim() && { body: formData.bodyPayload }),
                  },
                ],
              },
        },
      },
      testType: formData.testType,
      fileType: fileTypeCategory,
      showLive: formData.showLive,
      regionalTaskDetails,
      tags: formData.tags.map((tag) => tag.label),
    };

    // Add run schedule
    if (formData.executionTiming === "run-once") {
      // Convert browser time to UTC
      const localDateTime = new Date(`${formData.scheduleDate}T${formData.scheduleTime}:00`);
      const utcDateTime = localDateTime.toISOString();
      payload.scheduleDate = utcDateTime.split('T')[0];
      payload.scheduleTime = utcDateTime.split('T')[1].substring(0, 5);
      payload.scheduleStep = "start";
    }
    if (formData.executionTiming === "run-schedule") {
      // Convert ? to * for 5-field cron expression (no year field)
      const dayOfMonth = formData.cronDayOfMonth === "?" ? "*" : formData.cronDayOfMonth;
      const dayOfWeek = formData.cronDayOfWeek === "?" ? "*" : formData.cronDayOfWeek;
      payload.cronValue = `${formData.cronMinutes || "*"} ${formData.cronHours || "*"} ${dayOfMonth || "*"} ${formData.cronMonth || "*"} ${dayOfWeek || "*"}`;
      payload.cronExpiryDate = formData.cronExpiryDate || "";
      payload.scheduleStep = "create";
      payload.recurrence = "daily"; // Default to daily for cron schedules
    }

    return payload;
  };

  return (
    <ContentLayout
      header={
        <Header variant="h1" description="Configure the basic settings for your load test">
          Create Test Scenario
        </Header>
      }
    >
      {error && (
        <Box margin={{ bottom: "m" }}>
          <Alert type="error" dismissible onDismiss={() => setError(null)}>
            {error}
          </Alert>
        </Box>
      )}
      <Wizard
        i18nStrings={{
          stepNumberLabel: (stepNumber) => `Step ${stepNumber}`,
          collapsedStepsLabel: (stepNumber, stepsCount) => `Step ${stepNumber} of ${stepsCount}`,
          skipToButtonLabel: (step, stepNumber) => `Skip to ${step.title}`,
          navigationAriaLabel: "Steps",
          cancelButton: "Cancel",
          previousButton: "Previous",
          nextButton: "Next",
          optional: "optional",
        }}
        onNavigate={({ detail }) => {
          const newStep = detail.requestedStepIndex;
          if (detail.reason === "next") {
            setShowValidationErrors(true);
            // Block navigation if validation fails
            if (activeStepIndex === STEPS.GENERAL_SETTINGS && !isGeneralSettingsStepValid()) {
              return;
            }
            if (activeStepIndex === STEPS.SCENARIO_CONFIG && !isScenarioConfigurationStepValid()) {
              return;
            }
            if (activeStepIndex === STEPS.TRAFFIC_SHAPE && !isTrafficShapeStepValid()) {
              return;
            }
          }
          // Clear validation errors when navigating to steps other than current
          if (newStep !== activeStepIndex) setShowValidationErrors(false);
          handleStepChange(newStep);
        }}
        activeStepIndex={activeStepIndex}
        submitButtonText={formData.executionTiming === "run-now" ? "Run Now" : "Schedule"}
        isLoadingNextStep={isLoading || isUploading || isSubmitting}
        allowSkipTo
        steps={[
          {
            title: "General Settings",
            info: <Link variant="info">Info</Link>,
            description: "Define the basic parameters for your load test",
            isOptional: false,
            content: (
              <GeneralSettingsStep
                formData={formData}
                updateFormData={updateFormData}
                showValidationErrors={showValidationErrors}
              />
            ),
            errorText:
              activeStepIndex === STEPS.GENERAL_SETTINGS && showValidationErrors && !isGeneralSettingsStepValid()
                ? getGeneralSettingsError()
                : undefined,
          },
          {
            title: "Scenario Configuration",
            description: `Define the testing scenario for ${formData.testType} test`,
            content: (
              <ScenarioConfigurationStep
                formData={formData}
                updateFormData={updateFormData}
                onTestTypeChange={() => setShowValidationErrors(false)}
                showValidationErrors={showValidationErrors}
              />
            ),
            errorText: getScenarioConfigurationError(),
          },
          {
            title: "Traffic Shape",
            description: "Define the traffic load volume and shape",
            content: (
              <TrafficShapeStep
                formData={formData}
                updateFormData={updateFormData}
                showValidationErrors={showValidationErrors}
              />
            ),
            errorText:
              activeStepIndex === STEPS.TRAFFIC_SHAPE && showValidationErrors && !isTrafficShapeStepValid()
                ? getTrafficShapeError()
                : undefined,
          },
          {
            title: "Review and Create",
            description: "Review your configuration and create the test scenario",
            content: (
              <ReviewAndCreateStep
                formData={formData}
                updateFormData={updateFormData}
                onEdit={(stepIndex) => handleStepChange(stepIndex)}
                onCancel={() => {
                  resetFormData();
                  navigate("/scenarios");
                }}
              />
            ),
          },
        ]}
        onCancel={() => {
          resetFormData();
          navigate("/scenarios");
        }}
        onSubmit={async () => {
          setIsSubmitting(true);
          setError(null);

          try {
            const isScriptTest = isScriptTestType(formData.testType);
            if (
              isScriptTest &&
              formData.scriptFile?.[0] &&
              formData.scriptFile[0].name !== originalScriptFilename.current
            ) {
              setIsUploading(true);
              const file = formData.scriptFile[0];
              const fileExtension = getFileExtension(file.name);
              const key = `test-scenarios/${formData.testType.toLowerCase()}/${formData.testId}.${fileExtension}`;
              await uploadData({ key, data: file }).result;
              setIsUploading(false);
            }

            const payload = await createApiPayload();
            await createScenario(payload).unwrap();

            resetFormData();

            navigate(`/scenarios/${formData.testId}`);
          } catch (err: any) {
            setIsUploading(false);
            const errorMessage = extractErrorMessage(err);
            setError(errorMessage);
          } finally {
            setIsSubmitting(false);
          }
        }}
      />
    </ContentLayout>
  );
}
