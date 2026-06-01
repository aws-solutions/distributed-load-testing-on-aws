FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal@sha256:25fb18d93f8f27b0812bdc61354ce1fd27f4aea43c5883b23590d1ccf4a35f61

# Install system dependencies
# Upgrade curl-minimal and libcurl-minimal to pick up CVE-2026-3805 fix (8.17.0-1.amzn2023.0.3)
# Upgrade libgcrypt to pick up CVE-2026-41989 fix (1.10.2-1.amzn2023.0.3)
RUN dnf upgrade -y --refresh && \
    dnf install -y python3.11 python3.11-pip java-21-amazon-corretto bc procps jq findutils unzip tar gzip wget shadow-utils && \
    dnf upgrade -y giflib curl-minimal libcurl-minimal libgcrypt && \
    dnf clean all

ENV PIP_INSTALL="pip3.11 install --no-cache-dir"

# Install Python dependencies
# Pin urwid<4 — urwid 4.0.0 (2026-03-30) removed urwid.decoration module,
# breaking Taurus/bzt which imports it at startup. bzt requires urwid>=3.0.2.
# https://github.com/Blazemeter/taurus/issues/1972
# https://github.com/Blazemeter/taurus/blob/master/requirements.txt
RUN $PIP_INSTALL --upgrade pip && \
    $PIP_INSTALL --upgrade 'urwid==3.0.5' bzt awscli setuptools h11 && \
    $PIP_INSTALL --upgrade 'urwid==3.0.5' bzt

# Create directories and copy application files
RUN mkdir /bzt-configs /tmp/artifacts /frameworks
COPY ./load-test.sh /bzt-configs/
COPY ./k6.json ./locust.json /frameworks/

RUN chmod 755 /bzt-configs/load-test.sh

# Remove vulnerable jaraco.context 5.3.0 vendored in setuptools (GHSA-58pv-8j8x-9vj2)
RUN rm -rf /usr/local/lib/python3.11/site-packages/setuptools/_vendor/jaraco.context-5.3.0.dist-info && \
    rm -rf /usr/local/lib/python3.11/site-packages/setuptools/_vendor/jaraco/context.py

# Remove vulnerable vendored wheel from setuptools 79.0.1.
# bzt will find wheel at /usr/local/lib/python3.11/site-packages/wheel/
RUN rm -rf /usr/local/lib/python3.11/site-packages/setuptools/_vendor/wheel* && \
    rm -rf /usr/local/lib/python3.11/site-packages/setuptools/_vendor/__pycache__/wheel*

# Add settings file to capture the output logs from bzt cli
RUN mkdir -p /etc/bzt.d && echo '{"settings": {"artifacts-dir": "/tmp/artifacts"}}' > /etc/bzt.d/90-artifacts-dir.json

# Temporary fix for CVE-2026-44431
# This must be upgraded after bzt setup to satisfy bzt requirements.txt
RUN $PIP_INSTALL 'urllib3>=2.7.0'

# Temporary fix for CVE-2025-66221 in Werkzeug < 3.1.4
# This must be upgraded after bzt setup to satisfy bzt requirements.txt
RUN $PIP_INSTALL 'werkzeug>=3.1.4'

# Install Locust at the version pinned in locust.json
RUN LOCUST_VERSION=$(jq -r '.version' /frameworks/locust.json) && \
    $PIP_INSTALL "locust==${LOCUST_VERSION}"

# Create non-root user and set permissions
RUN useradd -m -r appuser
RUN chown -R appuser:appuser /bzt-configs /tmp/artifacts /frameworks /etc/bzt.d

USER appuser
WORKDIR /bzt-configs
ENTRYPOINT ["./load-test.sh"]
