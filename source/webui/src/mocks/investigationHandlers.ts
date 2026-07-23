// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { http, HttpResponse, delay } from "msw";
import type { AgentSpace } from "../models/agentSpace";
import type { CreateInvestigationResponse, InvestigationStatusResponse, InvestigationFindingsResponse } from "../models/investigation";

const ok = async (payload: object, status = 200) => {
  await delay(200);
  return HttpResponse.json(payload, { status, headers: [["Access-Control-Allow-Origin", "*"]] });
};

// ─── Mock Data ─────────────────────────────────────────────────────────────────

const mockAgentSpaces: AgentSpace[] = [
  {
    id: "test-space-001",
    displayName: "My Test Space",
    agentSpaceArn: "arn:aws:aidevops:us-west-2:111122223333:agentspace/aaaabbbb-1111-2222-3333-444455556666",
    agentSpaceResourceId: "aaaabbbb-1111-2222-3333-444455556666",
    createdAt: "2026-06-09T00:00:00.000Z",
  },
];

const mockCreateResponse: CreateInvestigationResponse = {
  investigationId: "task-mock-001",
  executionId: "exec-mock-001",
  agentSpaceId: "as-001",
  agentSpaceApiId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  agentSpaceName: "Production Agent Space",
  status: "PENDING_START",
  createdAt: "2026-06-01T12:00:00.000Z",
};

const mockStatusResponse: InvestigationStatusResponse = {
  investigationId: "task-mock-001",
  status: "IN_PROGRESS",
  statusReason: null,
  createdAt: "2026-06-01T12:00:00.000Z",
  agentSpaceName: "Production Agent Space",
};

const mockFindingsResponse: InvestigationFindingsResponse = {
  findings: JSON.stringify({
    type: "investigation_summary",
    symptoms: [
      {
        title: "DLT test 1xenrQiO2W - 100% request failure rate against DevopsPiggy API",
        description: "DLT load test 1xenrQiO2W (run Y0ApU0nXUK) targeting https://2rkmkzvz20.execute-api.us-west-2.amazonaws.com/prod/items completed with 86,914 failed requests and 0 successful requests (100% failure rate).",
        start_time: "2026-06-12T22:19:07Z",
        end_time: "2026-06-12T22:23:56Z",
        related_resources: ["DevopsPiggy REST API", "Items Handler Lambda"],
      },
    ],
    findings: [
      {
        id: "cause-missing-auth",
        title: "DLT test client sent unauthenticated requests to auth-protected DevopsPiggy API",
        description: "The DLT test sent 86,914 requests without the required IAM SigV4 signing and x-api-key header. API Gateway rejected 100% of requests at the authorization layer with 4XX responses before they reached the Lambda backend.",
        type: "root_cause",
        cascades_to: ["symptom-100pct-request-failures"],
        related_resources: ["DevopsPiggy REST API", "Distributed Load Testing"],
      },
      {
        id: "cause-concurrency-set-to-1",
        title: "CDK deployment set Lambda ReservedConcurrentExecutions to 1 (latent issue)",
        description: "A CDK deployment set the Lambda function ReservedConcurrentExecutions to 1. While this did not cause the current failure, it represents a latent issue that would produce throttling if authentication were fixed.",
        type: "cause",
        cascades_to: ["symptom-100pct-request-failures"],
        related_resources: ["Items Handler Lambda"],
      },
    ],
    investigation_gaps: [
      {
        title: "DLT test configuration details unavailable",
        description: "Could not inspect the actual DLT test configuration to confirm whether IAM SigV4 signing and API key headers were configured.",
      },
    ],
  }),
  recordType: "investigation_summary",
  recordId: "rec-001",
  createdAt: 1717243200,
};

// ─── Handlers ──────────────────────────────────────────────────────────────────

export const investigationHandlers = (apiUrl: string) => [
  // Agent Spaces
  http.get(`${apiUrl}/agent-spaces`, () => ok(mockAgentSpaces)),

  http.post(`${apiUrl}/agent-spaces`, async ({ request }) => {
    const body = (await request.json()) as { displayName: string; agentSpaceArn: string };
    const newSpace: AgentSpace = {
      id: `as-${Date.now()}`,
      displayName: body.displayName,
      agentSpaceArn: body.agentSpaceArn,
      agentSpaceResourceId: body.agentSpaceArn.split("/").pop() ?? "",
      createdAt: new Date().toISOString(),
    };
    return ok(newSpace, 201);
  }),

  http.put(`${apiUrl}/agent-spaces/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Partial<AgentSpace>;
    const updated: AgentSpace = { ...mockAgentSpaces[0], ...body, id: params.id as string };
    return ok(updated);
  }),

  http.delete(`${apiUrl}/agent-spaces/:id`, () => ok({ message: "Agent Space removed" })),

  http.post(`${apiUrl}/agent-spaces/test-connection`, async ({ request }) => {
    const body = (await request.json()) as { agentSpaceArns?: string[]; agentSpaceIds?: string[] };
    const results = [
      ...(body.agentSpaceIds || []).map((id) => ({
        id,
        agentSpaceArn: mockAgentSpaces[0]?.agentSpaceArn ?? "arn:aws:aidevops:us-east-1:123456789012:agentspace/mock",
        status: "connected" as const,
        verifiedAt: new Date().toISOString(),
      })),
      ...(body.agentSpaceArns || []).map((arn) => ({
        id: null,
        agentSpaceArn: arn,
        status: "connected" as const,
        verifiedAt: new Date().toISOString(),
      })),
    ];
    return ok(results);
  }),

  // Investigations
  http.post(`${apiUrl}/scenarios/:testId/testruns/:testRunId/investigations`, () => ok(mockCreateResponse, 201)),

  http.get(`${apiUrl}/scenarios/:testId/testruns/:testRunId/investigations`, () =>
    ok([{ ...mockCreateResponse, archived: false }]),
  ),

  http.get(`${apiUrl}/scenarios/:testId/testruns/:testRunId/investigations/:investigationId/status`, () =>
    ok(mockStatusResponse),
  ),

  http.get(`${apiUrl}/scenarios/:testId/testruns/:testRunId/investigations/:investigationId/findings`, () =>
    ok(mockFindingsResponse),
  ),

  http.put(`${apiUrl}/scenarios/:testId/testruns/:testRunId/investigations/:investigationId`, () =>
    ok({ investigationId: "task-mock-001", status: "CANCELED", archived: true }),
  ),

  http.delete(`${apiUrl}/scenarios/:testId/testruns/:testRunId/investigations/:investigationId`, () =>
    ok({ investigationId: "task-mock-001", archived: true }),
  ),
];
