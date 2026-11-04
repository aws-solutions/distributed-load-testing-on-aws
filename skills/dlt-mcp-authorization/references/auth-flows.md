# DLT MCP Auth Flows Reference

This reference documents the two authorization flows the DLT remote MCP server accepts, the exact scope and endpoints, the registered callback URLs, and where every configuration value originates. All facts are verified against the DLT infrastructure code (`source/infrastructure/lib/mcp/mcp-infra.ts`, `source/infrastructure/lib/mcp/gateway-construct.ts`, and `source/infrastructure/lib/front-end/auth.ts`).

## Architecture

An Amazon Bedrock AgentCore Gateway sits in front of an AWS Lambda function, which calls the DLT REST API (and, for writes, the scenarios S3 bucket). The stack creates the gateway with:

- `protocolType`: `MCP`
- `authorizerType`: `CUSTOM_JWT`
- `authorizerConfiguration.customJwtAuthorizer.discoveryUrl`: `https://cognito-idp.<region>.amazonaws.com/<userPoolId>/.well-known/openid-configuration`
- `authorizerConfiguration.customJwtAuthorizer.allowedClients`: the DLT web user pool client id and the dedicated machine-to-machine (M2M) client id

Consequences for authorization:

- The gateway validates the JWT signature against the Cognito user pool's JSON Web Key Set (JWKS), which it discovers from the OpenID Connect (OIDC) document. It also checks that the token was issued to one of the `allowedClients`.
- Inbound authorization is by client id, not by OAuth scope. The gateway accepts any valid, unexpired Cognito access token issued to an allowed client.
- Two things decide what a caller can actually do: the tool schema the gateway target exposes, and the Lambda's IAM permissions. `MCPServerAccessMode` fixes both at deploy time. See `mcp-tools.md`.

## Deploy-Time Parameters

From `source/infrastructure/lib/common-resources/parameter-spec.ts`:

| Parameter | Allowed values | Default | Effect |
| --- | --- | --- | --- |
| `DeployMCPServer` | `Yes`, `No` | `No` | Whether the MCP server (gateway, Lambda, M2M client, resource server) is created at all. |
| `MCPServerAccessMode` | `ReadWrite`, `ReadOnly` | `ReadOnly` | Read tools only, or read plus write tools. Only applies when `DeployMCPServer=Yes`. Added in v4.3.0; earlier MCP servers expose only the read tools. |

## Cognito App Clients

Two user pool clients are involved.

### Interactive Web Client (Authorization Code with PKCE)

The stack defines it in `auth.ts` as `DLTUserPoolClient`, named `<stack-name>-userpool-client`.

- `generateSecret`: false (a public client, so it must use Proof Key for Code Exchange, PKCE)
- `authFlows`: `userSrp: true` (Secure Remote Password, SRP, which the DLT CLI headless login uses)
- OAuth flows: `authorizationCodeGrant: true`
- OAuth scopes: `openid`, `email`, `profile`
- `refreshTokenValidity`: 1 day; token revocation enabled
- The stack publishes this client id as `aws-exports.json` `PoolClientId` and as the `CognitoAppClientID` stack output.

### Machine-to-Machine Client (client_credentials)

The stack defines it in `mcp-infra.ts` as `DLTUserPoolClientMachineToMachine`, named `<stack-name>-userpool-client-m2m`.

- `generateSecret`: true (confidential client)
- `authFlows`: all disabled (`userPassword`, `userSrp`, `adminUserPassword` all false)
- OAuth flows: `clientCredentials: true`
- OAuth scopes: the resource server scope `dlt-mcp-gateway/read` only
- This client id and secret are not in `aws-exports.json`. Read them from the Cognito console or with `aws cognito-idp describe-user-pool-client`, and load the secret into the environment without printing it, as Step 3 of the skill shows.

### Resource Server and Scope

A `UserPoolResourceServer` with identifier `dlt-mcp-gateway` defines exactly one scope, `read` (description "Read access"). The only fully qualified scope string that exists is therefore:

```
dlt-mcp-gateway/read
```

There is no write scope. `MCPServerAccessMode` controls write capability, not a token scope.

## Flow 1: Interactive, Authorization Code with PKCE

This flow is for a human using Claude Code, Kiro CLI, or another MCP client that runs OAuth. Point clients that do their own discovery at the user pool's OIDC document (see the endpoints table) if they cannot discover the authorization server from the gateway.

1. The client generates a PKCE `code_verifier` and `code_challenge`.
2. The client opens the Cognito Hosted UI authorize endpoint:
   `https://<domain>/oauth2/authorize?response_type=code&client_id=<webClientId>&redirect_uri=<registered callback>&scope=openid+email+profile&code_challenge=<challenge>&code_challenge_method=S256`
3. The user signs in. Cognito redirects to the registered callback with an authorization `code`.
4. The client exchanges the code at the token endpoint:
   `POST https://<domain>/oauth2/token` with `grant_type=authorization_code`, the `code`, `client_id`, `redirect_uri`, and `code_verifier`.
5. Cognito returns `access_token`, `id_token`, and `refresh_token`.
6. The client sends the `access_token` as `Authorization: Bearer <token>` to the MCP endpoint, and the gateway accepts it because the token's client id is in `allowedClients`.

The DLT CLI implements exactly this flow (`dlt login` then `dlt token`), which is a convenient token source for clients that cannot run OAuth themselves.

### Registered Callback URLs

From `auth.ts`, the web client registers these callback URLs in v4.3.0 (logout URLs are the same list):

- The deployed web console URL and its trailing-slash variant (omitted for self-hosted consoles where the URL is unknown at deploy time)
- `http://localhost:3000`
- `http://localhost:3000/`
- `http://localhost:3000/callback`
- `http://localhost:7521/callback`
- `http://localhost:7521`
- `http://127.0.0.1:7521`
- `cursor://anysphere.cursor-mcp/oauth/callback`

v4.3.1 and later add fixed callbacks for common MCP clients, and the v4.3.1 release notes list this change under Fixed as MCP client authentication. On v4.3.0, use one of the callbacks above or a bearer token. The callbacks that v4.3.1 adds are:

| Callback | Client |
| --- | --- |
| `http://localhost:7521/oauth/callback` | Kiro, when `oauth.redirectUri` is set to this value |
| `https://claude.ai/api/mcp/auth_callback` | Claude hosted connectors and Claude Desktop |
| `https://www.cursor.com/agents/mcp/oauth/callback` | Cursor web and agents |
| `http://localhost:8787/callback` | Cursor desktop |
| `http://127.0.0.1:33418` | VS Code and GitHub Copilot Chat |
| `https://vscode.dev/redirect` | VS Code for the web |
| `http://127.0.0.1:19876/mcp/oauth/callback` | OpenCode |

Port 7521 is the shared OAuth callback port for the DLT CLI and for MCP clients that let you pin a port. The CLI falls back to port 3000, which the local dev server also uses. Cognito compares the `redirect_uri` exactly. Its host (`localhost` versus `127.0.0.1`), port, and path must all match a registered entry, or the flow fails with a redirect URI mismatch. These two client patterns work on v4.3.0:

- **DLT CLI**: `dlt login` listens on `http://localhost:7521/callback` (or `http://localhost:3000/callback` if 7521 is busy).
- **Claude Code**: `--callback-port 7521` with `--client-id <webClientId>` produces `http://localhost:7521/callback`.

Kiro builds its callback with the path `/oauth/callback`, which v4.3.0 does not register, so on v4.3.0 give Kiro a bearer token instead of running its OAuth flow. If a person must use Kiro's own OAuth flow on v4.3.0, an administrator can add `http://localhost:7521/oauth/callback` to the web client's callback and logout URLs by hand. A later stack update that changes the client removes the entry, and v4.3.1 and later register it.

The web client allows only the `openid`, `email`, and `profile` scopes. A client that also requests a scope such as `offline_access` fails at Cognito with `invalid_scope`, so pin the scope list in the client configuration.

## Flow 2: Machine to Machine, client_credentials

This flow is for automation and CI/CD.

1. The client authenticates to the token endpoint with the M2M client id and secret (Cognito accepts HTTP Basic auth):
   `POST https://<domain>/oauth2/token`
   Header: `Authorization: Basic base64(clientId:clientSecret)`
   Body: `grant_type=client_credentials&scope=dlt-mcp-gateway/read`
2. Cognito returns `access_token`, `token_type`, and `expires_in`. It issues no refresh token for this grant.
3. The client sends the `access_token` as `Authorization: Bearer <token>` to the MCP endpoint.

When the token expires, repeat the exchange. Fetch a fresh token immediately before a run rather than caching it across long jobs.

## Endpoints and Value Sources

| Value | Where it comes from |
| --- | --- |
| MCP endpoint (gateway URL) | `McpEndpoint` CloudFormation stack output (present only when deployed). Not in `aws-exports.json`. |
| Authorize endpoint | `https://<domain>/oauth2/authorize` |
| Token endpoint | `https://<domain>/oauth2/token` |
| OIDC discovery (gateway's JWT issuer) | `https://cognito-idp.<region>.amazonaws.com/<userPoolId>/.well-known/openid-configuration` |
| Cognito domain | `aws-exports.json` `UserPoolDomain`; pattern `dlt-<uuid>.auth.<region>.amazoncognito.com` (`.auth-fips.` on GovCloud) |
| User pool id | `aws-exports.json` `UserPoolId`, or `CognitoUserPoolID` stack output. Region is its prefix. |
| Web (interactive) client id | `aws-exports.json` `PoolClientId`, or `CognitoAppClientID` stack output |
| M2M client id and secret | Cognito console (App clients, `<stack-name>-userpool-client-m2m`) or `aws cognito-idp describe-user-pool-client` |
| M2M scope | `dlt-mcp-gateway/read` (the only scope that exists) |

## Token Lifetimes

| Token | Default lifetime | Renewal |
| --- | --- | --- |
| Cognito access token | 1 hour | Interactive: refresh token. M2M: re-run client_credentials. |
| Cognito refresh token (interactive only) | 1 day | Re-run the interactive sign-in (`dlt login`) |
| M2M access token | 1 hour | Re-run the client_credentials exchange (no refresh token) |
