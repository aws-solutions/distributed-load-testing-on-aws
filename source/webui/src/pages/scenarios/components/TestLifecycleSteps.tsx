// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import Steps from "@cloudscape-design/components/steps";
import type { StepsProps } from "@cloudscape-design/components/steps";
import { TestStatus } from "../constants";

/**
 * The ordered lifecycle phases shown in the steps indicator.
 * "Processing" combines parsing-results and cleaning-up into one
 * user-facing step since the distinction is an implementation detail.
 */
const LIFECYCLE_PHASES = [
  { key: "queued", label: "Queued" },
  { key: "provisioning", label: "Provisioning" },
  { key: "running", label: "Running" },
  { key: "processing", label: "Processing" },
  { key: "complete", label: "Complete" },
] as const;

/** Maps a TestStatus to its index in LIFECYCLE_PHASES. */
function phaseIndex(status: TestStatus): number {
  switch (status) {
    case TestStatus.QUEUED:
      return 0;
    case TestStatus.PROVISIONING:
      return 1;
    case TestStatus.RUNNING:
      return 2;
    case TestStatus.PARSING_RESULTS:
    case TestStatus.CLEANING_UP:
    case TestStatus.CANCELLING:
      return 3;
    case TestStatus.COMPLETE:
    case TestStatus.CANCELLED:
    case TestStatus.FAILED:
      return 4;
    default:
      return -1;
  }
}

/** True when the test ended in a non-success terminal state. */
function isFailureTerminal(status: TestStatus): boolean {
  return status === TestStatus.CANCELLED || status === TestStatus.FAILED;
}

interface TestLifecycleStepsProps {
  readonly status: TestStatus;
}

export function TestLifecycleSteps({ status }: TestLifecycleStepsProps) {
  const currentIdx = phaseIndex(status);
  const isFailed = isFailureTerminal(status);

  const steps: StepsProps.Step[] = LIFECYCLE_PHASES.map((phase, idx) => {
    let stepStatus: StepsProps.Status;
    let header: string = phase.label;

    if (idx < currentIdx) {
      // Completed phases
      stepStatus = "success";
    } else if (idx === currentIdx) {
      // Current phase
      if (status === TestStatus.COMPLETE) {
        stepStatus = "success";
      } else if (isFailed) {
        stepStatus = "error";
        header = status === TestStatus.CANCELLED ? "Cancelled" : "Failed";
      } else {
        stepStatus = "loading";
      }
    } else {
      // Future phases
      stepStatus = "pending";
    }

    return {
      status: stepStatus,
      statusIconAriaLabel: `${header}: ${stepStatus}`,
      header,
    };
  });

  return (
    <Steps
      steps={steps}
      ariaLabel="Test lifecycle progress"
    />
  );
}
