#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Obtain a DLT MCP access token via the Cognito client_credentials (M2M) flow.

This helper is for automation and CI/CD. It exchanges a machine-to-machine
Cognito app client id and secret for an access token that the DLT AgentCore
Gateway will accept as an "Authorization: Bearer <token>" header.

It uses only the Python 3 standard library. There is no dependency on boto3,
botocore, or requests, so it runs anywhere Python 3 is available.

The client secret travels in an HTTP Basic header, so the script sends it only
to a Cognito domain:

- By default it accepts only a Cognito prefix domain,
  <prefix>.auth.<region>.amazoncognito.com, or the FIPS form
  <prefix>.auth-fips.<region>.amazoncognito.com that GovCloud uses. DLT v4.3.x
  deploys the prefix domain dlt-<uuid>.
- --allow-custom-domain also accepts another host name, for a user pool that has
  a Cognito custom domain.
- The domain may carry an https:// scheme and a trailing slash, but no other
  scheme, path, port, query, or user information.
- It never follows a redirect, because urllib would resend the Authorization
  header to the new location.

The M2M app client is named "<stack-name>-userpool-client-m2m". Load its secret
into the environment without printing it:

    export DLT_MCP_CLIENT_SECRET="$(aws cognito-idp describe-user-pool-client \\
      --user-pool-id <userPoolId> --client-id <m2mClientId> \\
      --query UserPoolClient.ClientSecret --output text)"

The only scope the M2M client is granted is "dlt-mcp-gateway/read", which is the
default here. Requesting any other scope fails at the token endpoint.

Examples:

    # Secret from the environment (preferred), token captured, not printed
    export DLT_MCP_TOKEN="$(python3 get_mcp_token.py \\
      --domain dlt-<uuid>.auth.<region>.amazoncognito.com \\
      --client-id 1a2b3c4d5e)"

    # Everything from the environment
    export DLT_MCP_DOMAIN='dlt-<uuid>.auth.<region>.amazoncognito.com'
    export DLT_MCP_CLIENT_ID='1a2b3c4d5e'
    python3 get_mcp_token.py

    # A user pool with a Cognito custom domain
    python3 get_mcp_token.py --domain auth.example.com --allow-custom-domain \\
      --client-id 1a2b3c4d5e
"""

import argparse
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_SCOPE = "dlt-mcp-gateway/read"

# <prefix>.auth.<region>.amazoncognito.com, or .auth-fips. for FIPS endpoints such
# as GovCloud. A Cognito domain prefix is lowercase letters, digits, and hyphens.
COGNITO_PREFIX_DOMAIN = re.compile(
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"\.auth(?:-fips)?\.[a-z]{2}(?:-[a-z]+)+-[0-9]+\.amazoncognito\.com"
)
HOST_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")


class DomainError(ValueError):
    """The --domain value is not a host the script will send credentials to."""


class RedirectRefused(urllib.error.URLError):
    """The token endpoint answered with a redirect, which the script never follows."""

    def __init__(self, code: int, location: str):
        super().__init__(f"HTTP {code} redirect to {location}")
        self.code = code
        self.location = location


class RefuseRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Raise instead of following a redirect, so the Basic credentials go nowhere else."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if fp is not None:
            fp.close()
        raise RedirectRefused(code, newurl)


def _is_host_name(host: str) -> bool:
    labels = host.split(".")
    return (
        len(host) <= 253
        and len(labels) >= 2
        and all(HOST_LABEL.fullmatch(label) for label in labels)
        and not labels[-1].isdigit()
    )


def normalize_domain(domain: str, allow_custom_domain: bool = False) -> str:
    """Return the bare, lowercase token host, or raise DomainError.

    Accepts a Cognito prefix domain, and any other host name only when
    allow_custom_domain is true. Strips an https:// scheme and one trailing slash,
    and rejects every other scheme, a path, a port, a query, a fragment, and user
    information.
    """
    value = domain.strip()
    if not value.isascii():
        raise DomainError(f"The domain must be an ASCII host name: {domain!r}")
    scheme, separator, rest = value.partition("://")
    if separator:
        if scheme.lower() != "https":
            raise DomainError(f"The domain must use https, not {scheme}: {domain!r}")
        value = rest
    if value.endswith("/"):
        value = value[:-1]
    for char, part in (("@", "user information"), (":", "a port"), ("/", "a path"),
                       ("?", "a query"), ("#", "a fragment")):
        if char in value:
            raise DomainError(f"The domain must be a bare host name without {part}: {domain!r}")
    host = value.lower()
    if COGNITO_PREFIX_DOMAIN.fullmatch(host):
        return host
    if not _is_host_name(host):
        raise DomainError(f"The domain is not a valid host name: {domain!r}")
    if not allow_custom_domain:
        raise DomainError(
            f"{host} is not a Cognito prefix domain (<prefix>.auth.<region>.amazoncognito.com "
            "or <prefix>.auth-fips.<region>.amazoncognito.com). If it is the user pool's "
            "Cognito custom domain, pass --allow-custom-domain."
        )
    return host


def build_token_opener(*handlers) -> urllib.request.OpenerDirector:
    """Return a urllib opener that refuses redirects. Extra handlers are for tests."""
    return urllib.request.build_opener(RefuseRedirectHandler, *handlers)


def fetch_token(domain: str, client_id: str, client_secret: str, scope: str, timeout: float,
                allow_custom_domain: bool = False, opener=None) -> dict:
    """Perform the client_credentials exchange and return the parsed JSON response.

    Raises SystemExit with a clear message on a rejected domain, a redirect, or any
    HTTP or network error.
    """
    try:
        host = normalize_domain(domain, allow_custom_domain)
    except DomainError as error:
        raise SystemExit(str(error))
    url = f"https://{host}/oauth2/token"
    body = urllib.parse.urlencode(
        {"grant_type": "client_credentials", "scope": scope}
    ).encode("utf-8")

    basic = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    request.add_header("Authorization", f"Basic {basic}")

    opener = opener or build_token_opener()
    try:
        with opener.open(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except RedirectRefused as error:
        raise SystemExit(
            f"The token endpoint {url} answered with {error.reason}. The script does not "
            "follow redirects, so the client credentials were not sent there. Check --domain."
        )
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise SystemExit(
            f"Token request to {url} failed: HTTP {error.code} {error.reason}\n{detail}"
        )
    except urllib.error.URLError as error:
        raise SystemExit(f"Could not reach the token endpoint {url}: {error.reason}")

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise SystemExit(f"Token endpoint returned a non-JSON response:\n{raw}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Obtain a DLT MCP access token via the Cognito client_credentials flow. "
        "The client credentials are sent only to a Cognito prefix domain "
        "(<prefix>.auth.<region>.amazoncognito.com or .auth-fips.), or to a custom domain "
        "with --allow-custom-domain, and never to a redirect target.",
    )
    parser.add_argument(
        "--domain",
        default=os.environ.get("DLT_MCP_DOMAIN"),
        help="Cognito user pool domain, e.g. dlt-<uuid>.auth.<region>.amazoncognito.com "
        "(or set DLT_MCP_DOMAIN). A bare host name, optionally with https:// and a "
        "trailing slash; a path, port, or user information is rejected.",
    )
    parser.add_argument(
        "--allow-custom-domain",
        action="store_true",
        help="Also accept a host outside amazoncognito.com, for a user pool with a Cognito "
        "custom domain. Use it only for a domain you have confirmed belongs to the user pool.",
    )
    parser.add_argument(
        "--client-id",
        default=os.environ.get("DLT_MCP_CLIENT_ID"),
        help="M2M app client id (or set DLT_MCP_CLIENT_ID).",
    )
    parser.add_argument(
        "--client-secret",
        help="M2M app client secret. Avoid this flag, which prints a warning: it puts the secret in "
        "the process list and shell history. Set the DLT_MCP_CLIENT_SECRET environment variable instead.",
    )
    parser.add_argument(
        "--scope",
        default=os.environ.get("DLT_MCP_SCOPE", DEFAULT_SCOPE),
        help=f"OAuth scope to request (default: {DEFAULT_SCOPE}).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="Network timeout in seconds (default: 30).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the full token response as JSON instead of just the access token.",
    )
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.client_secret is not None:
        print("warning: --client-secret puts the secret in the process list and shell history. Set "
              "DLT_MCP_CLIENT_SECRET instead, and rotate the secret if this command line was logged.",
              file=sys.stderr)
    else:
        args.client_secret = os.environ.get("DLT_MCP_CLIENT_SECRET")

    missing = [
        name
        for name, value in (
            ("--domain / DLT_MCP_DOMAIN", args.domain),
            ("--client-id / DLT_MCP_CLIENT_ID", args.client_id),
            ("--client-secret / DLT_MCP_CLIENT_SECRET", args.client_secret),
        )
        if not value
    ]
    if missing:
        raise SystemExit("Missing required value(s): " + ", ".join(missing))

    payload = fetch_token(
        domain=args.domain,
        client_id=args.client_id,
        client_secret=args.client_secret,
        scope=args.scope,
        timeout=args.timeout,
        allow_custom_domain=args.allow_custom_domain,
    )

    if args.json:
        print(json.dumps(payload, indent=2))
        return 0

    token = payload.get("access_token")
    if not token:
        raise SystemExit(f"No access_token in the token response: {json.dumps(payload)}")
    print(token)
    return 0


if __name__ == "__main__":
    sys.exit(main())
