# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# amazonlinux:2023-minimal
FROM public.ecr.aws/amazonlinux/amazonlinux@sha256:d4495d25da60ef3f2d44bc7f6a2dd2ec1646c14414e0dfaaa44dc3ff653e1c2b

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
