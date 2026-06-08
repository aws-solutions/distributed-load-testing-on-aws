# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

FROM public.ecr.aws/nginx/nginx:alpine@sha256:72c9b856fee09b02f9e5ee29ab2b55ae9a3c3b59cf094baef1d05f5914d8cb17

# Upgrade zlib to pick up CVE-2026-22184 and CVE-2026-27171 fix
# Upgrade musl and musl-utils to pick up musl libc qsort stack corruption fix (1.2.5-r23)
# Upgrade libcrypto3 and libssl3 to pick up OpenSSL TLS 1.3 key exchange group negotiation fix (3.5.6-r0)
# Upgrade libpng to pick up CVE-2026-34757 use-after-free fix (1.6.57-r0)
# Upgrade libuuid to pick up CVE-2026-27456 util-linux TOCTOU mount fix (2.41.4-r0)
# Upgrade nghttp2-libs to pick up CVE-2026-27135 HTTP/2 CONTINUATION flood fix (1.69.0-r0)
# Upgrade xz-libs to pick up CVE-2026-34743 fix (5.8.3-r0)
# Upgrade curl to 8.19.0-r0 to pick up CVE-2025-14017, CVE-2025-14524, CVE-2025-14819,
# CVE-2026-1965, CVE-2026-3783, CVE-2026-3784, and CVE-2026-3805 fixes
# Install AWS CLI for S3 operations
RUN apk upgrade --no-cache zlib musl musl-utils libcrypto3 libssl3 libpng libuuid nghttp2-libs xz-libs curl libxml2 && \
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
