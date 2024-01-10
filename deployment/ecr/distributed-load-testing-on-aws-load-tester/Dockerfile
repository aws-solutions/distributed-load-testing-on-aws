FROM blazemeter/taurus:1.16.26
# Removing selenium and gatling from our image as they are not supported in DLT
RUN rm -rf /root/.bzt/selenium-taurus /root/.bzt/gatling-taurus

# taurus includes python and pip
RUN /usr/bin/python3 -m pip install --upgrade pip \
  && pip install --no-cache-dir awscli \
  && apt-get -y install xmlstarlet bc procps \
  && apt-get update && apt-get upgrade -y

# Taurus working directory  = /bzt-configs
ADD ./load-test.sh /bzt-configs/
ADD ./*.jar /bzt-configs/
ADD ./*.py /bzt-configs/

RUN chmod 755 \
  /bzt-configs/load-test.sh \
  /bzt-configs/ecslistener.py \
  /bzt-configs/ecscontroller.py \
  /bzt-configs/jar_updater.py
RUN python3 /bzt-configs/jar_updater.py

# Fixing CVE-2023-22796
WORKDIR /usr/local/rbenv/versions/3.2.2/lib/ruby/gems/3.2.0/gems/rbs-2.8.2/steep
RUN sed -i 's/7.0.4/7.0.7.1/g' Gemfile.lock \
  && gem install activesupport -v 7.0.7.1

# Replacing urllib3, Werkzeug and cryptography with more stable Versions to fix vulnerabilities
RUN pip install urllib3==2.0.7 Werkzeug==3.0.1 cryptography==41.0.5 \
  && rm -rf \
    /root/.bzt/python-packages/3.10.12/urllib3* \
    /root/.bzt/python-packages/3.10.12/werkzeug* \
    /root/.bzt/python-packages/3.10.12/cryptography* \
  && cp -r /usr/local/lib/python3.10/dist-packages/urllib3* /root/.bzt/python-packages/3.10.12/ \
  && cp -r /usr/local/lib/python3.10/dist-packages/werkzeug* /root/.bzt/python-packages/3.10.12/
  && cp -r /usr/local/lib/python3.10/dist-packages/cryptography* /root/.bzt/python-packages/3.10.12/

WORKDIR /bzt-configs/
ENTRYPOINT ["./load-test.sh"]
