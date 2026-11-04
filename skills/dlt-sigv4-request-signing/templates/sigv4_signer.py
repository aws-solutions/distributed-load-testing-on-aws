# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""AWS Signature Version 4 signer, standard library only.

It needs no boto3 or botocore, so it runs in restricted runtimes such as a DLT
Locust bundle that declares no dependencies. The signer produces the headers
required to authenticate an IAM-authorized request (for example API Gateway with
service "execute-api").

Send the body exactly as signed. When you pass a dict, the payload is
json.dumps(body) with default separators. Use that same string as the request
data rather than letting the HTTP client serialize the dict a second time. Pass a
URL whose path is already percent-encoded the way it goes on the wire; the signer
encodes it once more, as SigV4 requires for every service except Amazon S3.

This is the reference implementation for the dlt-sigv4-request-signing skill. Copy
and adapt it.
"""

import hashlib
import hmac
import json
from datetime import datetime, timezone
from urllib.parse import urlparse, quote, parse_qsl


def _sha256_hex(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def _hmac(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret_key, date_stamp, region, service):
    k_date = _hmac(("AWS4" + secret_key).encode("utf-8"), date_stamp)
    k_region = _hmac(k_date, region)
    k_service = _hmac(k_region, service)
    return _hmac(k_service, "aws4_request")


def _canonical_query(query):
    """Return the canonical, sorted, URI-encoded query string."""
    if not query:
        return ""
    pairs = parse_qsl(query, keep_blank_values=True)
    encoded = [
        (quote(k, safe="-_.~"), quote(v, safe="-_.~")) for k, v in pairs
    ]
    encoded.sort()
    return "&".join(f"{k}={v}" for k, v in encoded)


def sign_request(method, url, credentials, region, service="execute-api",
                 body=None, extra_headers=None):
    """Return the SigV4 headers for a single request.

    Args:
        method: HTTP method, for example "GET" or "POST".
        url: Full request URL including scheme, host, path, and any query.
        credentials: dict with access_key, secret_key, and optional session_token.
        region: AWS region, for example "us-west-2".
        service: AWS service name. API Gateway uses "execute-api".
        body: request body as a str or dict, or None for an empty body.
        extra_headers: optional dict of additional headers to sign.

    Returns:
        A dict of headers to attach to the request: Authorization, x-amz-date,
        x-amz-content-sha256, and x-amz-security-token when using temporary
        credentials.
    """
    access_key = credentials.get("access_key", "")
    secret_key = credentials.get("secret_key", "")
    session_token = credentials.get("session_token", "")

    parsed = urlparse(url)
    host = parsed.netloc
    canonical_uri = quote(parsed.path or "/", safe="/-_.~")
    canonical_querystring = _canonical_query(parsed.query)

    if body is None:
        payload = ""
    elif isinstance(body, str):
        payload = body
    else:
        payload = json.dumps(body)
    payload_hash = _sha256_hex(payload)

    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    # Build the signed header set: always host, x-amz-content-sha256, x-amz-date,
    # and, with temporary credentials, x-amz-security-token (botocore signs it
    # too), plus any lowercased extras.
    headers_to_sign = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    if session_token:
        headers_to_sign["x-amz-security-token"] = session_token
    for name, value in (extra_headers or {}).items():
        headers_to_sign[name.lower()] = str(value).strip()

    signed_headers = ";".join(sorted(headers_to_sign))
    canonical_headers = "".join(
        f"{name}:{headers_to_sign[name]}\n" for name in sorted(headers_to_sign)
    )

    canonical_request = "\n".join([
        method.upper(),
        canonical_uri,
        canonical_querystring,
        canonical_headers,
        signed_headers,
        payload_hash,
    ])

    scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256",
        amz_date,
        scope,
        _sha256_hex(canonical_request),
    ])

    signature = hmac.new(
        _signing_key(secret_key, date_stamp, region, service),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    authorization = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    result = {
        "Authorization": authorization,
        "x-amz-date": amz_date,
        "x-amz-content-sha256": payload_hash,
    }
    if session_token:
        result["x-amz-security-token"] = session_token
    return result
