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
import { useCreateScenarioMutation } from "../../store/scenariosApiSlice";
import { useSelector } from "react-redux";
import { RootState } from "../../store/store";
import { RegionalStackInfo } from "../../store/regionsSlice";
import { validateExpiryDate } from "../../utils/dateValidation";
import { isCronValid, validateCronFields } from "../../utils/cronValidation";
import { extractErrorMessage } from "../../utils/errorUtils";
import { generateUniqueId } from "../../utils/generateUniqueId.ts";
import { isValidJSON } from "../../utils/jsonValidator";
import { transformScenarioToFormData } from "../../utils/scenarioTransformer";
import { getFileExtension, isScriptTestType } from "../../utils/scenarioUtils";
import { isValidUri } from "../../utils/uriValidator";
import { STEPS, TestTypes, VALIDATION_LIMITS } from "./constants";
import { sendConsoleMetric } from "../../utils/consoleMetrics";
import { CreateScenarioRequest } from "./types/createTest.ts";
import { usePageLoadMetric } from "../../hooks/usePageLoadMetric";

export default function CreateTestScenarioPage() {
  usePageLoadMetric("CreateTestScenario", { dataReady: true });
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
  const originalScriptMarkerFile = useRef<File | null>(null);

  const regionalStacks = useSelector((state: RootState) => state.regions.regionalStacks);
  const incompatibleRegions = new Set(
    (regionalStacks ?? []).filter((s: RegionalStackInfo) => !s.compatible).map((s: RegionalStackInfo) => s.region)
  );

  // Clear wizard-level validation error banner when user modifies any form field
  const prevFormDataRef = useRef(formData);
  useEffect(() => {
    if (prevFormDataRef.current !== formData && showValidationErrors) {
      setShowValidationErrors(false);
    }
    prevFormDataRef.current = formData;
  }, [formData, showValidationErrors]);

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
        const scenario = JSON.parse(copyData || editData!);
        const transformedData = transformScenarioToFormData(scenario, !copyData);
        originalScriptMarkerFile.current = transformedData.scriptFile[0] || null;
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
    const hasK6License = formData.testType === TestTypes.K6 ? formData.k6LicenseAcknowledged : true;
    const hasHttpEndpoint = !isScriptTest ? Boolean(formData.httpEndpoint?.trim()) : true;
    const hasValidUri = !isScriptTest ? (formData.httpEndpoint ? isValidUri(formData.httpEndpoint).isValid : false) : true;
    const hasValidJSON = !isScriptTest
      ? isValidJSON(formData.requestHeaders || "") && isValidJSON(formData.bodyPayload || "")
      : true;
    return hasRequiredFile && hasK6License && hasHttpEndpoint && hasValidUri && hasValidJSON;
  };

  const isGeneralSettingsStepValid = () => {
    const hasNameAndDesc = Boolean(formData.testName?.trim() && formData.testDescription?.trim());

    let hasValidSchedule = true;
    if (formData.executionTiming === "run-once") {
      hasValidSchedule = Boolean(formData.scheduleTime?.trim() && formData.scheduleDate?.trim());
    } else if (formData.executionTiming === "run-schedule") {
      const { cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek } = formData;
      const isExpiryValid = validateExpiryDate(formData.cronExpiryDate).isValid;
      hasValidSchedule = isCronValid({ cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek }) && isExpiryValid;
    }

    return hasNameAndDesc && hasValidSchedule;
  };

  const isTrafficShapeStepValid = () => {
    const hasRegions = formData.regions?.length > 0;
    const hasIncompatibleRegion = formData.regions?.some((r) => incompatibleRegions.has(r.region));
    const hasValidRegions = formData.regions?.every(
      (region) =>
        region.taskCount &&
        Number(region.taskCount) >= VALIDATION_LIMITS.TASK_COUNT.MIN &&
        region.concurrency &&
        Number(region.concurrency) >= VALIDATION_LIMITS.CONCURRENCY.MIN
    );
    const hasValidDuration =
      formData.rampUpValue &&
      Number(formData.rampUpValue) >= VALIDATION_LIMITS.RAMP_UP.MIN &&
      formData.holdForValue &&
      Number(formData.holdForValue) >= VALIDATION_LIMITS.HOLD_FOR.MIN;
    const hasValidRegionCount = formData.regions?.length <= VALIDATION_LIMITS.MAX_REGIONS;

    return hasRegions && !hasIncompatibleRegion && hasValidRegions && hasValidDuration && hasValidRegionCount;
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
    if (formData.testType === TestTypes.K6 && !formData.k6LicenseAcknowledged) {
      return "Please acknowledge the K6 AGPL-3.0 license terms.";
    }
    return undefined;
  };

  const getTrafficShapeError = () => {
    const errors: string[] = [];

    const selectedIncompatible = formData.regions.filter((r) => incompatibleRegions.has(r.region));
    if (selectedIncompatible.length > 0) {
      errors.push(`Incompatible regions selected: ${selectedIncompatible.map((r) => r.region).join(", ")}. Please update the regional stack or remove them`);
    }

    if (formData.regions.length > VALIDATION_LIMITS.MAX_REGIONS) {
      errors.push(`Maximum ${VALIDATION_LIMITS.MAX_REGIONS} regions allowed`);
    }

    const hasInvalidRegions = formData.regions.some(
      (region) =>
        !region.taskCount ||
        Number(region.taskCount) < VALIDATION_LIMITS.TASK_COUNT.MIN ||
        !region.concurrency ||
        Number(region.concurrency) < VALIDATION_LIMITS.CONCURRENCY.MIN
    );
    if (hasInvalidRegions) {
      errors.push(`Please ensure all regions have valid task count (≥${VALIDATION_LIMITS.TASK_COUNT.MIN}) and concurrency (≥${VALIDATION_LIMITS.CONCURRENCY.MIN})`);
    }

    if (!formData.rampUpValue) {
      errors.push("Ramp up time is required");
    } else if (Number(formData.rampUpValue) < VALIDATION_LIMITS.RAMP_UP.MIN) {
      errors.push(`Ramp up must be ≥${VALIDATION_LIMITS.RAMP_UP.MIN}`);
    }

    if (!formData.holdForValue) {
      errors.push("Hold for time is required");
    } else if (Number(formData.holdForValue) < VALIDATION_LIMITS.HOLD_FOR.MIN) {
      errors.push(`Hold for must be ≥${VALIDATION_LIMITS.HOLD_FOR.MIN}`);
    }

    return errors.length > 0 ? `${errors.join(". ")}.` : undefined;
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
      const { cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek } = formData;
      if (!cronMinutes || !cronHours) {
        return "Cron minutes and hours are required";
      }
      const cronError = validateCronFields({ cronMinutes, cronHours, cronDayOfMonth, cronMonth, cronDayOfWeek });
      if (cronError) {
        return cronError;
      }
      if (!formData.cronExpiryDate?.trim()) {
        return "Expiry date is required for scheduled tests";
      }
      const validation = validateExpiryDate(formData.cronExpiryDate);
      if (!validation.isValid) {
        return validation.errorMessage;
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
      healthyThreshold: parseInt(formData.healthyThreshold) || 90,
    };

    // Add run schedule
    if (formData.executionTiming === "run-once") {
      payload.scheduleDate = formData.scheduleDate;
      payload.scheduleTime = formData.scheduleTime;
      payload.scheduleTimezone = formData.scheduleTimezone || "UTC";
      payload.scheduleStep = "start";
    }
    if (formData.executionTiming === "run-schedule") {
      // Convert ? to * for 5-field cron expression (no year field)
      const dayOfMonth = formData.cronDayOfMonth === "?" ? "*" : formData.cronDayOfMonth;
      const dayOfWeek = formData.cronDayOfWeek === "?" ? "*" : formData.cronDayOfWeek;
      payload.cronValue = `${formData.cronMinutes || "*"} ${formData.cronHours || "*"} ${dayOfMonth || "*"} ${formData.cronMonth || "*"} ${dayOfWeek || "*"}`;
      payload.cronExpiryDate = formData.cronExpiryDate || "";
      payload.scheduleTimezone = formData.scheduleTimezone || "UTC";
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
          sendConsoleMetric("ButtonClick", { Page: "CreateTestScenario", Action: formData.executionTiming === "run-now" ? "RunNow" : "Schedule", IsEdit: searchParams.get("editData") ? "true" : "false" });
          setIsSubmitting(true);
          setError(null);

          try {
            const isScriptTest = isScriptTestType(formData.testType);
            if (
              isScriptTest &&
              formData.scriptFile?.[0] &&
              formData.scriptFile[0] !== originalScriptMarkerFile.current
            ) {
              setIsUploading(true);
              const file = formData.scriptFile[0];
              const fileExtension = getFileExtension(file.name);
              sendConsoleMetric(
                "ScriptUploadStarted",
                { FileExtension: fileExtension, TestType: formData.testType, FileSizeBytes: file.size, TestId: formData.testId },
              );
              const key = `test-scenarios/${formData.testType.toLowerCase()}/${formData.testId}.${fileExtension}`;
              try {
                await uploadData({ key, data: file }).result;
              } catch (uploadErr: any) {
                sendConsoleMetric(
                  "ScriptUploadFailed",
                  {
                    FileExtension: fileExtension,
                    TestType: formData.testType,
                    FileSizeBytes: file.size,
                    TestId: formData.testId,
                    ErrorCode: uploadErr?.name ?? "Unknown",
                  },
                );
                throw uploadErr;
              }
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
