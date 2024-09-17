// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import "@testing-library/cypress/add-commands";

Cypress.Commands.add("authenticate", (sessionName: string) => {
  cy.session(
    sessionName,
    () => {
      cy.visit("/");
      cy.get('input[name="username"]').type(Cypress.env("USERNAME"), { log: false });
      cy.get('input[name="password"]').type(Cypress.env("PASSWORD"), { log: false });
      cy.get('button[type="submit"]').click();
    },
    {
      validate: () => {
        cy.contains("Distributed Load Testing").click();
      },
    }
  );
});
