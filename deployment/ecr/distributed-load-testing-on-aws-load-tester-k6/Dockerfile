# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# amazonlinux:2023-minimal
FROM public.ecr.aws/amazonlinux/amazonlinux@sha256:8873a7cbc7c3d51d55a749c7c4c7894b7981f0514c269003c7952cf3ed550d27

# Node runs the DLT entrypoint. k6 is deliberately absent from the image and is
# downloaded into /tmp at runtime; tar and gzip unpack its verified release.
RUN dnf upgrade -y --refresh \
    && dnf install -y --setopt=install_weak_deps=0 \
        ca-certificates nodejs24 tar gzip shadow-utils \
    && dnf clean all

COPY k6.json /opt/dlt/k6.json
COPY k6.js /opt/dlt/main.js

RUN useradd -m -r appuser \
    && mkdir -p /tmp/artifacts \
    && chown appuser:appuser /tmp/artifacts
USER appuser

ENTRYPOINT ["node", "/opt/dlt/main.js"]
