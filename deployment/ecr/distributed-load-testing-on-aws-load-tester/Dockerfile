FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal@sha256:c3b7315ff24b36440abaaddbd13d9a9ec8b351822b96251dfffaabc175ed2896

RUN dnf upgrade -y --refresh && \
    dnf install -y python3.11 python3.11-pip java-21-amazon-corretto bc procps jq findutils unzip && \
    dnf clean all

ENV PIP_INSTALL="pip3.11 install --no-cache-dir"

# install bzt
RUN $PIP_INSTALL --upgrade pip && \
    $PIP_INSTALL --upgrade bzt awscli setuptools h11 && \
    $PIP_INSTALL --upgrade bzt
COPY ./.bzt-rc /root/.bzt-rc
RUN chmod 755 /root/.bzt-rc

# install bzt tools
RUN bzt -install-tools -o modules.install-checker.exclude=selenium,gatling,tsung,siege,ab,k6,external-results-loader,junit,testng,rspec,mocha,nunit,xunit,wdio,robot,newman,playwright
RUN rm -rf /root/.bzt/selenium-taurus

RUN mkdir /bzt-configs /tmp/artifacts
ADD ./load-test.sh /bzt-configs/
ADD ./*.jar /bzt-configs/
ADD ./*.py /bzt-configs/

RUN chmod 755 /bzt-configs/load-test.sh
RUN chmod 755 /bzt-configs/ecslistener.py
RUN chmod 755 /bzt-configs/ecscontroller.py
RUN chmod 755 /bzt-configs/jar_updater.py
RUN python3.11 /bzt-configs/jar_updater.py

# Remove jar files from /tmp
RUN rm -rf /tmp/jmeter-plugins-manager-1* && \
    rm -rf /usr/local/lib/python3.11/site-packages/setuptools-65.5.0.dist-info && \
    rm -rf /usr/local/lib/python3.11/site-packages/urllib3-1.26.17.dist-info

# Remove vulnerable jaraco.context 5.3.0 vendored in setuptools (GHSA-58pv-8j8x-9vj2)
RUN rm -rf /usr/local/lib/python3.11/site-packages/setuptools/_vendor/jaraco.context-5.3.0.dist-info && \
    rm -rf /usr/local/lib/python3.11/site-packages/setuptools/_vendor/jaraco/context.py

# Remove vulnerable vendored wheel from setuptools 79.0.1.
# bzt will find wheel at /usr/local/lib/python3.11/site-packages/wheel/
RUN rm -rf /usr/local/lib/python3.11/site-packages/setuptools/_vendor/wheel* && \
    rm -rf /usr/local/lib/python3.11/site-packages/setuptools/_vendor/__pycache__/wheel*

# Add settings file to capture the output logs from bzt cli
RUN mkdir -p /etc/bzt.d && echo '{"settings": {"artifacts-dir": "/tmp/artifacts"}}' > /etc/bzt.d/90-artifacts-dir.json

# Temporary fix for CVE-2025-66418 and CVE-2025-66471 in urllib3 2.5.0
# This must be upgraded after bzt setup to satisfy bzt requirements.txt
# https://github.com/Blazemeter/taurus/blob/647dd34ab318b5d3060a8c6ce2e5b047a0efddd2/requirements.txt
RUN $PIP_INSTALL 'urllib3>=2.6.0'

# Temporary fix for CVE-2025-66221 in Werkzeug < 3.1.4
# This must be upgraded after bzt setup to satisfy bzt requirements.txt
RUN $PIP_INSTALL 'werkzeug>=3.1.4'

# Create non-root user and set permissions
RUN dnf install -y shadow-utils
RUN dnf install -y tar gzip
RUN useradd -m -r appuser
RUN chown -R appuser:appuser /bzt-configs /tmp/artifacts /root/.bzt /root/.bzt-rc /etc/bzt.d
RUN mv /root/.bzt /home/appuser/.bzt
RUN mv /root/.bzt-rc /home/appuser/.bzt-rc
    
USER appuser
WORKDIR /bzt-configs
ENTRYPOINT ["./load-test.sh"]
