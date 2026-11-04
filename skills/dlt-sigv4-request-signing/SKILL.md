---
name: dlt-sigv4-request-signing
description: Sign HTTP requests with AWS Signature Version 4 using only the Python standard library, no boto3 or botocore. Covers the canonical request, string to sign, signing-key derivation, and required headers, plus the Cognito Identity Pool credential-vending flow for cognito_sigv4. Use when a client must SigV4-sign API Gateway (execute-api) or other AWS requests in a runtime where boto3 is unavailable or unwanted, such as a DLT Locust bundle that declares no dependencies. Distributed Load Testing on AWS supports the Reliability Pillar of the AWS Well-Architected Framework (REL07-BP04, REL12-BP03).
license: Apache-2.0
compatibility: Distributed Load Testing on AWS v4.3.0 or a later v4.3.x release. The signer template needs Python 3.9 or later.
---

# SigV4 Request Signing

> This preview covers DLT v4.3.x. If the stack runs v4.4.0 or later, tell the user to reinstall these skills from the `main` branch.

## Overview

AWS Signature Version 4 (SigV4) is the signing protocol AWS uses to authenticate API requests under IAM auth. When an API Gateway method is set to `AuthorizationType.IAM`, clients must SigV4-sign every request. This skill provides a correct, dependency-free implementation for runtimes where `boto3` and `botocore` are not available. The Distributed Load Testing on AWS Locust containers guarantee only the standard library and `locust`. The Standard mode image also carries `PyYAML` and `botocore`, because it installs the AWS CLI from PyPI, but neither is a supported contract, and the Native Locust image installs only Locust and its dependencies. From v4.3.0 a Locust bundle can declare `boto3` in a top-level `requirements.txt`, which DLT installs from PyPI or from bundled wheels in `packages/`. Even so, the standard-library signer avoids that install time, the PyPI egress the install needs without `packages/`, and the dependency itself.

Use this together with `dlt-api-auth-detection` (which tells you whether the type is `sigv4` or `cognito_sigv4`) and `dlt-locust-generation` (which embeds the signer in a generated `helpers.py`).

The reference implementation is [templates/sigv4_signer.py](templates/sigv4_signer.py). Copy and adapt it; do not add third-party dependencies.

## The Algorithm, in Four Steps

SigV4 turns a request plus AWS credentials into an `Authorization` header in four steps.

### 1. Canonical Request

Build a normalized string representation of the request:

```
<HTTP method>\n
<canonical URI: URI-encoded path>\n
<canonical query string: sorted, URI-encoded key=value pairs>\n
<canonical headers: lowercased name:value, sorted by name, each ending in \n>\n
<signed headers: lowercased header names, semicolon-joined>\n
<hex SHA-256 of the request payload>
```

Details that matter:

- Always sign `host`, `x-amz-date`, and `x-amz-content-sha256`. With temporary credentials, also sign `x-amz-security-token`, as botocore does. The `host` must be the request's actual host.
- The payload hash is `sha256("")` for an empty body. Include the same value in the `x-amz-content-sha256` header.
- Encode the path with `/` left unescaped; encode query keys and values. The path is the full path the request goes to, so it includes an API Gateway stage such as `/prod`.

### 2. String to Sign

```
AWS4-HMAC-SHA256\n
<amz-date: YYYYMMDDTHHMMSSZ>\n
<credential scope: YYYYMMDD/<region>/<service>/aws4_request>\n
<hex SHA-256 of the canonical request>
```

For API Gateway the service is `execute-api`.

### 3. Signing Key

Derive the key through a chained HMAC-SHA256, starting from the secret access key:

```
kDate    = HMAC("AWS4" + secret_key, date_stamp)   # date_stamp = YYYYMMDD
kRegion  = HMAC(kDate, region)
kService = HMAC(kRegion, service)
kSigning = HMAC(kService, "aws4_request")
```

### 4. Signature and Headers

```
signature = hex(HMAC(kSigning, string_to_sign))
```

Attach these headers to the request:

- `Authorization: AWS4-HMAC-SHA256 Credential=<access_key>/<scope>, SignedHeaders=<signed_headers>, Signature=<signature>`
- `x-amz-date: <amz-date>`
- `x-amz-content-sha256: <payload hash>`
- `x-amz-security-token: <session token>` only when using temporary credentials. It is one of the signed headers.

## cognito_sigv4: Where the Credentials Come From

For `cognito_sigv4`, the signing algorithm is identical; only the credential source differs. The full client flow is:

1. Authenticate the user against the Cognito **user pool** (for example `InitiateAuth`) to get an ID token.
2. Exchange the ID token for a Cognito **identity** (`GetId`) and then temporary AWS credentials (`GetCredentialsForIdentity`) from the **identity pool**.
3. SigV4-sign each API request with those temporary credentials, including the `x-amz-security-token` header.

For load testing, performing the full Cognito exchange per virtual user is expensive and often unnecessary. Prefer pre-generating temporary credentials and supplying them through the config file, then sign with them directly. Environment variables work for local runs only, because DLT passes no custom environment variables. Temporary credentials expire (commonly after one hour), so long test runs may need refreshed credentials.

## Credentials in a DLT Bundle

A credential that a DLT run signs with travels inside the bundle. DLT stores the bundle in the stack's scenarios bucket, which is versioned and is retained when the stack is deleted. Old versions therefore outlive a new upload, a deleted scenario, and the stack itself. In v4.3.x every console user can also download the bundle, because the console has no role-based access control. Deleting the bundle does not remove the credential, so revoking it or letting it expire is the real control.

- Sign with temporary credentials only, never your own long-term keys. Assume a role whose policy allows only `execute-api:Invoke` on the target API, for a session sized to the test. `AssumeRole` sessions last up to the role's maximum session duration, at most 12 hours, and a session assumed from another role session lasts at most one hour.
- For local runs, read them from `TARGET_AWS_ACCESS_KEY_ID`, `TARGET_AWS_SECRET_ACCESS_KEY`, and `TARGET_AWS_SESSION_TOKEN`, so a config reference cannot pick up the operator's own `AWS_*` credentials.
- When the bundle signs in to a Cognito user pool with a password, use a dedicated test user and change its password after the test.
- If the test ends before the credentials expire, revoke the role's active sessions in IAM.

## Correctness Checklist

- Region and service in the credential scope match the target (API Gateway uses `execute-api`).
- `date_stamp` (YYYYMMDD) and `amz_date` (YYYYMMDDTHHMMSSZ) are derived from the **same** UTC instant.
- The payload hash in the canonical request equals the `x-amz-content-sha256` header value.
- Signed headers are lowercased, sorted, and semicolon-joined, and every one appears in the canonical headers block.
- `x-amz-security-token` is present and signed when and only when using temporary credentials.
- Clock skew is small: SigV4 rejects requests whose `x-amz-date` is more than a few minutes off server time.

## Common Failure Modes

- **SignatureDoesNotMatch**: a mismatch between the canonical request used to sign and the request actually sent. Usual causes are a path signed without its stage prefix, unsigned query parameters, an unsigned header that was sent, or a payload hash that does not match the body.
- **403 with expired token**: temporary credentials aged out mid-run. Refresh them.
- **InvalidSignatureException on clock skew**: the signer and server clocks differ. Use UTC and a current timestamp.
