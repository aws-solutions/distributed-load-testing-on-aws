// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo } from "react";
import { Container, Header, SpaceBetween, Button } from "@cloudscape-design/components";
import { TestRun } from "../types";
import { formatToLocalTime } from "../../../utils/dateUtils";

interface BaselineContainerProps {
  baselineTestRun: TestRun | null;
  onRemoveBaseline: () => void;
  isRemovingBaseline: boolean;
}

export const TestRunsBaselineContainer: React.FC<BaselineContainerProps> = ({
  baselineTestRun,
  onRemoveBaseline,
  isRemovingBaseline,
}) => {
  const formattedDate = useMemo(() => 
    baselineTestRun ? formatToLocalTime(baselineTestRun.startTime, { hour12: false }) : null, 
    [baselineTestRun?.startTime]
  );

  const removeButton = useMemo(() => (
    <Button variant="normal" onClick={onRemoveBaseline} loading={isRemovingBaseline}>
      Remove Baseline
    </Button>
  ), [onRemoveBaseline, isRemovingBaseline]);

  if (!baselineTestRun) return null;

  return (
    <Container
      header={
        <Header variant="h2" actions={removeButton}>
          Baseline
        </Header>
      }
    >
      <SpaceBetween size="xs">
        <div>Test Run</div>
        <div>{formattedDate}</div>
      </SpaceBetween>
    </Container>
  );
};