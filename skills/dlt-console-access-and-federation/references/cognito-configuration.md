# DLT Cognito User Pool and App Client Configuration

This reference records the exact Amazon Cognito configuration that gates the Distributed Load Testing on AWS (DLT) console, CLI, and MCP server. Values are verified against the authentication stack (`source/infrastructure/lib/front-end/auth.ts`), the base stack that wires it (`distributed-load-testing-on-aws-base-stack.ts`), the parameter spec (`common-resources/parameter-spec.ts`), and the web console Amplify bootstrap (`source/webui/src/main.tsx`). Use it to confirm what the pool enforces and where each value comes from.

## User Pool

| Setting | Value | Consequence |
| --- | --- | --- |
| Self-signup | Disabled | There is no public registration, so an admin must create every user. |
| Auto-created user | One, from `AdminName` and `AdminEmail` | It is the only user that exists immediately after deploy, and it is invited by email. |
| Sign-in aliases | Username and email | A user can sign in with either. |
| Password policy | Minimum 12 characters; requires lowercase, uppercase, digit, and symbol | Cognito rejects shorter or simpler passwords with `InvalidPasswordException`. |
| Advanced security (threat protection) | Enforced | Cognito can challenge or block risky sign-ins. |
| Email required | Yes, and auto-verified | Email is a standard required attribute. |
| Logging | User authentication events to CloudWatch (10-year retention); notification delivery errors logged | Use these logs to see why a sign-in was challenged or an invite failed to deliver. |
| Removal policy | Destroy | The pool is deleted with the stack. Back up user data before deleting a stack you care about. |

### Invitation Email

Cognito sends the invitation with its default email function, because no Amazon SES sender is configured on the pool. That default sender has a low daily sending quota and is prone to spam filtering. For anything beyond a handful of users, configure SES on the pool. Each invitation includes the username, the temporary password, and the console URL. In headless deployments the console URL is shown as a placeholder, because it is unknown at deploy time.

### Admin-Created User Lifecycle

A user created by an admin (the auto-created admin user, `admin-create-user`, or the console) starts in the force-change-password state with a temporary password. That temporary password is valid only for the first interactive Hosted UI sign-in, during which Cognito requires a new permanent password. SRP-based sign-in (browser SRP and the DLT CLI's headless SRP flow) does not succeed until the user is confirmed with a permanent password. An admin can set a permanent password directly with `admin-set-user-password --permanent`.

## Hosted UI Domain

The Hosted UI uses a UUID-based domain prefix for global uniqueness:

- Commercial partitions: `dlt-<uuid>.auth.<region>.amazoncognito.com`
- AWS GovCloud (US): `dlt-<uuid>.auth-fips.<region>.amazoncognito.com` (FIPS subdomain)

The domain is published to the web console as `UserPoolDomain` in `aws-exports.json`. Key Hosted UI endpoints on this domain:

- Authorize: `https://<domain>/oauth2/authorize`
- Token: `https://<domain>/oauth2/token`
- Logout: `https://<domain>/logout`
- OIDC identity provider response (the redirect URI registered on the provider): `https://<domain>/oauth2/idpresponse`
- SAML identity provider response (the Assertion Consumer Service URL registered on the provider): `https://<domain>/saml2/idpresponse`

At deploy time the stack updates the console's Content Security Policy to include the exact Cognito domain, so the OAuth redirect is allowed. If you self-host the console, your own security headers must allow this domain.

## App Client

The app client is a public client shared by the web console, the CLI, and the interactive MCP flow.

| Setting | Value |
| --- | --- |
| Client secret | None (public client) |
| SRP auth | Enabled (used by the headless CLI sign-in) |
| OAuth flows | Authorization-code grant (Hosted UI); browser flow uses PKCE because the client has no secret |
| OAuth scopes | `openid`, `email`, `profile` |
| Supported identity providers | `COGNITO` only, until you add a federated provider |
| Refresh token validity | 1 day |
| Token revocation | Enabled |
| Refresh token rotation | Enabled, with a 60-second grace period |

The supported identity providers list is the gate for federation. It contains only `COGNITO` by default, so the Hosted UI will not offer any external provider until you add that provider to this list. See [federation-setup.md](federation-setup.md).

### Callback and Logout URLs

The logout URL list is identical to the callback URL list. In v4.3.0 the registered entries are:

- The deployed console URL and its trailing-slash variant. This pair is **excluded** when the console is hosted externally (headless or self-hosted), because the URL is unknown at deploy time.
- Local development server: `http://localhost:3000`, `http://localhost:3000/`, `http://localhost:3000/callback`
- CLI and MCP loopback OAuth on port 7521: `http://localhost:7521/callback`, `http://localhost:7521`, `http://127.0.0.1:7521`
- A fixed MCP client scheme: `cursor://anysphere.cursor-mcp/oauth/callback`

v4.3.1 and later also register the fixed callbacks of common MCP clients:

- Kiro, with `oauth.redirectUri` set to this value: `http://localhost:7521/oauth/callback`
- Claude hosted connectors and Claude Desktop: `https://claude.ai/api/mcp/auth_callback`
- Cursor: `https://www.cursor.com/agents/mcp/oauth/callback` (web and agents) and `http://localhost:8787/callback` (desktop)
- VS Code and GitHub Copilot Chat: `http://127.0.0.1:33418` (desktop) and `https://vscode.dev/redirect` (web)
- OpenCode: `http://127.0.0.1:19876/mcp/oauth/callback`

Cognito matches callbacks exactly, so `localhost` and `127.0.0.1` are not interchangeable, and a path such as `/callback` must match too. If your origin (a self-hosted console, or a client callback) is not on this list, the OAuth flow fails with a redirect mismatch. Add your origin to both the callback and logout URLs, and preserve the existing entries rather than replacing them. A hand-added entry is outside CloudFormation, so a later stack update that changes this client can remove it; re-check after every upgrade. If you use `aws cognito-idp update-user-pool-client`, pass back every current setting from `describe-user-pool-client`, not only the URL lists, because the call resets any setting you omit to its default. Omitting the OAuth flows, the scopes, the SRP auth flow, or the supported identity providers breaks console, CLI, and MCP sign-in. [[dlt-mcp-authorization]] covers which callback each MCP client uses.

## Per Deploy Mode: Console URL and Callback Population

| Mode | Console URL | Callback URLs include the console URL? | Extra requirements |
| --- | --- | --- | --- |
| CloudFront and S3 (default) | CloudFront distribution domain (`https://<id>.cloudfront.net`) | Yes, automatically | None |
| ALB and ECS | `https://<ConsoleDomainName>` | Yes, automatically | ACM certificate in the stack Region covering `ConsoleDomainName`; DNS pointing at the ALB |
| Headless (self-hosted) | Unknown at deploy time (placeholder) | No, excluded by design | You add your hosting origin to the callback and logout URLs manually |

`ConsoleDomainName` must be a valid fully qualified domain name and must match the ACM certificate. `ACMCertificateArn` must reference a certificate in the same Region as the stack.

## Identity Pool and What the Console Can Do After Login

The user pool authenticates the user, and a Cognito identity pool then vends temporary AWS credentials to the signed-in browser. Unauthenticated access is not allowed. With the least privilege it needs, the authenticated role lets the console invoke the DLT REST API (`execute-api:Invoke` on the prod stage). In the solution's S3 bucket, it lets the console read and write objects under the `public/` prefix, where uploaded test scripts live, read objects under `results/` and `regional-template/`, and list the bucket. It also lets the console connect and subscribe to the solution's IoT topics for live run updates. None of this affects how you configure login or federation, because it is internal to DLT.

## aws-exports.json Fields Consumed by the Console

At deploy time a custom resource writes `aws-exports.json`, which the web app fetches at startup and passes to `Amplify.configure`. The auth-relevant fields:

| Field | Meaning |
| --- | --- |
| `UserPoolId` | Cognito user pool id (its prefix is the Region) |
| `PoolClientId` | The public app client id |
| `IdentityPoolId` | The identity pool that vends AWS credentials |
| `UserPoolDomain` | The Hosted UI domain described above |
| `ApiEndpoint` | The DLT REST API base URL |

The console builds the Amplify `Auth.Cognito.loginWith.oauth` block from `UserPoolDomain` and the scopes `openid`, `email`, `profile`, with `responseType: "code"`, and sets both `redirectSignIn` and `redirectSignOut` to the current window origin. This is why the serving origin must be a registered callback URL, and it is the mechanism that makes Hosted UI federation take effect from v4.1 onward.
