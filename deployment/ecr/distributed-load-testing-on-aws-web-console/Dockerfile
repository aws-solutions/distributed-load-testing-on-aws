# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

FROM public.ecr.aws/nginx/nginx:alpine@sha256:e2b2ed196fe2e68c912e3977bf0049ae62f5055c67efe36149f1fc5ad00821b6

# Upgrade every installed package to the latest Alpine release, because the base image
# lags the repo (for example, openssl libssl3 and libcrypto3 >= 3.5.9-r1 for
# CVE-2026-107496, CVE-2026-88823, CVE-2026-95692, CVE-2026-95691, CVE-2026-88822).
# This does not update nginx itself, which comes from nginx.org; bump the digest for that.
# Then install AWS CLI for S3 operations (this pulls in python3).
RUN apk upgrade --no-cache && \
    apk add --no-cache aws-cli

# Copy nginx configuration and entrypoint script
COPY nginx.conf /etc/nginx/nginx.conf
COPY security-headers.conf /etc/nginx/security-headers.conf

COPY entrypoint.sh /usr/local/bin/entrypoint.sh

# Set permissions for the built-in nginx user and switch to it
RUN chmod +x /usr/local/bin/entrypoint.sh && \
    chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx && \
    chown nginx:nginx /etc/nginx/security-headers.conf && \
    rm -f /var/run/nginx.pid

USER nginx
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
