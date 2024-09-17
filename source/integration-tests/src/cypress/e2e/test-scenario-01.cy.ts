// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

describe("Test Scenario - Simple Test (no script)", () => {
  it("Create successfully", () => {
    cy.visit("/create");

    // input all needed test scenario configurations
    cy.findByLabelText("Name").type("test-scenario-01");
    cy.findByLabelText("Description").type("test scenario 01 description");
    cy.get("div.regional-config-input-row").within(() => {
      cy.get("input#taskCount-0").type("1");
      cy.get("input#concurrency-0").type("1");
      cy.get("select#region-0").select(1);
    }); // getting DOM elements by selector as accessible name is not available in accessibility tree
    cy.findByLabelText("Ramp Up").type("1");
    cy.findByLabelText("Hold For").type("1");
    cy.findByLabelText("HTTP endpoint under test").type("https://example.com");
    cy.findByRole("button", { name: "Run Now" }).click();

    // verify details page is loaded after submitting test
    cy.url().should("include", "/details");
    cy.findByRole("heading", { name: "Load Test Details" });
    cy.findByRole("button", { name: "Refresh" });
    cy.findByRole("button", { name: "Cancel" });
    cy.screenshot();
  });
});
