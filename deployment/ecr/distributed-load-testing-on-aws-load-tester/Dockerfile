FROM blazemeter/taurus:1.16.26
# taurus includes python and pip
RUN /usr/bin/python3 -m pip install --upgrade pip
RUN pip install --no-cache-dir awscli
RUN apt-get -y install xmlstarlet bc procps

# Removing selenium and gatling from our image as they are not supported in DLT
RUN rm -rf /root/.bzt/selenium-taurus
RUN rm -rf /root/.bzt/gatling-taurus

RUN apt-get update && apt-get upgrade -y
# Taurus working directory  = /bzt-configs
ADD ./load-test.sh /bzt-configs/
ADD ./*.jar /bzt-configs/
ADD ./*.py /bzt-configs/

RUN chmod 755 /bzt-configs/load-test.sh
RUN chmod 755 /bzt-configs/ecslistener.py
RUN chmod 755 /bzt-configs/ecscontroller.py
RUN chmod 755 /bzt-configs/jar_updater.py
RUN python3 /bzt-configs/jar_updater.py

# Fixing CVE-2023-22796
WORKDIR /usr/local/rbenv/versions/3.2.2/lib/ruby/gems/3.2.0/gems/rbs-2.8.2/steep
RUN sed -i 's/7.0.4/7.0.7.1/g' Gemfile.lock
RUN gem install activesupport -v 7.0.7.1

# Replacing urllib3, Werkzeug and cryptography with more stable Versions to fix vulnerabilities
RUN pip install urllib3==2.0.7
RUN pip install Werkzeug==3.0.1
RUN pip install cryptography==41.0.5
RUN rm -rf /root/.bzt/python-packages/3.10.12/urllib3*
RUN rm -rf /root/.bzt/python-packages/3.10.12/werkzeug*
RUN rm -rf /root/.bzt/python-packages/3.10.12/cryptography*
RUN cp -r /usr/local/lib/python3.10/dist-packages/urllib3* /root/.bzt/python-packages/3.10.12/
RUN cp -r /usr/local/lib/python3.10/dist-packages/werkzeug* /root/.bzt/python-packages/3.10.12/
RUN cp -r /usr/local/lib/python3.10/dist-packages/cryptography* /root/.bzt/python-packages/3.10.12/

WORKDIR /bzt-configs/
ENTRYPOINT ["./load-test.sh"]
