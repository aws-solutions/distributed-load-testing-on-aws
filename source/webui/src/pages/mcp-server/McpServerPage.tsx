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
  Spinner
} from "@cloudscape-design/components";
import { fetchAuthSession } from "aws-amplify/auth";
import { useContext, useEffect, useState } from "react";
import { UserContext } from "../../contexts/UserContext";
import { useGetStackInfoQuery } from "../../store/stackInfoApiSlice";

export default function McpServerPage() {
  const { user } = useContext(UserContext);
  const { data: stackInfo } = useGetStackInfoQuery();
  const [accessToken, setAccessToken] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [tokenInfo, setTokenInfo] = useState<{
    issuedAt: Date;
    expiresAt: Date;
  } | null>(null);

  // JWT parsing function with graceful failure
  const parseJwtToken = (token: string) => {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      const payload = parts[1];
      const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);
      const decodedPayload = atob(paddedPayload);
      const parsed = JSON.parse(decodedPayload);
      
      // Validate that we have the required claims
      if (!parsed.iat || !parsed.exp) return null;
      
      return parsed;
    } catch {
      // Silent failure - just return null, don't degrade UX
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
          
          // Attempt to parse JWT - if it fails, just continue without token info
          const parsedToken = parseJwtToken(token);
          if (parsedToken) {
            try {
              const issuedAt = new Date(parsedToken.iat * 1000);
              const expiresAt = new Date(parsedToken.exp * 1000);
              
              // Validate dates are reasonable
              if (issuedAt.getTime() > 0 && expiresAt.getTime() > 0 && expiresAt > issuedAt) {
                setTokenInfo({ issuedAt, expiresAt });
              }
            } catch {
              // Silent failure - don't set tokenInfo, UI won't show timing section
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

  // Empty state when MCP Server is not deployed
  if (!stackInfo?.mcp_endpoint) {
    return (
      <ContentLayout header={<Header variant="h1">MCP Server</Header>}>
        <Container>
          <SpaceBetween size="l">
            <Box textAlign="center">
              <SpaceBetween size="m">
                <Box variant="h2">MCP Server Not Enabled</Box>
                <Box variant="p" color="text-body-secondary">
                  The Distributed Load Testing MCP Server is not currently enabled for this deployment.
                </Box>
                <Alert type="info" header="Enable MCP Server">
                  DLT MCP Server can be enabled by deploying the solution with <strong>DeployMCPServer</strong> set to <strong>Yes</strong>
                </Alert>
              </SpaceBetween>
            </Box>
          </SpaceBetween>
        </Container>
      </ContentLayout>
    );
  }

  // Display details when MCP Server is deployed
  return (
    <ContentLayout header={<Header variant="h1">MCP Server</Header>}>
      <SpaceBetween size="l">
        
        <Container header={<Header variant="h2">MCP Server Endpoint</Header>}>
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
          </SpaceBetween>
        </Container>

        <Container header={<Header variant="h2">Access Token</Header>}>
          <SpaceBetween size="m">

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
        </Container>
      </SpaceBetween>
    </ContentLayout>
  );
}
