FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal@sha256:c9a8457247e453f635fda07121cce4fc16c2219290ca4e5494959e6452fc0244

RUN dnf upgrade -y && \
    dnf install -y python3.11 python3.11-pip java-21-amazon-corretto bc procps jq findutils unzip && \
    dnf clean all

ENV PIP_INSTALL="pip3.11 install --no-cache-dir"

# install bzt and upgrade pip/setuptools, then remove vulnerable system packages
RUN $PIP_INSTALL --upgrade pip==25.2 setuptools==80.9.0 && \
    $PIP_INSTALL --upgrade bzt awscli h11 urllib3==2.5.0 && \
    $PIP_INSTALL --upgrade Flask-Cors==6.0.1 && \
    dnf remove -y python3.11-setuptools python3.11-pip && \
    dnf clean all
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

# Add settings file to capture the output logs from bzt cli
RUN mkdir -p /etc/bzt.d && echo '{"settings": {"artifacts-dir": "/tmp/artifacts"}}' > /etc/bzt.d/90-artifacts-dir.json

WORKDIR /bzt-configs
ENTRYPOINT ["./load-test.sh"]
