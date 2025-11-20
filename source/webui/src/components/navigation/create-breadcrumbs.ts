// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// build an array of breadcrumb items, one for each element of the given path
import { BreadcrumbGroupProps } from "@cloudscape-design/components";

/**
 * 
 * @param path url path
 * @param scenarioName scenario name (if available)
 * @param testRunId test run id (if available)
 * @param testId test id (if available)
 * @param testRunStartTime test run start time (if available)
 * @returns Breadcrumbs to display
 */
export const createBreadcrumbs = (
  path: string, 
  scenarioName?: string, 
  testRunId?: string,
  testId?: string,
  testRunStartTime?: string
): BreadcrumbGroupProps.Item[] => {
  // Gather breadcrumb elements
  // Exclude /testruns/ which does not have its own page 
  // e.g. /scenarios/{testId}/testruns/{testRunId} => Scenarios -> Test ID -> Test Run ID
  const pathElements: string[] = path.split("/").filter(element => element !== "testruns");

  return pathElements.map((currentElement, index) => {
    const previousPathElementsPlusCurrent = pathElements.slice(0, index + 1);
    const href = `${previousPathElementsPlusCurrent.join("/")}`;
    const isLastElement = index === pathElements.length - 1;
    const isTestRunId = !!(testRunId && currentElement === testRunId && isLastElement);
    const isTestId = !!(testId && currentElement === testId);
    
    return { 
      text: getLabelForPathElement(
        currentElement, 
        scenarioName, 
        isTestRunId, 
        isTestId,
        testRunStartTime
      ), 
      href: href || "/" 
    };
  });
};

// Mapping of router path to breadcrumb label
const pathLabels: Record<string, string> = {
  "": "Home",
  scenarios: "Scenarios",
  "create-scenario": "Create Scenario",
  "mcp-server": "MCP Server",
};

/**
 * Format ISO timestamp to readable date and time in local timezone
 * @param isoString ISO 8601 timestamp
 * @returns Formatted date string in local time (e.g., "Nov 10, 2025, 4:07 PM")
 */
function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const dateStr = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    return `${dateStr}, ${timeStr}`;
  } catch {
    return isoString; // Fallback to original string if parsing fails
  }
}

/**
 * Get the display label for a breadcrumb path element
 * @param pathElement Current path element
 * @param scenarioName Name of the scenario/test
 * @param isTestRunId Whether this element is a test run ID
 * @param isTestId Whether this element is a test ID
 * @param testId The test ID value
 * @param testRunStartTime ISO timestamp of test run start
 */
function getLabelForPathElement(
  pathElement: string, 
  scenarioName?: string, 
  isTestRunId?: boolean,
  isTestId?: boolean,
  testRunStartTime?: string
): string {
  const pathLabel = pathLabels[pathElement];
  if (pathLabel) return pathLabel;

  // Test run: show formatted date
  if (isTestRunId && testRunStartTime) {
    return formatDate(testRunStartTime);
  }
  
  // Test run without date: fallback to ID
  if (isTestRunId) {
    return pathElement;
  }
  
  // Test scenario: show scenario name
  if (isTestId && scenarioName) {
    return scenarioName;
  }
  
  // Test scenario without name: fallback to ID
  return pathElement;
}
