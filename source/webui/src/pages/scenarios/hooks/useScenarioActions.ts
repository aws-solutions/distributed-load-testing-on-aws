// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useNavigate } from "react-router-dom";
import { post } from "aws-amplify/api";
import { useDeleteScenarioMutation } from "../../../store/scenariosApiSlice";

export const useScenarioActions = () => {
  const navigate = useNavigate();
  const [deleteScenario] = useDeleteScenarioMutation();

  const editScenario = (testId: string) => {
    navigate(`/scenarios/${testId}/edit`);
  };

  const copyScenario = (testId: string) => {
    navigate(`/scenarios/create?cloneFrom=${testId}`);
  };

  const cancelTestRun = async (testId: string) => {
    try {
      await post({ apiName: "solution-api", path: `/scenarios/${testId}`, options: { body: { action: "stop" } } }).response;
      return { success: true };
    } catch (error) {
      console.error('Failed to cancel test run:', error);
      throw error;
    }
  };

  return {
    editScenario,
    copyScenario,
    cancelTestRun,
    deleteScenario
  };
};