// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type {
  ArchiveInvestigationResponse,
  CancelInvestigationResponse,
  CreateInvestigationRequest,
  CreateInvestigationResponse,
  Investigation,
  InvestigationFindingsResponse,
  InvestigationStatusResponse,
} from "../models/investigation";
import { ApiEndpoints, solutionApi } from "./solutionApi.ts";

const investigationsPath = (testId: string, testRunId: string) =>
  `${ApiEndpoints.SCENARIOS}/${testId}/testruns/${testRunId}/investigations`;

export const investigationsApiSlice = solutionApi.injectEndpoints({
  endpoints: (builder) => ({
    createInvestigation: builder.mutation<
      CreateInvestigationResponse,
      { testId: string; testRunId: string; body: CreateInvestigationRequest }
    >({
      query: ({ testId, testRunId, body }) => ({
        url: investigationsPath(testId, testRunId),
        method: "POST",
        body,
      }),
      invalidatesTags: (result, error, { testId, testRunId }) => [
        { type: "Investigations", id: `${testId}-${testRunId}` },
      ],
    }),

    listInvestigations: builder.query<Investigation[], { testId: string; testRunId: string }>({
      query: ({ testId, testRunId }) => investigationsPath(testId, testRunId),
      providesTags: (result, error, { testId, testRunId }) => [
        { type: "Investigations", id: `${testId}-${testRunId}` },
      ],
    }),

    getInvestigationStatus: builder.query<
      InvestigationStatusResponse,
      { testId: string; testRunId: string; investigationId: string }
    >({
      query: ({ testId, testRunId, investigationId }) =>
        `${investigationsPath(testId, testRunId)}/${investigationId}/status`,
    }),

    getInvestigationFindings: builder.query<
      InvestigationFindingsResponse,
      { testId: string; testRunId: string; investigationId: string; type?: "investigation" | "mitigation"; format?: "markdown" | "structured" }
    >({
      query: ({ testId, testRunId, investigationId, type = "investigation", format = "markdown" }) =>
        `${investigationsPath(testId, testRunId)}/${investigationId}/findings?type=${type}&format=${format}`,
    }),

    cancelInvestigation: builder.mutation<
      CancelInvestigationResponse,
      { testId: string; testRunId: string; investigationId: string }
    >({
      query: ({ testId, testRunId, investigationId }) => ({
        url: `${investigationsPath(testId, testRunId)}/${investigationId}`,
        method: "PUT",
        body: { action: "cancel" },
      }),
      invalidatesTags: (result, error, { testId, testRunId }) => [
        { type: "Investigations", id: `${testId}-${testRunId}` },
      ],
    }),

    archiveInvestigation: builder.mutation<
      ArchiveInvestigationResponse,
      { testId: string; testRunId: string; investigationId: string }
    >({
      query: ({ testId, testRunId, investigationId }) => ({
        url: `${investigationsPath(testId, testRunId)}/${investigationId}`,
        method: "DELETE",
      }),
      invalidatesTags: (result, error, { testId, testRunId }) => [
        { type: "Investigations", id: `${testId}-${testRunId}` },
      ],
    }),
  }),
});

export const {
  useCreateInvestigationMutation,
  useListInvestigationsQuery,
  useGetInvestigationStatusQuery,
  useGetInvestigationFindingsQuery,
  useCancelInvestigationMutation,
  useArchiveInvestigationMutation,
} = investigationsApiSlice;
