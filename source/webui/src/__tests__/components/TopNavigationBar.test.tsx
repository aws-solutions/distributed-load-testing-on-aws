// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserContext } from "../../contexts/UserContext";
import TopNavigationBar from "../../components/navigation/TopNavigationBar";

const mockSignOut = vi.fn();

const renderWithUser = (username = "test-user") =>
  render(
    <UserContext.Provider value={{ user: { username, userId: "123" }, email: "test@example.com", signOut: mockSignOut, signInWithRedirect: vi.fn() }}>
      <TopNavigationBar />
    </UserContext.Provider>
  );

const renderWithNoUser = () =>
  render(
    <UserContext.Provider value={{ user: null, email: null, signOut: mockSignOut, signInWithRedirect: vi.fn() }}>
      <TopNavigationBar />
    </UserContext.Provider>
  );

describe("TopNavigationBar", () => {
  describe("identity", () => {
    it("renders the AWS logo with correct alt text and src", () => {
      renderWithUser();
      const logos = screen.getAllByAltText("AWS");
      expect(logos[0]).toHaveAttribute("src", "/aws-logo.svg");
    });

    it("renders the logo link pointing to home", () => {
      renderWithUser();
      const logos = screen.getAllByAltText("AWS");
      expect(logos[0].closest("a")).toHaveAttribute("href", "/");
    });
  });

  describe("survey link", () => {
    it("renders the Talk to the DLT team link", () => {
      renderWithUser();
      const links = screen.getAllByText("Talk to the DLT team");
      expect(links.length).toBeGreaterThan(0);
    });

    it("renders the survey link as external with correct href and target", () => {
      renderWithUser();
      const link = screen.getByRole("link", { name: /Talk to the DLT team/i });
      expect(link).toHaveAttribute("href", "https://amazonmr.au1.qualtrics.com/jfe/form/SV_8xnvsbMpmWqrUxM");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("has the correct aria-label for accessibility", () => {
      renderWithUser();
      const link = screen.getByRole("link", { name: /Talk to the DLT team/i });
      expect(link).toHaveAttribute("aria-label", "Talk to the DLT team  (opens in new tab)");
    });
  });

  describe("user dropdown", () => {
    it("renders the user dropdown with username", () => {
      renderWithUser("prototype-user");
      const elements = screen.getAllByText("prototype-user");
      expect(elements.length).toBeGreaterThan(0);
    });

    it("falls back to 'User' when no user is logged in", () => {
      renderWithNoUser();
      const elements = screen.getAllByText("User");
      expect(elements.length).toBeGreaterThan(0);
    });

    it("renders Documentation link in dropdown", async () => {
      renderWithUser();
      const trigger = screen.getAllByText("test-user")[0];
      await userEvent.click(trigger);
      expect(screen.getByText("Documentation")).toBeInTheDocument();
    });

    it("renders Sign Out option in dropdown", async () => {
      renderWithUser();
      const trigger = screen.getAllByText("test-user")[0];
      await userEvent.click(trigger);
      expect(screen.getByText("Sign Out")).toBeInTheDocument();
    });

    it("calls signOut when Sign Out is clicked", async () => {
      renderWithUser();
      const trigger = screen.getAllByText("test-user")[0];
      await userEvent.click(trigger);
      await userEvent.click(screen.getByText("Sign Out"));
      expect(mockSignOut).toHaveBeenCalled();
    });
  });
});
