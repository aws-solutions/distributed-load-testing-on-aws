// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@cloudscape-design/components";
import { useHelp } from "./HelpContext";
import { helpTopics } from "./content";

interface InfoLinkProps {
  /** Help topic to open; must exist in `helpTopics`. */
  topicId: string;
  ariaLabel?: string;
  /** Link text; defaults to "Info". Use for inline links that name their topic. */
  text?: string;
}

/**
 * Cloudscape "Info" link that opens the contextual help panel on a topic.
 * Renders nothing if the topic id is unknown, so callers can pass a section id
 * that may not have help copy without producing a dead link.
 */
export function InfoLink({ topicId, ariaLabel, text = "Info" }: Readonly<InfoLinkProps>) {
  const { openTopic } = useHelp();

  if (!helpTopics[topicId]) {
    return null;
  }

  return (
    <Link
      variant="info"
      ariaLabel={ariaLabel ?? `Info: ${helpTopics[topicId].title}`}
      onFollow={(event) => {
        event.preventDefault();
        openTopic(topicId);
      }}
    >
      {text}
    </Link>
  );
}
