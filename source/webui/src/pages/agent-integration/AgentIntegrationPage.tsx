// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  Alert,
  Box,
  ColumnLayout,
  Container,
  ContentLayout,
  CopyToClipboard,
  Header,
  Link,
  SpaceBetween,
  Spinner,
} from "@cloudscape-design/components";
import { fetchAuthSession } from "aws-amplify/auth";
import { useContext, useEffect, useState } from "react";
import { UserContext } from "../../contexts/UserContext";
import { STACK_INFO_CACHE_SECONDS, useGetStackInfoQuery } from "../../store/stackInfoApiSlice";
import { usePageLoadMetric } from "../../hooks/usePageLoadMetric";
import DevOpsAgentConnectionsSection from "./components/DevOpsAgentConnectionsSection";

export default function AgentIntegrationPage() {
  const { user } = useContext(UserContext);
  const { data: stackInfo } = useGetStackInfoQuery(undefined, { refetchOnMountOrArgChange: STACK_INFO_CACHE_SECONDS });
  const [accessToken, setAccessToken] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  usePageLoadMetric("AgentIntegration", {
    dataReady: !loading && !!stackInfo && !error,
    extra: { McpEnabled: stackInfo?.mcp_endpoint ? "true" : "false" },
  });
  const [tokenInfo, setTokenInfo] = useState<{
    issuedAt: Date;
    expiresAt: Date;
  } | null>(null);

  const parseJwtToken = (token: string) => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;

      const payload = parts[1];
      const paddedPayload = payload + "=".repeat((4 - (payload.length % 4)) % 4);
      const decodedPayload = atob(paddedPayload);
      const parsed = JSON.parse(decodedPayload);

      if (!parsed.iat || !parsed.exp) return null;

      return parsed;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setAuthChecked(true);
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const getAccessToken = async () => {
      if (!authChecked) {
        return;
      }

      if (!user) {
        setError("User not authenticated");
        setLoading(false);
        return;
      }

      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.accessToken?.toString();

        if (token) {
          setAccessToken(token);

          const parsedToken = parseJwtToken(token);
          if (parsedToken) {
            try {
              const issuedAt = new Date(parsedToken.iat * 1000);
              const expiresAt = new Date(parsedToken.exp * 1000);

              if (issuedAt.getTime() > 0 && expiresAt.getTime() > 0 && expiresAt > issuedAt) {
                setTokenInfo({ issuedAt, expiresAt });
              }
            } catch {
              // Silent failure
            }
          }
        } else {
          setError("No access token found");
        }
      } catch (err) {
        console.error("Error fetching access token:", err);
        setError("Failed to retrieve access token");
      } finally {
        setLoading(false);
      }
    };

    getAccessToken();
  }, [user, authChecked]);

  return (
    <ContentLayout header={<Header variant="h1">Agent Integration</Header>}>
      <SpaceBetween size="l">
        {/* Section 1: MCP Endpoint */}
        <Container header={<Header variant="h2">MCP Endpoint</Header>}>
          {!stackInfo?.mcp_endpoint ? (
            <SpaceBetween size="l">
              <Box textAlign="center">
                <SpaceBetween size="m">
                  <Box variant="h3">MCP Server Not Enabled</Box>
                  <Box variant="p" color="text-body-secondary">
                    The Distributed Load Testing MCP Server is not currently enabled for this deployment.
                  </Box>
                  <Alert type="info" header="Enable MCP Server">
                    DLT MCP Server can be enabled by deploying the solution with <strong>DeployMCPServer</strong> set to{" "}
                    <strong>Yes</strong>
                  </Alert>
                </SpaceBetween>
              </Box>
            </SpaceBetween>
          ) : (
            <SpaceBetween size="m">
              <SpaceBetween size="s">
                <Link href={stackInfo.mcp_endpoint} external>
                  {stackInfo.mcp_endpoint}
                </Link>
                <CopyToClipboard
                  textToCopy={stackInfo.mcp_endpoint}
                  copyButtonText="Copy Endpoint URL"
                  copySuccessText="Copied!"
                  copyErrorText="Failed to copy"
                />
              </SpaceBetween>

              <Alert type="info" header="Security Notice">
                Keep your access token secure and do not share it publicly.
              </Alert>

              {loading && (
                <Box textAlign="center">
                  <Spinner size="normal" />
                  <Box variant="p" color="text-body-secondary">
                    Loading access token...
                  </Box>
                </Box>
              )}

              {error && (
                <Alert type="error" header="Error">
                  {error}
                </Alert>
              )}

              {!loading && !error && accessToken && (
                <SpaceBetween size="s">
                  <CopyToClipboard
                    textToCopy={accessToken}
                    copyButtonText="Copy Access Token"
                    copySuccessText="Copied!"
                    copyErrorText="Failed to copy"
                  />
                </SpaceBetween>
              )}

              {tokenInfo && (
                <SpaceBetween size="s">
                  <Box variant="awsui-key-label">Token Information</Box>
                  <ColumnLayout columns={2} variant="text-grid">
                    <div>
                      <Box variant="awsui-key-label">Issued At</Box>
                      <Box>{tokenInfo.issuedAt.toLocaleString()}</Box>
                    </div>
                    <div>
                      <Box variant="awsui-key-label">Expires At</Box>
                      <Box>{tokenInfo.expiresAt.toLocaleString()}</Box>
                    </div>
                  </ColumnLayout>
                </SpaceBetween>
              )}
            </SpaceBetween>
          )}
        </Container>

        {/* Section 3: DevOps Agent Connections */}
        <DevOpsAgentConnectionsSection />

        {/* Section 4: Documentation */}
        <Container header={<Header variant="h2">Documentation</Header>}>
          <ColumnLayout columns={2} variant="text-grid">
            <div>
              <Box variant="h4">MCP Integration</Box>
              <Box variant="p" color="text-body-secondary">
                Connect your IDE agent to DLT's MCP endpoint for programmatic test management.
              </Box>
              <Link
                href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/mcp-server.html"
                external
              >
                Implementation Guide →
              </Link>
            </div>
            <div>
              <Box variant="h4">DevOps Agent Integration</Box>
              <Box variant="p" color="text-body-secondary">
                Set up autonomous root cause analysis for performance regressions.
              </Box>
              <Link
                href="https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/devops-agent.html"
                external
              >
                Integration Guide →
              </Link>
            </div>
          </ColumnLayout>
        </Container>
      </SpaceBetween>
    </ContentLayout>
  );
}
