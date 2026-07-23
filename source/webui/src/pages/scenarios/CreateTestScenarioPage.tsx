// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Box, Button, ContentLayout, Form, Header, Modal, Spinner, SpaceBetween } from "@cloudscape-design/components";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useFormData } from "./hooks/useFormData";
import { useTagManagement } from "./hooks/useTagManagement";

import { get } from "aws-amplify/api";
import { uploadData } from "aws-amplify/storage";
import { useCreateScenarioMutation, useGetScenarioDetailsQuery } from "../../store/scenariosApiSlice";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../store/store";
import { RegionalStackInfo } from "../../store/regionsSlice";
import { addNotification } from "../../store/notificationsSlice";
import { FormData } from "./types";
import { extractErrorMessage } from "../../utils/errorUtils";
import { generateUniqueId } from "../../utils/generateUniqueId.ts";
import { transformScenarioToFormData } from "../../utils/scenarioTransformer";
import { getFileExtension, isScriptTestType } from "../../utils/scenarioUtils";
import { TestTypes, VALIDATION_LIMITS } from "./constants";
import { sendConsoleMetric } from "../../utils/consoleMetrics";
import { CreateScenarioRequest } from "./types/createTest.ts";
import { usePageLoadMetric } from "../../hooks/usePageLoadMetric";

import { TestConfigurationSection } from "./components/TestConfigurationSection";
import { ScheduleSection } from "./components/ScheduleSection";
import { TestTypeSection } from "./components/TestTypeSection";
import { HttpEndpointSection } from "./components/HttpEndpointSection";
import { FileUploadSection } from "./components/FileUploadSection";
import { MultiRegionConfigSection } from "./components/MultiRegionConfigSection";
import { TestDurationSection } from "./components/TestDurationSection";
import { RegionalTaskAvailabilitySection } from "./components/RegionalTaskAvailabilitySection";
import { SECTION_IDS, validateScenarioForm } from "./utils/scenarioValidation";
import { scrollToFirstError } from "./utils/scrollToFirstError";

export default function CreateTestScenarioPage() {
  usePageLoadMetric("CreateTestScenario", { dataReady: true });
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { testId: editTestId } = useParams<{ testId: string }>();
  const cloneFromId = searchParams.get("cloneFrom");
  // Mode is derived from the route: /scenarios/:testId/edit → edit, ?cloneFrom= → clone, else create
  const isEdit = Boolean(editTestId);
  const sourceScenarioId = editTestId || cloneFromId || "";
  const { formData, updateFormData, resetFormData } = useFormData();
  const tagManagement = useTagManagement(formData, updateFormData);
  const dispatch = useDispatch();

  // Fetch the source scenario for edit/clone; create mode skips the query.
  const { data: sourceScenario, isLoading: isLoadingScenario } = useGetScenarioDetailsQuery(
    { testId: sourceScenarioId },
    { skip: !sourceScenarioId }
  );
  const [createScenario] = useCreateScenarioMutation();
  const [error, setError] = useState<string | null>(null);

  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  // Set true once submit is attempted, so all sections reveal their validation errors.
  const [submitAttempted, setSubmitAttempted] = useState<boolean>(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState<boolean>(false);
  const scenarioPopulated = useRef(false);
  const originalScriptMarkerFile = useRef<File | null>(null);
  // Baseline form state (after seed/populate) used to detect unsaved changes on cancel.
  const baselineFormData = useRef<FormData | null>(null);

  const regionalStacks = useSelector((state: RootState) => state.regions.regionalStacks);
  const incompatibleRegions = useMemo(
    () =>
      new Set(
        (regionalStacks ?? []).filter((s: RegionalStackInfo) => !s.compatible).map((s: RegionalStackInfo) => s.region)
      ),
    [regionalStacks]
  );

  // Populate the form from the fetched source scenario (edit preserves id/name, clone generates new id).
  // Create mode (no source id) seeds a fresh testId once.
  useEffect(() => {
    if (sourceScenarioId) {
      if (sourceScenario && !scenarioPopulated.current) {
        const transformedData = transformScenarioToFormData(sourceScenario, isEdit);
        originalScriptMarkerFile.current = transformedData.scriptFile[0] || null;
        updateFormData(transformedData);
        baselineFormData.current = { ...formData, ...transformedData } as FormData;
        scenarioPopulated.current = true;
      }
    } else if (!formData.testId) {
      const seeded = { ...formData, testId: generateUniqueId(VALIDATION_LIMITS.TEST_ID_LENGTH) };
      updateFormData({ testId: seeded.testId });
      baselineFormData.current = seeded;
    }
  }, [sourceScenarioId, sourceScenario, isEdit, updateFormData, formData.testId]);

  const isScriptTest = isScriptTestType(formData.testType);

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
            // runningTasks calculation only makes sense for scenarios running now.
            // If we're scheduling for later, we can't predict how many running
            // tasks will exist at the time that the test runs.
            const isRunNow = formData.executionTiming === "run-now";
            const runningTasks = (isRunNow && (tasksByRegion as any)[region]) || 0;
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
      const dayOfMonth = formData.cronDayOfMonth;
      const dayOfWeek = formData.cronDayOfWeek;
      payload.cronValue = `${formData.cronMinutes || "*"} ${formData.cronHours || "*"} ${dayOfMonth || "*"} ${formData.cronMonth || "*"} ${dayOfWeek || "*"}`;
      payload.cronExpiryDate = formData.cronExpiryDate || "";
      payload.scheduleTimezone = formData.scheduleTimezone || "UTC";
      payload.scheduleStep = "create";
      payload.recurrence = "daily"; // Default to daily for cron schedules
    }

    return payload;
  };

  const handleSubmit = async (mode: "save" | "submit") => {
    // Cross-section validation gate. Only reveal errors on failure — on a valid
    // submit we navigate away, so flipping submitAttempted would briefly flash
    // error styling before the redirect.
    const errors = validateScenarioForm(formData, incompatibleRegions);
    const errorList = Object.values(errors);
    if (errorList.length > 0) {
      setSubmitAttempted(true);
      const firstSectionId = errorList[0].sectionId;
      // Defer to the next frame so newly-revealed errorText sets aria-invalid before we query.
      requestAnimationFrame(() => scrollToFirstError(firstSectionId));
      return;
    }

    const stateSetter = mode === "save" ? setIsSaving : setIsSubmitting;
    const submitAction = formData.executionTiming === "run-now" ? "RunNow" : "Schedule";
    const action = mode === "save" ? "Save" : submitAction;
    sendConsoleMetric("ButtonClick", { Page: "CreateTestScenario", Action: action, IsEdit: isEdit ? "true" : "false" });
    stateSetter(true);
    setError(null);

    try {
      if (isScriptTest && formData.scriptFile?.[0] && formData.scriptFile[0] !== originalScriptMarkerFile.current) {
        setIsUploading(true);
        const file = formData.scriptFile[0];
        const fileExtension = getFileExtension(file.name);
        sendConsoleMetric("ScriptUploadStarted", {
          FileExtension: fileExtension,
          TestType: formData.testType,
          FileSizeBytes: file.size,
          TestId: formData.testId,
        });
        const key = `test-scenarios/${formData.testType.toLowerCase()}/${formData.testId}.${fileExtension}`;
        try {
          await uploadData({ key, data: file }).result;
        } catch (uploadErr: any) {
          sendConsoleMetric("ScriptUploadFailed", {
            FileExtension: fileExtension,
            TestType: formData.testType,
            FileSizeBytes: file.size,
            TestId: formData.testId,
            ErrorCode: uploadErr?.name ?? "Unknown",
          });
          throw uploadErr;
        }
        setIsUploading(false);
      }

      const payload = await createApiPayload();
      if (mode === "save") payload.saveOnly = true;
      await createScenario(payload).unwrap();

      baselineFormData.current = formData; // mark clean so navigation away doesn't prompt
      const verb = isEdit ? "updated" : "created";
      dispatch(
        addNotification({
          id: `scenario-${verb}-${formData.testId}`,
          type: "success",
          content: `Scenario "${formData.testName}" ${verb} successfully`,
          autoDismiss: true,
        })
      );
      resetFormData();
      navigate(`/scenarios/${formData.testId}`);
    } catch (err: any) {
      setIsUploading(false);
      const errorMessage = extractErrorMessage(err);
      setError(errorMessage);
    } finally {
      stateSetter(false);
    }
  };

  // Compare current form against the baseline captured after seed/populate.
  // scriptFile holds File objects (not JSON-comparable), so compare by file name only.
  const isDirty = (): boolean => {
    const baseline = baselineFormData.current;
    if (!baseline) return false;
    const normalize = (fd: FormData) => ({
      ...fd,
      scriptFile: (fd.scriptFile ?? []).map((f) => f.name),
    });
    return JSON.stringify(normalize(formData)) !== JSON.stringify(normalize(baseline));
  };

  const leave = () => {
    resetFormData();
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/scenarios");
    }
  };

  // Cancel returns to the previous page (FR-5.2); prompt first if there are unsaved changes.
  const handleCancel = () => {
    if (isDirty()) {
      setShowCancelConfirm(true);
    } else {
      leave();
    }
  };

  const submitLabel = isEdit ? "Update" : formData.executionTiming === "run-now" ? "Run Now" : "Schedule";

  return (
    <ContentLayout
      header={
        <Header variant="h1" description="Configure the settings for your load test">
          {isEdit ? "Edit Test Scenario" : "Create Test Scenario"}
        </Header>
      }
    >
      {isLoadingScenario ? (
        <Box textAlign="center" padding={{ vertical: "xxl" }}>
          <Spinner size="large" />
        </Box>
      ) : (
        <form onSubmit={(e) => e.preventDefault()}>
          <Form
            errorText={error}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button formAction="none" variant="link" onClick={handleCancel} disabled={isSubmitting || isUploading || isSaving}>
                  Cancel
                </Button>
                <Button formAction="none" onClick={() => handleSubmit("save")} loading={isSaving}>
                  Save
                </Button>
                <Button
                  variant="primary"
                  formAction="submit"
                  onClick={() => handleSubmit("submit")}
                  loading={isSubmitting || isUploading}
                >
                  {submitLabel}
                </Button>
              </SpaceBetween>
            }
          >
            <SpaceBetween direction="vertical" size="l">
              <TestConfigurationSection
                formData={formData}
                updateFormData={updateFormData}
                showValidationErrors={submitAttempted}
                {...tagManagement}
              />
              <ScheduleSection
                formData={formData}
                updateFormData={updateFormData}
                showValidationErrors={submitAttempted}
              />
              <TestTypeSection formData={formData} updateFormData={updateFormData} />
              {/* HTTP endpoint vs. file upload swap in place by test type. FileUploadSection is a
                  FormSection (own data-section-id); HttpEndpointSection is a plain Container, so the
                  page wraps it with a data-section-id for scroll-to-error. */}
              {isScriptTest ? (
                <FileUploadSection
                  formData={formData}
                  updateFormData={updateFormData}
                  showValidationErrors={submitAttempted}
                />
              ) : (
                <div data-section-id={SECTION_IDS.HTTP_ENDPOINT}>
                  <HttpEndpointSection
                    formData={formData}
                    updateFormData={updateFormData}
                    showValidationErrors={submitAttempted}
                  />
                </div>
              )}
              {/* Read-only regional availability sits directly above the region selector for context. */}
              <RegionalTaskAvailabilitySection />
              <MultiRegionConfigSection
                formData={formData}
                updateFormData={updateFormData}
                showValidationErrors={submitAttempted}
              />
              <TestDurationSection
                formData={formData}
                updateFormData={updateFormData}
                showValidationErrors={submitAttempted}
              />
            </SpaceBetween>
          </Form>
        </form>
      )}

      <Modal
        visible={showCancelConfirm}
        onDismiss={() => setShowCancelConfirm(false)}
        header="Discard changes"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setShowCancelConfirm(false)}>
                Keep editing
              </Button>
              <Button variant="primary" onClick={leave}>
                Discard
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        You have unsaved changes. If you leave this page, your changes will be lost.
      </Modal>
    </ContentLayout>
  );
}
