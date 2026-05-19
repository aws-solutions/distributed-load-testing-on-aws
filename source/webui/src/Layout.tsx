// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { useContext, useState } from "react";
import { Alert, AppLayout, Flashbar, SpaceBetween } from "@cloudscape-design/components";
import SideNavigationBar from "./components/navigation/SideNavigationBar.tsx";
import { NotificationContext } from "./contexts/NotificationContext.tsx";
import { Outlet, useNavigate } from "react-router-dom";
import { Breadcrumbs } from "./components/navigation/Breadcrumbs.tsx";
import TopNavigationBar from "./components/navigation/TopNavigationBar.tsx";
import { useSelector } from "react-redux";
import { RootState } from "./store/store.ts";
import { STACK_INFO_CACHE_SECONDS, useGetStackInfoQuery } from "./store/stackInfoApiSlice.ts";
import { useGetRegionsQuery } from "./store/regionsSlice.ts";

export default function Layout() {
  const { notifications } = useContext(NotificationContext);
  const navigate = useNavigate();
  const { data: stackInfo } = useGetStackInfoQuery(undefined, { refetchOnMountOrArgChange: STACK_INFO_CACHE_SECONDS });
  useGetRegionsQuery();
  const regionalStacks = useSelector((state: RootState) => state.regions.regionalStacks);
  const [showIncompatibilityBanner, setShowIncompatibilityBanner] = useState(true);
  const [showHubUpdateBanner, setShowHubUpdateBanner] = useState(true);

  const hasIncompatibleRegions =
    regionalStacks?.some((stack) => stack.region !== stackInfo?.region && !stack.compatible) ?? false;
  const isHubUpdateAvailable = stackInfo?.is_update_available === true;

  return (
    <>
      <div id="top-nav">
        <TopNavigationBar />
      </div>
      <div>
        <AppLayout
          headerSelector="#top-nav"
          content={
            <div data-testid={"main-content"}>
              <SpaceBetween size="m">
                {isHubUpdateAvailable && showHubUpdateBanner && (
                  <Alert
                    type="warning"
                    dismissible
                    onDismiss={() => setShowHubUpdateBanner(false)}
                    i18nStrings={{ warningIconAriaLabel: "Warning" }}
                    header="Solution update available"
                  >
                    A newer version of Distributed Load Testing is available.{" "}
                    <a
                      href="/#deployment-setup"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate("/#deployment-setup");
                      }}
                    >
                      View update instructions
                    </a>
                    .
                  </Alert>
                )}
                {hasIncompatibleRegions && showIncompatibilityBanner && (
                  <Alert
                    type="warning"
                    dismissible
                    onDismiss={() => setShowIncompatibilityBanner(false)}
                    i18nStrings={{ warningIconAriaLabel: "Warning" }}
                    header="Multi-region deployments require upgrade"
                  >
                    Your hub is running version {stackInfo?.version}, but your multi-region deployments (spokes) are
                    running an incompatible version.{" "}
                    <a
                      href="/#deployment-setup"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate("/#deployment-setup");
                      }}
                    >
                      View multi-region deployment details
                    </a>
                    .
                  </Alert>
                )}
                <Outlet />
              </SpaceBetween>
            </div>
          }
          contentType={"dashboard"}
          breadcrumbs={<Breadcrumbs />}
          navigation={<SideNavigationBar />}
          notifications={<Flashbar stackItems={true} items={notifications}></Flashbar>}
          stickyNotifications={true}
          ariaLabels={{
            navigation: "Navigation drawer",
            navigationClose: "Close navigation drawer",
            navigationToggle: "Open navigation drawer",
            notifications: "Notifications",
            tools: "Help panel",
            toolsClose: "Close help panel",
            toolsToggle: "Open help panel",
          }}
        />
      </div>
    </>
  );
}
