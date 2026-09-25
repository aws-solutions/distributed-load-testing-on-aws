// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { applyTheme, Theme } from "@cloudscape-design/components/theming";

/**
 * Console visual theme, layered on Cloudscape's base theme through the supported
 * theming-runtime tokens — no CSS class-name (`awsui_*`) overrides.
 *
 * - Rounded corners: 12px containers, 8px inputs/buttons, 16px badges
 * - Font: Amazon Ember where the environment provides it, otherwise the bundled
 *   Inter, then system fallbacks. Inter is loaded in `main.tsx` via
 *   `@fontsource/inter` so it renders even when neither font is installed.
 */
const consoleTheme: Theme = {
  tokens: {
    borderRadiusContainer: "12px",
    borderRadiusInput: "8px",
    borderRadiusButton: "8px",
    borderRadiusBadge: "16px",
    fontFamilyBase:
      "'Amazon Ember', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
};

/** Apply the console theme. Call once at startup, before the first render. */
export function applyConsoleTheme(): void {
  applyTheme({ theme: consoleTheme });
}
