// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import "./commands";

before(() => {
  cy.authenticate(`${Cypress.env("USERNAME")}`);
});

declare global {
  // using Cypress namespace to extend with custom command
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      authenticate(sessionName: string): Chainable<void>;
    }
  }
}
