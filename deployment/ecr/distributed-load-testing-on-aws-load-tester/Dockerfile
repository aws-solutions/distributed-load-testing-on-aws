FROM blazemeter/taurus:1.16.29
# taurus includes python and pip
RUN /usr/bin/python3 -m pip install --upgrade pip
RUN pip install --no-cache-dir awscli
RUN apt-get -y install --no-install-recommends xmlstarlet bc procps

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

# Fixing CVE-2023-36617
WORKDIR /usr/local/rbenv/versions/3.2.2/lib/ruby/gems/3.2.0/specifications/default
RUN sed -i 's/0.12.1/0.12.2.0/g' uri-0.12.1.gemspec
RUN mv uri-0.12.1.gemspec uri-0.12.2.gemspec
RUN gem install --default uri -v 0.12.2.0

# Replacing urllib3 with more stable Versions to resolve vulnerabilities
RUN pip install urllib3==2.0.7
RUN rm -rf /root/.bzt/python-packages/3.10.12/urllib3*
RUN cp -r /usr/local/lib/python3.10/dist-packages/urllib3* /root/.bzt/python-packages/3.10.12/

# Replacing Werkzeug with more stable version to resolve vulnerabilities
RUN pip install Werkzeug==3.0.1
RUN rm -rf /root/.bzt/python-packages/3.10.12/werkzeug*
RUN cp -r /usr/local/lib/python3.10/dist-packages/werkzeug* /root/.bzt/python-packages/3.10.12/

# Replacing cryptography with more stable version to resolve vulnerabilities
RUN pip install cryptography==42.0.5
RUN rm -rf /root/.bzt/python-packages/3.10.12/cryptography*
RUN cp -r /usr/local/lib/python3.10/dist-packages/cryptography* /root/.bzt/python-packages/3.10.12/

# Replacing Pillow with more stable version resolve CVE-2023-50447	
RUN rm -rf /root/.local/lib/python3.10/site-packages/Pillow*
RUN pip install --upgrade pillow --target /root/.local/lib/python3.10/site-packages/

# Replaing aiohttp with more stable version to resolve CVE-2024-23334
RUN rm -rf /usr/local/lib/python3.10/dist-packages/aiohttp* 
RUN  pip install --upgrade aiohttp

WORKDIR /bzt-configs/
ENTRYPOINT ["./load-test.sh"]
