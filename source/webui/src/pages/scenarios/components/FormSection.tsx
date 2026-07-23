// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Shared wrapper for the single-page scenario form sections. Renders a plain
// Cloudscape Container (non-collapsible) tagged with a `data-section-id` so the
// submit-time scroll-to-error helper can locate the owning section.

import { Container, Header } from "@cloudscape-design/components";
import { ReactNode } from "react";

interface Props {
  /** Stable section id; also emitted as the `data-section-id` DOM attribute. */
  sectionId: string;
  headerText: string;
  headerDescription?: string;
  children: ReactNode;
}

export const FormSection = ({ sectionId, headerText, headerDescription, children }: Props) => (
  <div data-section-id={sectionId}>
    <Container header={<Header variant="h2" description={headerDescription}>{headerText}</Header>}>
      {children}
    </Container>
  </div>
);
