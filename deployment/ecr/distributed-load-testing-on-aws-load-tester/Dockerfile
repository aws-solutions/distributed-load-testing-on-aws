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

# Remove K6 as it is not supported in DLT by default
RUN apt remove -y k6

RUN /bin/bash -c "source /etc/profile.d/rbenv.sh && yes | rbenv uninstall $(cat /usr/local/rbenv/version)"
RUN rm -rf /usr/local/rbenv

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
RUN pip install pillow==10.3.0 
RUN cp -r /usr/local/lib/python3.10/dist-packages/pillow* /root/.local/lib/python3.10/site-packages/

# Replacing aiohttp with more stable version to resolve CVE-2024-23334
RUN rm -rf /usr/local/lib/python3.10/dist-packages/aiohttp* 
RUN  pip install --upgrade aiohttp

# Replacing idna with more stable version to resolve CVE-2024-3651
RUN pip install --upgrade idna
RUN rm -rf /root/.bzt/python-packages/3.10.12/idna*
RUN cp -r /usr/local/lib/python3.10/dist-packages/idna* /root/.bzt/python-packages/3.10.12/

WORKDIR /bzt-configs/
ENTRYPOINT ["./load-test.sh"]
