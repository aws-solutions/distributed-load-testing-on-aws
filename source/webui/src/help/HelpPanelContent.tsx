// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Box, HelpPanel, Link, SpaceBetween } from "@cloudscape-design/components";
import { Fragment, ReactNode } from "react";
import { helpTopics } from "./content";
import { useHelp } from "./HelpContext";

/** Render a single line of copy, honoring **bold** spans. */
function renderInline(line: string): ReactNode {
  const segments = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return segments.map((segment, index) => {
    const bold = /^\*\*[^*]+\*\*$/.test(segment);
    const key = `${index}-${segment}`;
    return bold ? <strong key={key}>{segment.slice(2, -2)}</strong> : <Fragment key={key}>{segment}</Fragment>;
  });
}

/**
 * Convert a topic's plain-text content into Cloudscape blocks: blank-line
 * separated paragraphs, with runs of "- " lines grouped into unordered lists.
 */
function renderContent(content: string): ReactNode {
  const blocks: ReactNode[] = [];
  const paragraphs = content.split("\n\n");

  paragraphs.forEach((paragraph, pIndex) => {
    const lines = paragraph.split("\n");
    const isList = lines.every((line) => line.startsWith("- "));

    if (isList) {
      blocks.push(
        <ul key={`p-${pIndex}-${paragraph}`} style={{ margin: 0, paddingLeft: "1.2em" }}>
          {lines.map((line, lIndex) => (
            <li key={`l-${lIndex}-${line}`}>{renderInline(line.slice(2))}</li>
          ))}
        </ul>,
      );
    } else {
      blocks.push(
        <Box key={`p-${pIndex}-${paragraph}`} variant="p">
          {renderInline(paragraph)}
        </Box>,
      );
    }
  });

  return <SpaceBetween size="s">{blocks}</SpaceBetween>;
}

export function HelpPanelContent() {
  const { topicId } = useHelp();
  const topic = topicId ? helpTopics[topicId] : undefined;

  if (!topic) {
    return (
      <HelpPanel header={<h2>Help</h2>}>
        <Box variant="p" color="text-body-secondary">
          Select an info link next to a section to see contextual help here.
        </Box>
      </HelpPanel>
    );
  }

  const learnMoreLinks = [{ url: topic.learnMoreUrl, label: topic.learnMoreLabel }, ...(topic.learnMoreLinks ?? [])];

  return (
    <HelpPanel
      header={<h2>{topic.title}</h2>}
      footer={
        <Box>
          <SpaceBetween size="xs">
            {learnMoreLinks.map((link) => (
              <Link key={link.url} href={link.url} external>
                {link.label}
              </Link>
            ))}
          </SpaceBetween>
        </Box>
      }
    >
      {renderContent(topic.content)}
    </HelpPanel>
  );
}
