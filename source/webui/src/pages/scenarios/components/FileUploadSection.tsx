// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Component for JMeter file upload functionality

import {
  Alert,
  Box,
  Checkbox,
  ColumnLayout,
  ExpandableSection,
  FileUpload,
  FormField,
  Grid,
  Input,
  Link,
  SegmentedControl,
  SpaceBetween,
} from "@cloudscape-design/components";
import jmeter from "../../../../../../jmeter.json";
import { TestMode, TestTypes } from "../constants";
import { useFieldReveal } from "../hooks/useFieldReveal";
import { FormData, UpdateNativeMode } from "../types";
import { getFileExtension } from "../utils";
import { DURATION_UNIT_OPTIONS, isDurationUnit } from "../utils/duration";
import { maxDurationError, SECTION_IDS } from "../utils/scenarioValidation";
import { FormSection } from "./FormSection";

// Pre-installed JMeter plugins are bundled at build time, so the two-column
// split is computed once at module load rather than on every render.
const jmeterPlugins = Object.entries(jmeter.plugins);
const jmeterPluginMidpoint = Math.ceil(jmeterPlugins.length / 2);
const jmeterPluginColumns = [jmeterPlugins.slice(0, jmeterPluginMidpoint), jmeterPlugins.slice(jmeterPluginMidpoint)];

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  updateNativeMode: UpdateNativeMode;
  showValidationErrors?: boolean;
}

export const FileUploadSection = ({
  formData,
  updateFormData,
  updateNativeMode,
  showValidationErrors = false,
}: Props) => {
  const isFileRequired = formData.scriptFile?.length === 0;
  const { markTouched, isRevealed } = useFieldReveal(showValidationErrors);
  const { maxDuration } = formData.nativeMode;
  const durationError = maxDurationError(formData.nativeMode, isRevealed("maxDuration"));

  const formatExtensions = (extensions: string[]): string => {
    if (extensions.length === 0) return "";
    if (extensions.length === 1) return extensions[0];
    return extensions.join(", ");
  };

  return (
    <FormSection sectionId={SECTION_IDS.FILE_UPLOAD} headerText="Upload Test File">
      <SpaceBetween direction="vertical" size="m">
        {formData.testType === TestTypes.JMETER && (
          <Alert type="info" header="JMeter plugins">
            <SpaceBetween direction="vertical" size="xs">
              <ExpandableSection
                headerText={`Pre-installed Plugins (${jmeterPlugins.length} available)`}
                variant="footer"
              >
                <ColumnLayout columns={2} variant="text-grid">
                  {jmeterPluginColumns.map((column) => (
                    <div key={column[0]?.[0] ?? "empty"}>
                      {column.map(([name, version]) => (
                        <div key={name}>
                          • {name}{" "}
                          <Box variant="small" display="inline" color="text-body-secondary">
                            v{version}
                          </Box>
                        </div>
                      ))}
                    </div>
                  ))}
                </ColumnLayout>
              </ExpandableSection>

              <div>
                <strong>Uploading supporting files or plugins?</strong> Include them in your uploaded test zip file.
                Reference CSV data files using paths relative to the{" "}
                <Box variant="code" display="inline">
                  .jmx
                </Box>{" "}
                file, such as{" "}
                <Box variant="code" display="inline">
                  test-data.csv
                </Box>
                . Absolute paths will not resolve in the load-testing task. Place custom plugin JAR files in the{" "}
                <Box variant="code" display="inline">
                  plugins/
                </Box>{" "}
                directory:
                <Box variant="pre" margin={{ top: "xs", bottom: "n" }} padding="n" fontSize="body-s">
                  {`my-test.zip/
├── my-test.jmx          # JMeter test plan
├── test-data.csv        # Include test assets and use relative file paths
└── plugins/             # Custom plugins directory
    ├── my-sampler.jar
    └── my-library.jar`}
                </Box>
              </div>
            </SpaceBetween>
          </Alert>
        )}
        {formData.testType === TestTypes.K6 && (
          <Checkbox
            checked={formData.k6LicenseAcknowledged}
            onChange={({ detail }) => {
              updateFormData({ k6LicenseAcknowledged: detail.checked });
            }}
          >
            This project is licensed under the{" "}
            <Link variant="primary" href="https://www.apache.org/licenses/LICENSE-2.0">
              Apache-2.0 License
            </Link>
            . However, as part of this test, the K6 testing framework that will be installed is licensed under the{" "}
            <Link variant="primary" href="https://github.com/grafana/k6?tab=AGPL-3.0-1-ov-file#readme">
              AGPL-3.0 License
            </Link>
            . Click the checkbox to acknowledge.
          </Checkbox>
        )}
        {formData.testType === TestTypes.LOCUST && (
          <Alert type="info" header="Uploading a .zip file">
            In a .zip file, the test script must be named{" "}
            <Box variant="code" display="inline">
              locustfile.py
            </Box>
            . Add{" "}
            <Box variant="code" display="inline">
              requirements.txt
            </Box>{" "}
            to install third-party packages from PyPI, plus a{" "}
            <Box variant="code" display="inline">
              packages/
            </Box>{" "}
            directory of wheels to install them without internet access. See the{" "}
            <Link
              external
              href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/create-test-scenario.html#step-2-scenario-configuration"
            >
              Implementation Guide
            </Link>{" "}
            for more details.
            <Box variant="pre" margin={{ top: "xs", bottom: "n" }} padding="n" fontSize="body-s">
              {`my-test.zip/
├── locustfile.py         # Required — must use this name
├── requirements.txt      # Optional — packages to install
└── packages/             # Optional — wheels, for offline install only
    └── my-package.whl`}
            </Box>
          </Alert>
        )}
        {formData.testType === TestTypes.LOCUST && formData.testMode === TestMode.NATIVE && (
          // Customers may set `processes` in their Locust tests, which changes the behavior
          // from a single-threaded Locust test to multiple processes, which causes issues
          // with our ability to observe and capture individual requests. This mode is not
          // supported by DLT, and should achieve their load goals with 1/ increasing per-task
          // load 2/ scaling horizontally with additional tasks.
          <Alert type="info" header="Some Locust settings aren't supported">
            <SpaceBetween direction="vertical" size="xs">
              <span>
                We count every request your test makes, and that only works if Locust runs as a single process. If your
                config sets <strong>processes</strong>, most requests go uncounted and your results will show far fewer
                than you actually sent.
              </span>
              <span>Remove the processes setting and increase task count to scale across more containers.</span>
            </SpaceBetween>
          </Alert>
        )}
        <FormField
          label={`${formatExtensions(getFileExtension(formData.testType))} or .zip file`}
          description={`You can choose either a ${formatExtensions(getFileExtension(formData.testType))} file or a .zip file. Choose .zip file if you have any files to upload other than a ${formatExtensions(getFileExtension(formData.testType))} script file.`}
          errorText={
            formData.fileError || (showValidationErrors && isFileRequired ? "File upload is required" : undefined)
          }
        >
          <FileUpload
            onChange={({ detail }) => {
              const maxSize = 50 * 1024 * 1024; // 50MB in bytes
              const expectedExt = getFileExtension(formData.testType);

              let errorMessage = "";
              const validFiles = detail.value.filter((file) => {
                if (file.size > maxSize) {
                  errorMessage = "File size must be 50MB or less";
                  return false;
                }

                const fileName = file.name.toLowerCase();
                const isValidType = expectedExt.some((ext) => fileName.endsWith(ext)) || fileName.endsWith(".zip");
                if (!isValidType) {
                  errorMessage = `File must be ${formatExtensions(expectedExt)} or .zip format`;
                  return false;
                }

                return true;
              });

              updateFormData({
                scriptFile: validFiles,
                fileError: errorMessage,
              });
            }}
            value={formData.scriptFile}
            accept={`${getFileExtension(formData.testType).join(",")},.zip`}
            i18nStrings={{
              uploadButtonText: () => "Choose file",
              removeFileAriaLabel: (fileIndex) => `Remove file ${fileIndex + 1}`,
              limitShowFewer: "Show fewer files",
              limitShowMore: "Show more files",
            }}
            showFileSize
            showFileLastModified
            multiple={false}
          />
        </FormField>
        {formData.testMode === TestMode.NATIVE && (
          // Native mode: the script owns the load shape, so DLT only needs a safety
          // cap to stop a run that overshoots its expected duration.
          <FormField
            label="Safety duration"
            description="Set this to safely end a test that runs longer than intended."
            constraintText="Default: 4 hours. Maximum 24 hours."
            errorText={durationError}
          >
            <Grid disableGutters gridDefinition={[{ colspan: 3 }, { colspan: 9 }]}>
              <Box padding="xxs">
                <Input
                  data-cy="max-duration-input"
                  value={maxDuration.value || ""}
                  onChange={({ detail }) => updateNativeMode({ maxDuration: { ...maxDuration, value: detail.value } })}
                  onBlur={() => markTouched("maxDuration")}
                  invalid={!!durationError}
                  type="text"
                  inputMode="numeric"
                />
              </Box>
              <Box padding="xxs">
                <SegmentedControl
                  data-cy="max-duration-unit-select"
                  label="Safety duration unit"
                  selectedId={maxDuration.unit}
                  onChange={({ detail }) => {
                    if (isDurationUnit(detail.selectedId)) {
                      updateNativeMode({ maxDuration: { ...maxDuration, unit: detail.selectedId } });
                    }
                  }}
                  options={DURATION_UNIT_OPTIONS}
                />
              </Box>
            </Grid>
          </FormField>
        )}
      </SpaceBetween>
    </FormSection>
  );
};
