// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { AgentSpace, TestConnectionRequest, TestConnectionResult } from "../models/agentSpace";
import { ApiEndpoints, solutionApi } from "./solutionApi.ts";

export const agentSpacesApiSlice = solutionApi.injectEndpoints({
  endpoints: (builder) => ({
    listAgentSpaces: builder.query<AgentSpace[], void>({
      query: () => ApiEndpoints.AGENT_SPACES,
      providesTags: ["AgentSpaces"],
    }),

    registerAgentSpace: builder.mutation<AgentSpace, { displayName: string; agentSpaceArn: string }>({
      query: (body) => ({
        url: ApiEndpoints.AGENT_SPACES,
        method: "POST",
        body,
      }),
      invalidatesTags: ["AgentSpaces"],
    }),

    updateAgentSpace: builder.mutation<AgentSpace, { id: string; displayName: string }>({
      query: ({ id, ...body }) => ({
        url: `${ApiEndpoints.AGENT_SPACES}/${id}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["AgentSpaces"],
    }),

    deregisterAgentSpace: builder.mutation<{ message: string }, string>({
      query: (id) => ({
        url: `${ApiEndpoints.AGENT_SPACES}/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["AgentSpaces"],
    }),

    testConnection: builder.mutation<TestConnectionResult[], TestConnectionRequest>({
      query: (body) => ({
        url: `${ApiEndpoints.AGENT_SPACES}/test-connection`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["AgentSpaces"],
    }),
  }),
});

export const {
  useListAgentSpacesQuery,
  useRegisterAgentSpaceMutation,
  useUpdateAgentSpaceMutation,
  useDeregisterAgentSpaceMutation,
  useTestConnectionMutation,
} = agentSpacesApiSlice;
