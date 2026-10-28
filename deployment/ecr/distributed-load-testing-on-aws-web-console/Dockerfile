# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

FROM public.ecr.aws/nginx/nginx:alpine@sha256:30f09579a4d753a8df43dd6275b960760b54b5f12dc5fbd057769772422c7608

# Upgrade libexpat to pick up CVE-2026-45186 and CVE-2026-41080 fixes (>= 2.8.1).
# Install AWS CLI for S3 operations (this pulls in python3).
# Then upgrade libx11 to >= 1.8.14-r0 and libxpm to >= 3.5.20-r0 (CVE-2026-88806,
# CVE-2026-94283, CVE-2026-94284, CVE-2026-94285, and CVE-2026-94287); zlib to
# >= 1.3.2-r1 (CVE-2026-85091); curl and libcurl to >= 8.23.0-r0 (CVE-2026-92392);
# and brotli-libs to >= 1.2.1-r0 (CVE-2026-111497).
RUN apk upgrade --no-cache libexpat && \
    apk add --no-cache aws-cli && \
    apk upgrade --no-cache libx11 libxpm && \
    apk upgrade --no-cache zlib && \
    apk upgrade --no-cache curl libcurl brotli-libs

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
