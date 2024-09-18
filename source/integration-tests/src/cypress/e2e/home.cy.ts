// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

describe("Home Page", () => {
  it("Loads successfully", () => {
    cy.visit("/");
    cy.contains("Distributed Load Testing");
    cy.contains("Test Scenarios");
  });
});
