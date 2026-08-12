FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal@sha256:97daa826f6597bd39ab9dee373290b6ce8220f1686fce5e83b51294a45f7484d

# Install system dependencies
RUN dnf upgrade -y --refresh && \
    dnf install -y python3.11 python3.11-pip java-21-amazon-corretto bc procps jq findutils unzip tar gzip wget shadow-utils && \
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

# Add settings file to capture the output logs from bzt cli
RUN mkdir -p /etc/bzt.d && echo '{"settings": {"artifacts-dir": "/tmp/artifacts"}}' > /etc/bzt.d/90-artifacts-dir.json

# Temporary fix for CVE-2026-59890 in setuptools < 83.0.0
# bzt pins setuptools==79.0.1, so this must be upgraded after bzt setup
RUN $PIP_INSTALL 'setuptools>=83.0.0'

# Install Locust at the version pinned in locust.json
RUN LOCUST_VERSION=$(jq -r '.version' /frameworks/locust.json) && \
    $PIP_INSTALL "locust==${LOCUST_VERSION}"

# Create non-root user and set permissions
RUN useradd -m -r appuser
RUN chown -R appuser:appuser /bzt-configs /tmp/artifacts /frameworks /etc/bzt.d

USER appuser
WORKDIR /bzt-configs
ENTRYPOINT ["./load-test.sh"]
