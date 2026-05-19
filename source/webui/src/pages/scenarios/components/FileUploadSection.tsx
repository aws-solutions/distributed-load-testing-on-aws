// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Component for JMeter file upload functionality

import { Checkbox, Container, FileUpload, FormField, Header, Link, SpaceBetween } from "@cloudscape-design/components";
import { TestTypes } from "../constants";
import { FormData } from "../types";
import { getFileExtension } from "../utils";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
}

export const FileUploadSection = ({ formData, updateFormData, showValidationErrors = false }: Props) => {
  const isFileRequired = formData.scriptFile?.length === 0;

  const formatExtensions = (extensions: string[]): string => {
    if (extensions.length === 0) return "";
    if (extensions.length === 1) return extensions[0];
    return extensions.join(", ");
  };

  return (
    <Container header={<Header variant="h2">Upload Test File</Header>}>
      <SpaceBetween direction="vertical" size="m">
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
              const isValidType = expectedExt.some(ext => fileName.endsWith(ext)) || fileName.endsWith(".zip");
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
          accept={`${getFileExtension(formData.testType).join(',')},.zip`}
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
      </SpaceBetween>
    </Container>
  );
};
