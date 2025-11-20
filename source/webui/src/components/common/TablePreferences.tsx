// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { CollectionPreferences } from "@cloudscape-design/components";

export interface TablePreferencesConfig {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pageSizeOptions: Array<{ value: number; label: string }>;
  columnOptions: Array<{ id: string; label: string; alwaysVisible?: boolean }>;
  preferences: {
    pageSize: number;
    wrapLines: boolean;
    stripedRows: boolean;
    contentDensity: 'comfortable' | 'compact';
    contentDisplay: Array<{ id: string; visible: boolean }>;
    stickyColumns: { first: number; last: number };
  };
  onConfirm: (detail: any) => void;
}

export function TablePreferences({
  title = "Preferences",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  pageSizeOptions,
  columnOptions,
  preferences,
  onConfirm
}: TablePreferencesConfig) {
  return (
    <CollectionPreferences
      title={title}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      preferences={preferences}
      onConfirm={({ detail }) => onConfirm(detail)}
      pageSizePreference={{
        options: pageSizeOptions
      }}
      wrapLinesPreference={{
        label: "Wrap lines",
        description: "Select to see all the text and wrap the lines"
      }}
      stripedRowsPreference={{
        label: "Striped rows",
        description: "Select to add alternating shaded rows"
      }}
      contentDensityPreference={{
        label: "Compact mode",
        description: "Select to display content in a denser, more compact mode"
      }}
      contentDisplayPreference={{
        options: columnOptions
      }}
      stickyColumnsPreference={{
        firstColumns: {
          title: "Stick first column(s)",
          description: "Keep the first column(s) visible while horizontally scrolling the table content.",
          options: [
            { label: "None", value: 0 },
            { label: "First column", value: 1 },
            { label: "First two columns", value: 2 }
          ]
        },
        lastColumns: {
          title: "Stick last column",
          description: "Keep the last column visible while horizontally scrolling the table content.",
          options: [
            { label: "None", value: 0 },
            { label: "Last column", value: 1 }
          ]
        }
      }}
    />
  );
}