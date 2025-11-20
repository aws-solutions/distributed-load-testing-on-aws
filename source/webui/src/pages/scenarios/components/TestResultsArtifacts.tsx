// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Container, Header, Box, SpaceBetween, ColumnLayout, Spinner, Table, Button, TextFilter } from "@cloudscape-design/components";
import { Amplify } from "aws-amplify";
import { list, getUrl } from "aws-amplify/storage";
import { useState, useEffect, useMemo } from "react";
import { TestRunDetails } from "../types/testResults";
import JSZip from "jszip";

interface TestResultsArtifactsProps {
  readonly testRunDetails: TestRunDetails;
  readonly testId: string;
}

export function TestResultsArtifacts({ testRunDetails, testId }: TestResultsArtifactsProps) {
  const { testRunId } = testRunDetails;
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filteringText, setFilteringText] = useState("");

  const [actualPrefix, setActualPrefix] = useState<string>("");
  const bucketName = Amplify.getConfig().Storage?.S3?.bucket || "[bucket-name]";
  const searchPath = `results/${testId}/`;

  useEffect(() => {
    setLoading(true);
    setError(null);
    setFiles([]);
    setActualPrefix("");

    const fetchFiles = async () => {
      try {
        const result = await list({ path: searchPath, options: { listAll: true } });

        if (result.items.length === 0) {
          setError("No test result files found for this test run.");
          setActualPrefix(searchPath.replace(/\/$/, ""));
        } else {
          const matchingFiles = result.items.filter((item) => item.path.includes(`_${testRunId}/`));

          if (matchingFiles.length === 0) {
            setError("No test result files found for this test run.");
            setActualPrefix(searchPath.replace(/\/$/, ""));
          } else {
            const firstFilePath = matchingFiles[0].path;
            const folderPath = firstFilePath.substring(0, firstFilePath.lastIndexOf("/"));
            setActualPrefix(folderPath);
            setFiles(matchingFiles.map((item) => item.path));
          }
        }
      } catch (error) {
        console.error("Error listing files:", error);
        setError("Error loading test result files.");
        setActualPrefix(searchPath.replace(/\/$/, ""));
      } finally {
        setLoading(false);
      }
    };
    fetchFiles();
  }, [searchPath, testId, testRunId]);

  const filteredFiles = useMemo(() => {
    return files.filter((file) => {
      const filename = file.split("/").pop() || "";
      return filename.toLowerCase().includes(filteringText.toLowerCase());
    });
  }, [files, filteringText]);

  const renderFilesList = () => {
    if (loading) {
      return <Spinner />;
    }
    if (error) {
      return <Box color="text-status-error">{error}</Box>;
    }
    if (files.length > 0) {
      return (
        <Table
          columnDefinitions={[
            {
              id: "filename",
              header: "Filename",
              cell: (item) => item.split("/").pop() || item,
            },
          ]}
          items={filteredFiles}
          selectionType="multi"
          selectedItems={selectedItems}
          onSelectionChange={({ detail }) => setSelectedItems(detail.selectedItems)}
          empty="No files found"
          filter={
            <TextFilter
              filteringText={filteringText}
              onChange={({ detail }) => setFilteringText(detail.filteringText)}
              filteringPlaceholder="Filter files"
            />
          }
        />
      );
    }
    return <Box color="text-status-inactive">No files found</Box>;
  };

  const handleDownload = async () => {
    if (selectedItems.length === 0) return;

    setDownloading(true);
    try {
      const zip = new JSZip();
      for (const filePath of selectedItems) {
        const url = await getUrl({ path: filePath });
        const response = await fetch(url.url.toString());
        const blob = await response.blob();
        const filename = filePath.split("/").pop() || "file";
        zip.file(filename, blob);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(zipBlob);
      link.download = `${testId}_${testRunId}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error("Error downloading files:", error);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Container header={<Header variant="h2">Test Run Artifacts</Header>}>
      <SpaceBetween size="m">
        <ColumnLayout columns={2} variant="text-grid">
          <div>
            <Box variant="awsui-key-label">S3 Bucket</Box>
            <Box variant="code">{bucketName}</Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Prefix</Box>
            <Box variant="code">{actualPrefix}</Box>
          </div>
        </ColumnLayout>

        <Box>
          <Box variant="awsui-key-label">Result Files</Box>
          {renderFilesList()}
        </Box>

        <Button onClick={handleDownload} disabled={selectedItems.length === 0 || downloading} loading={downloading}>
          Download selected files
        </Button>

        <Box color="text-status-info" fontSize="body-s">
          You can also access these artifacts through the AWS S3 Console or CLI using the paths above.
        </Box>
      </SpaceBetween>
    </Container>
  );
}
