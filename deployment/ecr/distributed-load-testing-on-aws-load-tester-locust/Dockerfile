# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# amazonlinux:2023-minimal
FROM public.ecr.aws/amazonlinux/amazonlinux@sha256:72b79c55b79d724c10e7d36f789a9eb48203229e0ae5ce0e9358ffed5f088540

# Python runs the Locust process and the sidecar; Node runs the DLT entrypoint.
# jq reads the pinned Locust version out of locust.json, matching the sibling
# load-tester image.
RUN dnf upgrade -y --refresh \
    && dnf install -y --setopt=install_weak_deps=0 \
        python3.11 python3.11-pip nodejs24 jq shadow-utils \
    && dnf clean all

# Use the DLT root locust.json as version source of truth
COPY locust.json /opt/dlt/locust.json

# Install Locust at the version pinned in locust.json. The venv is populated here
# at build time only; the runtime user cannot write to /opt.
# Upgrade the venv's bundled pip first to pull in pip security fixes (the
# ensurepip-seeded pip lags the released version).
RUN LOCUST_VERSION=$(jq -r '.version' /opt/dlt/locust.json) \
    && echo "Installing locust ${LOCUST_VERSION}" \
    && python3.11 -m venv /opt/locust \
    && /opt/locust/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/locust/bin/pip install --no-cache-dir "locust==${LOCUST_VERSION}" \
    && /opt/locust/bin/locust --version > /dev/null 2>&1

# Upgrade setuptools version pulled in by venv to address vulnerabilities.
RUN /opt/locust/bin/pip install --no-cache-dir 'setuptools>=83.0.0'

# Put the venv on PATH so the runner can execute `locust`.
ENV PATH="/opt/locust/bin:${PATH}"

COPY locust.js /opt/dlt/main.js
COPY sidecar.py /opt/dlt/sidecar.py

RUN useradd -m -r appuser \
    && mkdir -p /tmp/artifacts \
    && chown appuser:appuser /tmp/artifacts
USER appuser

ENTRYPOINT ["node", "/opt/dlt/main.js"]
