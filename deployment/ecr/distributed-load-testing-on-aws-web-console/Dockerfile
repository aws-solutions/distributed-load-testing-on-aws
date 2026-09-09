# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

FROM public.ecr.aws/nginx/nginx:alpine@sha256:11324f0e6a801732e2c0590b750b8c4c051fd8b1fc74f1f22242440eaf82e010

# Upgrade libexpat to pick up CVE-2026-45186 and CVE-2026-41080 fixes (>= 2.8.1).
# Install AWS CLI for S3 operations (this pulls in python3).
# Then ensure python3 is on the patched 3.14.7 build, which fixes CVE-2026-11972,
# CVE-2026-9669, CVE-2026-11940, CVE-2026-7210, and CVE-2026-15308.
# Then upgrade libssl3 from 3.5.7 to 3.5.8-r0, which fixes CVE-2026-14456,
# CVE-2026-14457, CVE-2026-18798, CVE-2026-54874, CVE-2026-63072, CVE-2026-63073,
# CVE-2026-63074, CVE-2026-63075, CVE-2026-63076, CVE-2026-75803
# Then upgrade libuuid (the only installed util-linux subpackage) from 2.42.1-r0
# to 2.42.3-r1, which fixes CVE-2026-27456, CVE-2026-76642, CVE-2026-78408,
# CVE-2026-78409, and CVE-2026-78410.
RUN apk upgrade --no-cache libexpat && \
    apk add --no-cache aws-cli && \
    apk upgrade --no-cache python3 && \
    apk upgrade --no-cache libssl3 && \
    apk upgrade --no-cache libuuid

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
