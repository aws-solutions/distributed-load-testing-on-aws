# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

FROM public.ecr.aws/nginx/nginx:alpine@sha256:e2a398d7d1295a56d5b8548f3d34f7f439692720a0da099548bc06a8dfc36b4a

# Upgrade libexpat to pick up CVE-2026-45186 and CVE-2026-41080 fixes (>= 2.8.1).
# Install AWS CLI for S3 operations
RUN apk upgrade --no-cache libexpat && \
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
