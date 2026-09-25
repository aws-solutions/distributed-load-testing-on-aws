# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# amazonlinux:2023-minimal
FROM public.ecr.aws/amazonlinux/amazonlinux@sha256:72b79c55b79d724c10e7d36f789a9eb48203229e0ae5ce0e9358ffed5f088540

# Node runs the DLT entrypoint; the JVM runs JMeter. Corretto 21 is the full JDK,
# not the headless build. Common plug-in samplers and listeners may touch java.awt,
# which justifies the larger package size.
#
# JMeter itself is deliberately absent. The solution build packages the pinned
# release and every pinned plug-in into jmeter-bundle.tgz, a deployment-time custom
# resource copies that into the scenarios bucket, and the entrypoint installs it
# into /tmp at container start. tar and gzip unpack it; the plug-in zips
# are extracted by Node.
RUN dnf upgrade -y --refresh \
    && dnf install -y --setopt=install_weak_deps=0 \
        ca-certificates nodejs24 java-21-amazon-corretto tar gzip shadow-utils \
    && dnf clean all

COPY jmeter.js /opt/dlt/main.js

RUN useradd -m -r appuser \
    && mkdir -p /tmp/artifacts \
    && chown appuser:appuser /tmp/artifacts
USER appuser

ENTRYPOINT ["node", "/opt/dlt/main.js"]
