// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { TopNavigation, TopNavigationProps } from "@cloudscape-design/components";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { fetchAuthSession } from "aws-amplify/auth";
import { useState, useEffect } from "react";

export default function TopNavigationBar() {
  const { user, signOut } = useAuthenticator();
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    fetchAuthSession()
      .then((session) => {
        const payload = session.tokens?.idToken?.payload;
        if (payload) {
          setDisplayName((payload.name as string) || (payload.email as string) || null);
        }
      })
      .catch(() => {});
  }, [user]);

  const solutionIdentity: TopNavigationProps.Identity = {
    href: "/",
    logo: { src: "/aws-logo.svg", alt: "AWS" },
  };

  const i18nStrings: TopNavigationProps.I18nStrings = {
    overflowMenuTitleText: "All",
    overflowMenuTriggerText: "More",
  };

  const utilities: TopNavigationProps.Utility[] = [
    {
      type: "menu-dropdown",
      text: displayName ?? user.username ?? "User",
      iconName: "user-profile",
      items: [
        {
          id: "documentation",
          text: "Documentation",
          href: "https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/solution-overview.html",
          external: true,
          externalIconAriaLabel: " (opens in new tab)",
        },
        {
          id: "signout",
          text: "Sign Out",
        },
      ],
      onItemClick: async (event) => {
        if (event.detail.id === "signout") {
          await signOut();
        }
      },
    },
  ];

  return <TopNavigation identity={solutionIdentity} i18nStrings={i18nStrings} utilities={utilities} />;
}
