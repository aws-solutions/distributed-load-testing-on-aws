// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Container,
  Header,
  Box,
  SpaceBetween,
  Spinner,
  Table,
  Button,
  TextFilter,
  Alert,
} from "@cloudscape-design/components";
import { list, getUrl } from "aws-amplify/storage";
import { Amplify } from "aws-amplify";
import { entryNameFor, FRAMEWORK_EXIT_REPORT_FILENAME, FRAMEWORK_EXIT_REPORT_PREFIX } from "@amzn/dlt-common/s3-keys";
import { useState, useEffect, useMemo } from "react";
import { TestRunDetails } from "../types/testResults";
import { getConsoleDomain } from "../../../utils/aws-console";
import JSZip from "jszip";

interface TestResultsArtifactsProps {
  readonly testRunDetails: TestRunDetails;
  readonly testId: string;
}

/** Raw object returned by Amplify Storage `list` (path-based overload). */
interface ListItem {
  path: string;
  size?: number;
  lastModified?: Date;
}

export type ArtifactType = "Framework Warnings" | "Results" | "Logs" | "Errors" | "Other";

/** A test-run artifact enriched with the metadata we surface without downloading. */
export interface ArtifactFile {
  path: string;
  filename: string;
  region: string;
  type: ArtifactType;
  size?: number;
  lastModified?: Date;
}

// Groups render in this order; empty groups are skipped.
const TYPE_ORDER: ArtifactType[] = ["Framework Warnings", "Results", "Logs", "Errors", "Other"];

/**
 * Merge a per-type table's new selection into the overall selection. Selection is
 * partitioned by type (one table per type), so a group's `selected` is the complete
 * new selection for that type — drop this type's previous entries and swap it in,
 * leaving other types untouched. `selected` already includes filter-hidden rows of
 * the type (Cloudscape echoes them back), so this both preserves hidden selections
 * and avoids the duplication that would double the count on each change.
 */
export function reconcileSelection(
  prev: ArtifactFile[],
  type: ArtifactType,
  selected: ArtifactFile[]
): ArtifactFile[] {
  return [...prev.filter((s) => s.type !== type), ...selected];
}

/** Classify an artifact by its exact report path or file extension. */
function classifyType(path: string, filename: string): ArtifactType {
  // Pull framework warnings out explicitly
  if (path.endsWith(`/${FRAMEWORK_EXIT_REPORT_PREFIX}/${FRAMEWORK_EXIT_REPORT_FILENAME}`)) {
    return "Framework Warnings";
  }

  // Use file type for generic catagorization
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : "";
  if (ext === "err") return "Errors";
  if (ext === "log" || ext === "out") return "Logs";
  if (["xml", "json", "jsonl", "csv", "jtl"].includes(ext)) return "Results";
  return "Other";
}

/**
 * Longest common path-segment prefix (a folder, with trailing slash) of the given
 * object keys, ignoring the filename segment. Lets the "Open in S3" link scope to the
 * tightest folder that still contains every file: the per-region task folder for a
 * single-region run, collapsing to the test's results prefix once regions differ.
 * Returns "" when there are no keys.
 */
function commonKeyPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  const dirs = paths.map((p) => p.split("/").slice(0, -1));
  const first = dirs[0];
  let i = 0;
  while (i < first.length && dirs.every((d) => d[i] === first[i])) i++;
  const prefix = first.slice(0, i).join("/");
  return prefix ? `${prefix}/` : "";
}

/** Human-readable byte size (B / KB / MB / GB). */
function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Format an object's last-modified Date in the browser's local time. */
function formatModified(date?: Date): string {
  if (!date) return "—";
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/**
 * The run-relative portion of an S3 path: the part after the `_{testRunId}/` run folder, or
 * after the legacy flat `results/{testId}/` prefix, or the whole path if neither matches.
 */
function runRelativePath(filePath: string, marker: string, searchPath: string): string {
  const markerIndex = filePath.indexOf(marker);
  if (markerIndex >= 0) return filePath.slice(markerIndex + marker.length);
  if (filePath.startsWith(searchPath)) return filePath.slice(searchPath.length);
  return filePath;
}

export function TestResultsArtifacts({ testRunDetails, testId }: TestResultsArtifactsProps) {
  const { testRunId } = testRunDetails;
  const [files, setFiles] = useState<ArtifactFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<ArtifactFile[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [filteringText, setFilteringText] = useState("");

  const searchPath = `results/${testId}/`;

  // The run's configured regions are ground truth for attributing each file to a
  // Region — matched against the object key (modern layout puts region as a path
  // segment; legacy/top-level files carry it in the filename).
  const knownRegions = useMemo(
    () => Array.from(new Set((testRunDetails.testTaskConfigs ?? []).map((c) => c.region).filter(Boolean))),
    [testRunDetails.testTaskConfigs]
  );

  useEffect(() => {
    const resolveRegion = (path: string): string => {
      for (const r of knownRegions) {
        if (
          path.includes(`/${r}/`) ||
          path.includes(`-${r}.`) ||
          path.includes(`-${r}-`) ||
          path.includes(`_${r}.`) ||
          path.includes(`.${r}.`)
        ) {
          return r;
        }
      }
      const generic = /([a-z]{2}-[a-z]+-\d+)/.exec(path);
      return generic ? generic[1] : "—";
    };

    const toArtifact = (item: ListItem): ArtifactFile => {
      const filename = item.path.split("/").pop() || item.path;
      return {
        path: item.path,
        filename,
        region: resolveRegion(item.path),
        type: classifyType(item.path, filename),
        size: item.size,
        lastModified: item.lastModified,
      };
    };

    setLoading(true);
    setError(null);
    setDownloadError(null);
    setFiles([]);
    setSelectedItems([]);

    const fetchFiles = async () => {
      try {
        const result = await list({ path: searchPath, options: { listAll: true } });
        const items = result.items as unknown as ListItem[];

        if (items.length === 0) {
          setError("No test result files found for this test run.");
          return;
        }

        const visibleItems = items.filter((item) => !item.path.endsWith("/framework-exit.json"));
        let matchingFiles = visibleItems.filter(
          (item) => item.path.includes(`_${testRunId}/`) && !item.path.includes("/completion/")
        );

        // Fallback for legacy format: files stored directly under results/<testId>/
        // with timestamps in filenames. Match files whose timestamp falls within the
        // test run's [startTime, endTime] window. If endTime is missing or invalid,
        // use a 1.5-minute window from startTime.
        if (matchingFiles.length === 0 && testRunDetails.startTime) {
          const runStart = new Date(testRunDetails.startTime).getTime();
          const runEnd = new Date(testRunDetails.endTime).getTime() || runStart + 90_000;
          matchingFiles = visibleItems.filter((item) => {
            const match = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(item.path);
            if (!match) return false;
            const fileTime = new Date(match[1]).getTime();
            return fileTime >= runStart && fileTime <= runEnd;
          });
        }

        if (matchingFiles.length === 0) {
          setError("No test result files found for this test run.");
        } else {
          setFiles(matchingFiles.map(toArtifact));
        }
      } catch (error) {
        console.error("Error listing files:", error);
        setError("Error loading test result files.");
      } finally {
        setLoading(false);
      }
    };
    fetchFiles();
  }, [searchPath, testId, testRunId, testRunDetails.startTime, testRunDetails.endTime, knownRegions]);

  const filteredFiles = useMemo(() => {
    const needle = filteringText.toLowerCase();
    if (!needle) return files;
    return files.filter(
      (file) => file.filename.toLowerCase().includes(needle) || file.region.toLowerCase().includes(needle)
    );
  }, [files, filteringText]);

  // Split the filtered files into their display groups, preserving TYPE_ORDER and
  // dropping empty groups.
  const groups = useMemo(
    () =>
      TYPE_ORDER.map((type) => ({ type, items: filteredFiles.filter((f) => f.type === type) })).filter(
        (g) => g.items.length > 0
      ),
    [filteredFiles]
  );

  // Deep-link to the run's artifacts in the S3 console. Scoped to the tightest folder
  // that holds this run's files, falling back to the test's results prefix (always valid,
  // even before files load). Undefined when the bucket config isn't available.
  const s3ConsoleUrl = useMemo(() => {
    const s3Config = Amplify.getConfig().Storage?.S3;
    if (!s3Config?.bucket) return undefined;
    const consoleDomain = getConsoleDomain(s3Config.region);
    const prefix = commonKeyPrefix(files.map((f) => f.path)) || searchPath;
    return `https://${consoleDomain}/s3/buckets/${s3Config.bucket}?prefix=${prefix}`;
  }, [files, searchPath]);

  const columnDefinitions = [
    { id: "filename", header: "Filename", cell: (item: ArtifactFile) => item.filename },
    { id: "region", header: "Region", cell: (item: ArtifactFile) => item.region },
    { id: "size", header: "Size", cell: (item: ArtifactFile) => formatSize(item.size) },
    { id: "lastModified", header: "Last modified", cell: (item: ArtifactFile) => formatModified(item.lastModified) },
  ];

  const handleDownload = async () => {
    if (selectedItems.length === 0) return;

    setDownloading(true);
    setDownloadError(null);
    try {
      const zip = new JSZip();
      for (const file of selectedItems) {
        // Derive the run-relative path (after the `_{testRunId}/` folder, or the legacy
        // `results/{testId}/` prefix), then validate it as the zip entry name: `entryNameFor`
        // returns a safe name verbatim (keeping multi-region paths distinct) or `null` to skip,
        // blocking `..`/absolute/drive/UNC zip-slip.
        const relativePath = runRelativePath(file.path, `_${testRunId}/`, searchPath);
        const entryName = entryNameFor(relativePath);
        if (entryName === null) continue; // no safe leaf (empty / NUL) — skip

        const url = await getUrl({ path: file.path });
        const response = await fetch(url.url.toString());
        const blob = await response.blob();
        zip.file(entryName, blob);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(zipBlob);
      link.download = `${testId}_${testRunId}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      console.error("Error downloading files:", error);
      setDownloadError("Failed to download the selected files. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const handleGroupSelectionChange = (type: ArtifactType, selected: ArtifactFile[]) => {
    setSelectedItems((prev) => reconcileSelection(prev, type, selected));
  };

  const renderBody = () => {
    if (loading) {
      return <Spinner />;
    }
    if (error) {
      return <Box color="text-status-error">{error}</Box>;
    }
    return (
      <SpaceBetween size="l">
        <TextFilter
          filteringText={filteringText}
          onChange={({ detail }) => setFilteringText(detail.filteringText)}
          filteringPlaceholder="Filter by filename or region"
        />
        {groups.length === 0 ? (
          <Box color="text-status-inactive">No files match the filter.</Box>
        ) : (
          groups.map((group) => (
            <Table
              key={group.type}
              variant="embedded"
              trackBy="path"
              header={<Header counter={`(${group.items.length})`}>{group.type}</Header>}
              columnDefinitions={columnDefinitions}
              items={group.items}
              selectionType="multi"
              selectedItems={selectedItems.filter((s) => s.type === group.type)}
              onSelectionChange={({ detail }) => handleGroupSelectionChange(group.type, detail.selectedItems)}
              ariaLabels={{
                itemSelectionLabel: (_data, item) => `Select ${item.filename}`,
                selectionGroupLabel: `${group.type} files`,
              }}
              empty="No files"
            />
          ))
        )}
      </SpaceBetween>
    );
  };

  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            s3ConsoleUrl && (
              <Button href={s3ConsoleUrl} target="_blank" iconAlign="right" iconName="external">
                Open in S3
              </Button>
            )
          }
        >
          Test Run Artifacts
        </Header>
      }
    >
      <SpaceBetween size="m">
        {renderBody()}
        {downloadError && (
          <Alert type="error" dismissible onDismiss={() => setDownloadError(null)}>
            {downloadError}
          </Alert>
        )}
        <Button onClick={handleDownload} disabled={selectedItems.length === 0 || downloading} loading={downloading}>
          Download selected files{selectedItems.length > 0 ? ` (${selectedItems.length})` : ""}
        </Button>
      </SpaceBetween>
    </Container>
  );
}
