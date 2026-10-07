FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal@sha256:5c546c873970e79e5c9152cd9c8a9c7013824352bc89071d21feb15ad68496aa

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
#
# Pin bzt — its k6 executor renders the hold stage as (hold-for - ramp-up), which
# compensateK6RampUp in source/api-services/lib/scenarios/index.js cancels out.
# If upstream fixes the line below, drop the compensation in the same change.
# https://github.com/Blazemeter/taurus/blob/1.17.1/bzt/modules/k6.py#L57
RUN $PIP_INSTALL --upgrade pip && \
    $PIP_INSTALL --upgrade 'urwid==3.0.5' 'bzt==1.17.1' awscli setuptools h11 && \
    $PIP_INSTALL --upgrade 'urwid==3.0.5' 'bzt==1.17.1'

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

# Temporary fix for CVE-2026-97687, CVE-2026-97688, and CVE-2026-97689 in urllib3 < 2.8.0
# bzt 1.17.1 pins urllib3==2.7.0, so this must be upgraded after bzt setup
RUN $PIP_INSTALL 'urllib3>=2.8.0'

# Install Locust at the version pinned in locust.json
RUN LOCUST_VERSION=$(jq -r '.version' /frameworks/locust.json) && \
    $PIP_INSTALL "locust==${LOCUST_VERSION}"

# Remove the RPM-provided pip 22.3.1 (CVE-2023-5752, CVE-2025-8869, and others).
# It is unused once pip is upgraded into /usr/local above.
RUN dnf remove -y python3.11-pip && dnf clean all

# Create non-root user and set permissions
RUN useradd -m -r appuser
RUN chown -R appuser:appuser /bzt-configs /tmp/artifacts /frameworks /etc/bzt.d

USER appuser
WORKDIR /bzt-configs
ENTRYPOINT ["./load-test.sh"]
