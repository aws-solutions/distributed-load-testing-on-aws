// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Investigation lifecycle states reported by the DevOps Agent API. The values are
 * the exact wire strings, so these are safe to compare against API responses.
 * The backend keeps its own copy in api-services/lib/investigations/index.js
 * (KNOWN_STATUSES) — the two lists must stay in sync.
 */
export enum InvestigationStatus {
  PENDING_TRIAGE = "PENDING_TRIAGE",
  LINKED = "LINKED",
  PENDING_START = "PENDING_START",
  IN_PROGRESS = "IN_PROGRESS",
  PENDING_CUSTOMER_APPROVAL = "PENDING_CUSTOMER_APPROVAL",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  TIMED_OUT = "TIMED_OUT",
  CANCELED = "CANCELED",
}

export const TERMINAL_STATES: InvestigationStatus[] = [
  InvestigationStatus.COMPLETED,
  InvestigationStatus.FAILED,
  InvestigationStatus.TIMED_OUT,
  InvestigationStatus.CANCELED,
];

export interface Investigation {
  investigationId: string;
  executionId: string;
  agentSpaceId: string;
  agentSpaceApiId: string;
  agentSpaceName: string;
  createdAt: string;
  archived: boolean;
}

export type InvestigationPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "MINIMAL";

export interface CreateInvestigationRequest {
  agentSpaceId: string;
  additionalContext?: string;
  priority?: InvestigationPriority;
}

export interface CreateInvestigationResponse {
  investigationId: string;
  executionId: string;
  agentSpaceId: string;
  agentSpaceApiId: string;
  agentSpaceName: string;
  status: InvestigationStatus;
  createdAt: string;
}

export interface InvestigationStatusResponse {
  investigationId: string;
  status: InvestigationStatus;
  statusReason: string | null;
  createdAt: string;
  agentSpaceName: string;
}

export interface InvestigationFindingsResponse {
  findings: string | null;
  recordType: string | null;
  recordId?: string;
  createdAt?: number;
}

export interface InvestigationFinding {
  id: string;
  title: string;
  description: string;
  type: "root_cause" | "cause" | string;
  cascades_to?: string[];
  related_resources?: string[];
}

export interface InvestigationSymptom {
  title: string;
  description: string;
  start_time?: string;
  end_time?: string;
  related_resources?: string[];
}

export interface InvestigationGap {
  title: string;
  description: string;
}

export interface InvestigationStructuredFindings {
  type: string;
  symptoms: InvestigationSymptom[];
  findings: InvestigationFinding[];
  investigation_gaps: InvestigationGap[];
}

export interface CancelInvestigationRequest {
  action: "cancel";
}

export interface CancelInvestigationResponse {
  investigationId: string;
  status: InvestigationStatus.CANCELED;
  archived: true;
}

export interface ArchiveInvestigationResponse {
  investigationId: string;
  archived: true;
}
