# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

FROM public.ecr.aws/nginx/nginx:alpine@sha256:aef0e597ba7f3b545950d4a40dfefcf139e5697b221d728ebcff848f13f8dfa2

# Upgrade libexpat to pick up CVE-2026-45186 and CVE-2026-41080 fixes (>= 2.8.1).
# Install AWS CLI for S3 operations (this pulls in python3).
# Then upgrade libx11 from 1.8.13 to 1.8.14-r0 and libxpm from 3.5.19 to 3.5.20-r0,
# which fixes CVE-2026-88806, CVE-2026-94283, CVE-2026-94284, CVE-2026-94285, and
# CVE-2026-94287.
# Then upgrade zlib to >= 1.3.2-r1 (CVE-2026-85091).
RUN apk upgrade --no-cache libexpat && \
    apk add --no-cache aws-cli && \
    apk upgrade --no-cache libx11 libxpm && \
    apk upgrade --no-cache zlib

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
