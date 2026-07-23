// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// On submit, move the user to the first validation error. Cloudscape sets
// aria-invalid="true" on invalid form controls, so we locate the first such
// control in DOM order and focus it. If the first error has no associated
// control (e.g. a section-level message rendered as a StatusIndicator), we fall
// back to scrolling the owning section into view by its data-section-id.

/**
 * Brings the first validation error into view and focuses it.
 * @param fallbackSectionId data-section-id of the section owning the first error,
 *        used when no [aria-invalid] control exists (section-level errors).
 * @param container optional scope to search within (defaults to document).
 * @returns true if an error target was found and scrolled to.
 */
export const scrollToFirstError = (fallbackSectionId?: string, container: ParentNode = document): boolean => {
  const firstInvalid = container.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (firstInvalid) {
    requestAnimationFrame(() => {
      firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
      firstInvalid.focus({ preventScroll: true });
    });
    return true;
  }

  if (fallbackSectionId) {
    const section = container.querySelector<HTMLElement>(`[data-section-id="${fallbackSectionId}"]`);
    if (section) {
      requestAnimationFrame(() => section.scrollIntoView({ behavior: "smooth", block: "center" }));
      return true;
    }
  }

  return false;
};
