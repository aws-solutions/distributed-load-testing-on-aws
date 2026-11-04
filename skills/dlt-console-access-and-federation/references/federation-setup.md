# Federation Setup Checklist: Okta and Microsoft Entra ID (Azure AD)

This checklist adds an external identity provider in front of the Distributed Load Testing on AWS (DLT) Cognito user pool. Operators then sign in to the DLT console with corporate credentials. It covers OIDC and SAML, with the specifics for Okta and Microsoft Entra ID (formerly Azure AD).

Read the version caveat before starting. On unsupported versions none of these steps produce a working federated login.

## Version Caveat

Federation for the DLT console is effective only from the **v4.1 Hosted UI onward**.

- v4.1.0 and later use the Cognito Hosted UI with the OAuth authorization-code flow. The console redirects sign-in to the Hosted UI, so a provider attached to the pool and enabled on the app client appears there and works.
- Before v4.1.0 the console used the embedded Amplify authenticator over the SRP flow. That flow does not route through the Hosted UI, and the Amplify configuration did not consume the OAuth section, so an external provider had no effect. Do not attempt to patch the built bundle; upgrade to a supported version instead.

Confirm your deployed version before continuing.

## Prerequisites

- A supported DLT version (v4.1.0 or later).
- Administrative access to the DLT Cognito user pool and its app client.
- Administrative access to the identity provider (Okta or Entra ID) to create an application and read its metadata or client credentials.
- The Hosted UI domain for this deployment: `dlt-<uuid>.auth.<region>.amazoncognito.com` (GovCloud uses `.auth-fips.`). Read it from `aws-exports.json` (`UserPoolDomain`).
- Change approval, because these edits modify a deployed user pool that you should treat as production.

## Two Callback URLs, Do Not Confuse Them

Federation involves two distinct redirect URLs. Getting these right is most of the work.

1. **Provider to Cognito (the idpresponse endpoint).** Register this on the identity provider side. The path depends on the protocol ([OIDC](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-oidc-idp.html), [SAML](https://docs.aws.amazon.com/cognito/latest/developerguide/saml2-idpresponse-endpoint.html)):
   - OIDC sign-in redirect URI: `https://dlt-<uuid>.auth.<region>.amazoncognito.com/oauth2/idpresponse`
   - SAML Assertion Consumer Service (ACS) URL: `https://dlt-<uuid>.auth.<region>.amazoncognito.com/saml2/idpresponse`
2. **Cognito to the DLT console (the app client callback).** This is the console's own origin, and it must be present in the app client's callback and logout URLs. The stack registers it automatically for CloudFront and ALB deployments; for a headless or self-hosted console you add it yourself.

## Step-by-Step

### 1. Create the App on the Identity Provider Side

**OIDC (Okta or Entra ID):** create an OIDC web application. Record the issuer URL, client id, and client secret. Set the allowed sign-in redirect URI to the OIDC `/oauth2/idpresponse` endpoint above. Grant the scopes `openid`, `email`, and `profile`.

- Okta: create an OIDC app integration of type Web Application. The issuer is your Okta org or authorization server URL. Add the `/oauth2/idpresponse` endpoint as a Sign-in redirect URI.
- Entra ID: register an application, create a client secret, and add the `/oauth2/idpresponse` endpoint as a Web redirect URI. The OIDC issuer is `https://login.microsoftonline.com/<tenant-id>/v2.0`.

**SAML (Okta or Entra ID):** create a SAML application and obtain its federation metadata (a URL is preferable to a static document because it lets Cognito refresh signing certificates). Set the Assertion Consumer Service (ACS) URL to the SAML `/saml2/idpresponse` endpoint above, and set the SP entity id (audience) to `urn:amazon:cognito:sp:<userPoolId>`.

**Restrict sign-in to assigned users (required).** Federation replaces the DLT admin-invite model. Cognito creates a user profile the first time anyone the provider admits signs in, and DLT v4.3.x has no roles, so every federated user gets full DLT access, including launching load tests. Limit the application to the people who should run load tests before step 4 enables it on the app client:

- Okta: apps admit only assigned users. Assign the app to a group of DLT operators, not to Everyone.
- Entra ID: Assignment required defaults to No, which admits every user in the tenant. Under Enterprise applications, open the application's Properties, set Assignment required to Yes, and assign a group of DLT operators under Users and groups.

### 2. Create the Identity Provider in Cognito

In the user pool, under Sign-in experience, add a federated identity provider.

- OIDC: supply the issuer, client id, client secret, and the scopes `openid email profile`.
- SAML: supply the metadata document or, preferably, the metadata URL from step 1.

Give the provider a stable name; you will reference it on the app client.

From the AWS CLI, an OIDC provider takes one call. Its input holds the client secret, so write the input to a private temporary file instead of a command-line argument, and delete the file afterward. Do not pipe it through `file:///dev/stdin`, because AWS CLI v2 on macOS rejects that input. The operator runs this block in their own terminal: `read -rs` waits silently for the secret to be pasted and does not echo it, so the secret never appears on a command line, in shell history, or in an agent's transcript. The `--query` option prints only the provider name, because the full response echoes `ProviderDetails`, including the secret.

```bash
(
  set -e
  umask 077
  read -rs IDP_CLIENT_SECRET; export IDP_CLIENT_SECRET
  T=$(mktemp)
  trap 'rm -f "$T"' EXIT INT TERM
  jq -n --arg pool "<userPoolId>" --arg name "<ProviderName>" '{
    UserPoolId: $pool, ProviderName: $name, ProviderType: "OIDC",
    ProviderDetails: {
      client_id: "<client-id>", client_secret: env.IDP_CLIENT_SECRET,
      authorize_scopes: "openid email profile", oidc_issuer: "<issuer-url>",
      attributes_request_method: "GET" },
    AttributeMapping: { email: "email" } }' > "$T"
  aws cognito-idp create-identity-provider --region <region> --cli-input-json "file://$T" \
    --query 'IdentityProvider.ProviderName' --output text
)
```

The block runs in a subshell, so the `umask`, the trap, and the secret variable end with it. The trap deletes the file even when the block is interrupted, and `set -e` stops the block at the first failed command.

### 3. Map Attributes

Map provider claims to Cognito attributes so users resolve correctly. At minimum:

- Map the provider's email claim to the Cognito `email` attribute.
- For SAML, the email claim is commonly `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`. For OIDC it is usually `email`.

Map any additional attributes your access policies rely on. Incomplete email mapping can make federated users fail to sign in or appear as duplicate accounts. When the provider sends a value for a mapped attribute that the app client cannot write, Cognito [does not set the attribute and proceeds with sign-in](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-specifying-attribute-mapping.html), so the user profile silently lacks that value. The DLT web client can write only `address`, `email`, and `phone_number`, so map only those.

### 4. Enable the Provider on the DLT App Client

Add the new provider to the app client's supported identity providers list. This list contains only `COGNITO` by default, so until you add your provider the Hosted UI will not offer it.

- Keep `COGNITO` in the list to retain a local admin sign-in path (useful as a break-glass account).
- Remove `COGNITO` only if you intend to force federation for everyone and you are confident you will not lock yourself out.

Confirm the app client's OAuth authorization-code grant and the scopes `openid`, `email`, `profile` remain enabled.

From the AWS CLI, `update-user-pool-client` resets every setting you leave out, so pass back the client's full current configuration with the provider added. The `jq` filter adds your provider to the current list and keeps every provider already there, so it keeps `COGNITO` when the client has it and does not restore `COGNITO` after an administrator removed it on purpose. Keep `client-before.json` to roll back.

```bash
aws cognito-idp describe-user-pool-client --region <region> --user-pool-id <userPoolId> \
  --client-id <webClientId> --query UserPoolClient --output json > client-before.json
jq --arg idp "<ProviderName>" 'del(.CreationDate, .LastModifiedDate)
  | .SupportedIdentityProviders = ((.SupportedIdentityProviders // []) + [$idp] | unique)' \
  client-before.json > client-update.json
aws cognito-idp update-user-pool-client --region <region> --cli-input-json file://client-update.json
```

### 5. Confirm the Console Callback and Logout URLs

The federated flow returns to the same console origin as the local flow. Ensure that origin is in the app client's callback and logout URLs:

- CloudFront and ALB deployments: the stack registers it automatically.
- Headless or self-hosted: add your console origin (scheme and host, plus the trailing-slash variant) to both lists. Preserve the existing entries.

### 6. Verify

1. Open the DLT console. The Hosted UI should now present the federated provider as a sign-in option.
2. Sign in with a corporate account. You should return to the console authenticated.
3. Confirm the user appears in the Cognito user pool as a federated user with the expected email.

## Common Failure Modes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Federated option does not appear on the Hosted UI | Provider not added to the app client's supported identity providers | Add it in step 4 |
| Sign-in fails at the identity provider (redirect or reply URL error) | The provider does not have the idpresponse endpoint for its protocol: `/oauth2/idpresponse` as the OIDC redirect URI, or `/saml2/idpresponse` as the SAML ACS URL | Register it in step 1 |
| Sign-in fails on return to the console (redirect mismatch) | The console origin is not a registered callback URL | Add it in step 5 |
| User authenticates but is missing email or looks duplicated | Email claim not mapped to the Cognito `email` attribute | Fix attribute mapping in step 3 |
| Federation works but nothing changed for existing local users | This is expected. Local Cognito users still sign in with `COGNITO` unless you removed it from the supported providers | No action, or remove `COGNITO` to force federation |
| Nothing works regardless of configuration | DLT version predates the v4.1 Hosted UI | Upgrade to a supported version; do not patch the bundle |

## Guardrails

- Get change approval before editing the pool or app client; these are production resources.
- Keep a break-glass local admin account (retain `COGNITO` on the app client) until federation is proven, so a provider outage cannot lock you out.
- Treat OIDC client secrets and SAML signing material as credentials. Store them in a secret manager, never in version control.
- Do not disable advanced security or other safeguards to make federation work. Fix the specific mapping or redirect problem instead.
