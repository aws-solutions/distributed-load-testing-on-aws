// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import AgentSpaceModal from "../../pages/agent-integration/components/AgentSpaceModal";
import { rootReducer } from "../../store/store";
import { solutionApi } from "../../store/solutionApi";
import { http, HttpResponse } from "msw";
import { server, MOCK_SERVER_URL } from "../server";
import React from "react";

function renderModal(props: Partial<Parameters<typeof AgentSpaceModal>[0]> = {}) {
  const store = configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(solutionApi.middleware),
  });

  const defaultProps = {
    mode: "add" as const,
    onDismiss: vi.fn(),
    onSuccess: vi.fn(),
    ...props,
  };

  const result = render(
    React.createElement(Provider, { store, children:
      React.createElement(AgentSpaceModal, defaultProps)
    })
  );

  return { ...result, ...defaultProps };
}

describe("AgentSpaceModal", () => {
  beforeEach(() => {
    server.use(
      http.get(`${MOCK_SERVER_URL}/agent-spaces`, () => {
        return HttpResponse.json({ Items: [] });
      })
    );
  });

  describe("add mode", () => {
    it("renders with add mode header", () => {
      renderModal({ mode: "add" });
      expect(screen.getByText("Register Agent Space")).toBeInTheDocument();
    });

    it("renders display name and ARN fields", () => {
      renderModal({ mode: "add" });
      expect(screen.getByText("Display name")).toBeInTheDocument();
      expect(screen.getByText("Agent Space ARN")).toBeInTheDocument();
    });

    it("renders Test Connection button", () => {
      renderModal({ mode: "add" });
      expect(screen.getByText("Test Connection")).toBeInTheDocument();
    });

    it("shows info alert about tagging requirement", () => {
      renderModal({ mode: "add" });
      expect(screen.getByText(/dlt-integration: allowed/)).toBeInTheDocument();
    });

    it("Save button is disabled when form is empty", () => {
      renderModal({ mode: "add" });
      const saveBtn = screen.getByText("Save").closest("button");
      expect(saveBtn).toBeDisabled();
    });

    it("shows ARN format error for invalid ARN", async () => {
      renderModal({ mode: "add" });

      // Set ARN to invalid value
      const arnInput = screen.getByPlaceholderText(/arn:aws:aidevops/);
      fireEvent.change(arnInput, { target: { value: "invalid-arn" } });

      // Click test connection
      fireEvent.click(screen.getByText("Test Connection"));

      await waitFor(() => {
        expect(screen.getByText(/Invalid ARN format/)).toBeInTheDocument();
      });
    });

    it("shows connection verified after successful test", async () => {
      server.use(
        http.post(`${MOCK_SERVER_URL}/agent-spaces/test-connection`, () => {
          return HttpResponse.json([{ agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/my-space", status: "connected" }]);
        })
      );

      renderModal({ mode: "add" });

      const arnInput = screen.getByPlaceholderText(/arn:aws:aidevops/);
      fireEvent.change(arnInput, { target: { value: "arn:aws:aidevops:us-east-1:123456789012:agentspace/my-space" } });

      fireEvent.click(screen.getByText("Test Connection"));

      await waitFor(() => {
        expect(screen.getByText("Connection verified")).toBeInTheDocument();
      });
    });
  });

  describe("edit mode", () => {
    const existingSpace = {
      id: "space-1",
      displayName: "My Space",
      agentSpaceArn: "arn:aws:aidevops:us-east-1:123456789012:agentspace/my-space",
      agentSpaceResourceId: "resource-1",
      createdAt: "2025-01-01T00:00:00Z",
      status: "connected" as const,
    };

    it("renders with edit mode header", () => {
      renderModal({ mode: "edit", agentSpace: existingSpace });
      expect(screen.getByText("Edit Agent Space")).toBeInTheDocument();
    });

    it("pre-fills display name from existing agent space", () => {
      renderModal({ mode: "edit", agentSpace: existingSpace });
      const input = screen.getByDisplayValue("My Space");
      expect(input).toBeInTheDocument();
    });

    it("shows ARN as disabled field in edit mode", () => {
      renderModal({ mode: "edit", agentSpace: existingSpace });
      const arnInput = screen.getByDisplayValue(existingSpace.agentSpaceArn);
      expect(arnInput).toBeDisabled();
    });

    it("does not show Test Connection button in edit mode", () => {
      renderModal({ mode: "edit", agentSpace: existingSpace });
      expect(screen.queryByText("Test Connection")).not.toBeInTheDocument();
    });

    it("Save button is disabled when name is unchanged", () => {
      renderModal({ mode: "edit", agentSpace: existingSpace });
      const saveBtn = screen.getByText("Save").closest("button");
      expect(saveBtn).toBeDisabled();
    });

    it("Save button is enabled when name is changed", () => {
      renderModal({ mode: "edit", agentSpace: existingSpace });
      const input = screen.getByDisplayValue("My Space");
      fireEvent.change(input, { target: { value: "Updated Name" } });
      const saveBtn = screen.getByText("Save").closest("button");
      expect(saveBtn).not.toBeDisabled();
    });
  });

  describe("dismiss behavior", () => {
    it("calls onDismiss directly when form is clean", () => {
      const { onDismiss } = renderModal({ mode: "add" });
      fireEvent.click(screen.getByText("Cancel"));
      expect(onDismiss).toHaveBeenCalled();
    });

    it("shows discard confirm when form is dirty", () => {
      renderModal({ mode: "add" });
      // Make form dirty by entering a name
      const nameInput = screen.getByPlaceholderText("My Agent Space");
      fireEvent.change(nameInput, { target: { value: "Dirty" } });

      fireEvent.click(screen.getByText("Cancel"));
      expect(screen.getByText("Discard changes?")).toBeInTheDocument();
    });

    it("returns to form when Keep editing is clicked", () => {
      renderModal({ mode: "add" });
      const nameInput = screen.getByPlaceholderText("My Agent Space");
      fireEvent.change(nameInput, { target: { value: "Dirty" } });

      fireEvent.click(screen.getByText("Cancel"));
      fireEvent.click(screen.getByText("Keep editing"));
      expect(screen.getByText("Register Agent Space")).toBeInTheDocument();
    });

    it("calls onDismiss when Discard is clicked", () => {
      const { onDismiss } = renderModal({ mode: "add" });
      const nameInput = screen.getByPlaceholderText("My Agent Space");
      fireEvent.change(nameInput, { target: { value: "Dirty" } });

      fireEvent.click(screen.getByText("Cancel"));
      fireEvent.click(screen.getByText("Discard"));
      expect(onDismiss).toHaveBeenCalled();
    });
  });
});
