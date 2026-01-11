// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Component for JMeter file upload functionality

import { Box, Checkbox, Container, FileUpload, FormField, Header, Link, SpaceBetween } from "@cloudscape-design/components";
import { useEffect, useState } from "react";
import { TestTypes } from "../constants";
import { FormData } from "../types";
import { getFileExtension } from "../utils";

interface Props {
  formData: FormData;
  updateFormData: (updates: Partial<FormData>) => void;
  showValidationErrors?: boolean;
}

export const FileUploadSection = ({ formData, updateFormData, showValidationErrors = false }: Props) => {
  const [acknowledged, setAcknowledged] = useState(false);

  const isFileRequired = formData.scriptFile?.length === 0;

  useEffect(() => {
    // If a script file has already been specified then
    // we know the K6 license has already been acknowledged.
    if (formData.scriptFile && formData.scriptFile.length > 0) {
      setAcknowledged(true);
    }
  }, [formData.scriptFile]);

  return (
    <Container header={<Header variant="h2">Upload Test File</Header>}>
      {formData.testType === TestTypes.K6 && (
        <SpaceBetween direction="vertical" size="s">
          <Checkbox
            checked={(formData.scriptFile && formData.scriptFile.length > 0) || acknowledged}
            onChange={({ detail }) => {
              if (!detail.checked) {
                updateFormData({ scriptFile: [] });
                setAcknowledged(false);
              } else {
                setAcknowledged(true);
              }
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
          <Box variant="p" color="text-body-secondary">
            <strong>Note:</strong> Starting with k6 v0.57, TypeScript support is enabled by default. You can upload .ts files directly without transpiling. For more information, see{" "}
            <Link
              variant="primary"
              href="https://grafana.com/docs/k6/latest/using-k6/javascript-typescript-compatibility-mode/"
              external
            >
              k6 JavaScript/TypeScript compatibility mode documentation
            </Link>
            .
          </Box>
        </SpaceBetween>
      )}
      <FormField
        label={
          formData.testType === TestTypes.K6
            ? ".js or .ts or .zip file"
            : `${getFileExtension(formData.testType)} or .zip file`
        }
        description={
          formData.testType === TestTypes.K6
            ? "You can choose a .js file, .ts file, or a .zip file. Choose .zip file if you have any files to upload other than a script file."
            : `You can choose either a ${getFileExtension(formData.testType)} file or a .zip file. Choose .zip file if you have any files to upload other than a ${getFileExtension(formData.testType)} script file.`
        }
        errorText={
          formData.fileError || (showValidationErrors && isFileRequired ? "File upload is required" : undefined)
        }
      >
        <FileUpload
          errorText={
            formData.testType === TestTypes.K6 && !acknowledged
              ? "Please acknowledge the license terms above before uploading files."
              : undefined
          }
          onChange={({ detail }) => {
            // Prevent file upload if K6 test type and not acknowledged
            if (formData.testType === TestTypes.K6 && !acknowledged) {
              updateFormData({ scriptFile: [] });
              return;
            }

            const maxSize = 50 * 1024 * 1024; // 50MB in bytes
            const expectedExt = getFileExtension(formData.testType);

            let errorMessage = "";
            const validFiles = detail.value.filter((file) => {
              if (file.size > maxSize) {
                errorMessage = "File size must be 50MB or less";
                return false;
              }

              const fileName = file.name.toLowerCase();
              let isValidType: boolean;
              
              // k6 supports both .js and .ts files
              if (formData.testType === TestTypes.K6) {
                isValidType = fileName.endsWith(".js") || fileName.endsWith(".ts") || fileName.endsWith(".zip");
                if (!isValidType) {
                  errorMessage = "File must be .js, .ts or .zip format";
                }
              } else {
                isValidType = fileName.endsWith(expectedExt.toLowerCase()) || fileName.endsWith(".zip");
                if (!isValidType) {
                  errorMessage = `File must be ${expectedExt} or .zip format`;
                }
              }
              
              if (!isValidType) {
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
          accept={
            formData.testType === TestTypes.K6
              ? ".js,.ts,.zip"
              : `${getFileExtension(formData.testType)},.zip`
          }
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
    </Container>
  );
};
