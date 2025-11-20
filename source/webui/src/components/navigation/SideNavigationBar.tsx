// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { SideNavigation, SideNavigationProps } from "@cloudscape-design/components";
import { useCallback, useEffect, useState } from "react";
import { NavigateFunction, useLocation, useNavigate } from "react-router-dom";

export default function SideNavigationBar() {
  const navigate: NavigateFunction = useNavigate();
  const [activeHref, setActiveHref] = useState("/");

  const navigationItems: SideNavigationProps["items"] = [
    { type: "link", text: "Dashboard", href: "/" },
    { type: "link", text: "Test Scenarios", href: "/scenarios" },
    { type: "link", text: "MCP Server", href: "/mcp-server" },
    { type: "divider" },
    {
      type: "link",
      external: true,
      href: "https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/solution-overview.html",
      text: "Documentation",
    },
    {
      type: "link",
      external: true,
      href: "https://amazonmr.au1.qualtrics.com/jfe/form/SV_6mwYmfThkyrd7sq",
      text: "Give Feedback",
    },
  ];

  // follow the given router link and update the store with active path
  const handleFollow = useCallback(
    (event: Readonly<CustomEvent>): void => {
      if (event.detail.external || !event.detail.href) return;

      event.preventDefault();

      const path = event.detail.href;
      navigate(path);
    },
    [navigate]
  );

  const location = useLocation();
  useEffect(() => {
    const pathParts = location.pathname.split("/");
    const topLevelPath = pathParts.length > 1 ? `/${pathParts[1]}` : "/";
    setActiveHref(topLevelPath);
  }, [location]);

  const navHeader: SideNavigationProps.Header = {
    href: "/",
    text: "Distributed Load Testing on AWS",
  };

  return <SideNavigation header={navHeader} activeHref={activeHref} onFollow={handleFollow} items={navigationItems} />;
}
