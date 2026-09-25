// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * @fileoverview Unit tests for the contextual help module (§12.6):
 * HelpProvider/useHelp, InfoLink, HelpPanelContent, and the content catalog.
 */

import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpProvider, HelpPanelContent, InfoLink, helpTopics } from "../../help";

function renderWithHelp(ui: React.ReactNode) {
  return render(
    <HelpProvider>
      {ui}
      <HelpPanelContent />
    </HelpProvider>,
  );
}

describe("help content catalog", () => {
  it("defines the 15 expected topics", () => {
    expect(Object.keys(helpTopics)).toHaveLength(15);
  });

  it("every topic has a title, content, and a resolvable learn-more link", () => {
    for (const topic of Object.values(helpTopics)) {
      expect(topic.title).toBeTruthy();
      expect(topic.content).toBeTruthy();
      expect(topic.learnMoreLabel).toBeTruthy();
      expect(topic.learnMoreUrl).toMatch(/^https:\/\/docs\.aws\.amazon\.com\//);
    }
  });

  it("keeps the tags anchor id while displaying the Keywords label", () => {
    expect(helpTopics.tags.title).toBe("Keywords");
  });
});

describe("InfoLink", () => {
  it("renders for a known topic", () => {
    renderWithHelp(<InfoLink topicId="test-configuration" />);
    expect(screen.getByRole("button", { name: /Info/ })).toBeInTheDocument();
  });

  it("renders nothing for an unknown topic", () => {
    renderWithHelp(<InfoLink topicId="does-not-exist" />);
    expect(screen.queryByRole("button", { name: /Info/ })).not.toBeInTheDocument();
  });

  it("opens the matching topic in the panel when clicked", async () => {
    renderWithHelp(<InfoLink topicId="test-type" />);
    // Panel starts on the empty prompt.
    expect(screen.getByText(/Select an info link/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Info/ }));

    expect(screen.getByRole("heading", { name: "Test type" })).toBeInTheDocument();
    expect(screen.queryByText(/Select an info link/)).not.toBeInTheDocument();
  });
});

describe("HelpPanelContent", () => {
  it("renders bold spans and the learn-more link for the opened topic", async () => {
    renderWithHelp(<InfoLink topicId="tags" />);
    await userEvent.click(screen.getByRole("button", { name: /Info/ }));

    expect(screen.getByRole("heading", { name: "Keywords" })).toBeInTheDocument();
    // Learn-more link resolves to the topic's IG URL.
    const learnMore = screen.getByRole("link", { name: helpTopics.tags.learnMoreLabel });
    expect(learnMore).toHaveAttribute("href", helpTopics.tags.learnMoreUrl);
  });

  it("renders every learn-more link for a topic that has more than one", async () => {
    renderWithHelp(<InfoLink topicId="agent-integration" />);
    await userEvent.click(screen.getByRole("button", { name: /Info/ }));

    const topic = helpTopics["agent-integration"];
    for (const { url, label } of [{ url: topic.learnMoreUrl, label: topic.learnMoreLabel }, ...(topic.learnMoreLinks ?? [])]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", url);
    }
  });
});
