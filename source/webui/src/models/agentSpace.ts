// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export interface AgentSpace {
  id: string;
  displayName: string;
  agentSpaceArn: string;
  agentSpaceResourceId: string;
  createdAt: string;
  updatedAt?: string;
}

export interface TestConnectionRequest {
  agentSpaceArns?: string[];
  agentSpaceIds?: string[];
}

export interface TestConnectionResult {
  id: string | null;
  agentSpaceArn: string;
  status: "connected" | "error";
  message?: string;
  verifiedAt?: string;
}
