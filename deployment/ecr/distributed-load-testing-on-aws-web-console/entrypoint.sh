#!/bin/sh
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

set -e

S3_URI="s3://${S3_BUCKET}/${S3_KEY}"

echo "[$(date -Iseconds)] Downloading from $S3_URI"

# AWS CLI has built-in retry with exponential backoff (standard mode)
AWS_MAX_ATTEMPTS=5 aws s3 cp "$S3_URI" /tmp/web-app.zip

echo "[$(date -Iseconds)] Download successful"

# Extract and cleanup
unzip -o /tmp/web-app.zip -d /usr/share/nginx/html/
rm -f /tmp/web-app.zip

# Replace CSP placeholder with exact Cognito domain
if [ -n "$COGNITO_DOMAIN" ]; then
  sed "s|COGNITO_DOMAIN_PLACEHOLDER|${COGNITO_DOMAIN}|g" /etc/nginx/security-headers.conf > /tmp/security-headers.conf
  cat /tmp/security-headers.conf > /etc/nginx/security-headers.conf
  rm -f /tmp/security-headers.conf
  echo "[$(date -Iseconds)] CSP updated with Cognito domain: ${COGNITO_DOMAIN}"
else
  echo "[$(date -Iseconds)] ERROR: COGNITO_DOMAIN not set — cannot configure CSP" >&2
  exit 1
fi

# Start Nginx (runs as non-root, listening on port 8080)
exec nginx -g 'daemon off;'
