// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useNavigate } from "react-router-dom";
import { get, post } from "aws-amplify/api";
import { ScenarioDefinition } from "../types";
import { useDeleteScenarioMutation } from "../../../store/scenariosApiSlice";

export const useScenarioActions = () => {
  const navigate = useNavigate();
  const [deleteScenario] = useDeleteScenarioMutation();

  const editScenario = async (testId: string) => {
    try {
      const response = await get({ apiName: "solution-api", path: `/scenarios/${testId}` }).response;
      const scenarioDetails = await response.body.json() as ScenarioDefinition;
      const encodedData = encodeURIComponent(JSON.stringify(scenarioDetails));
      navigate(`/create-scenario?step=0&editData=${encodedData}`);
    } catch (error) {
      console.error('Failed to fetch scenario for editing:', error);
      throw error;
    }
  };

  const copyScenario = async (testId: string) => {
    try {
      const response = await get({ apiName: "solution-api", path: `/scenarios/${testId}` }).response;
      const scenarioDetails = await response.body.json() as ScenarioDefinition;
      const { testId: _, ...scenarioWithoutId } = scenarioDetails;
      const encodedData = encodeURIComponent(JSON.stringify(scenarioWithoutId));
      navigate(`/create-scenario?step=0&copyData=${encodedData}`);
    } catch (error) {
      console.error('Failed to fetch scenario for copying:', error);
      throw error;
    }
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