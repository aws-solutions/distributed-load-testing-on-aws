FROM blazemeter/taurus:1.16.38
# taurus includes python and pip
RUN /usr/bin/python3 -m pip install --upgrade pip
RUN pip install --no-cache-dir awscli
RUN apt-get -y install --no-install-recommends xmlstarlet bc procps jq

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

RUN /bin/bash -c "source /etc/profile.d/rbenv.sh && rbenv uninstall --force $(cat /usr/local/rbenv/version)"
RUN rm -rf /usr/local/rbenv

# Replacing urllib3 with more stable Versions to resolve vulnerabilities
RUN pip install urllib3==2.2.2
RUN rm -rf /root/.bzt/python-packages/3.10.12/urllib3*
RUN cp -r /usr/local/lib/python3.10/dist-packages/urllib3* /root/.bzt/python-packages/3.10.12/

# Replacing Werkzeug with more stable version to resolve vulnerabilities
RUN pip install Werkzeug==3.0.6
RUN rm -rf /root/.bzt/python-packages/3.10.12/werkzeug*
RUN cp -r /usr/local/lib/python3.10/dist-packages/werkzeug* /root/.bzt/python-packages/3.10.12/

# Replacing cryptography with more stable version to resolve vulnerabilities
RUN pip install cryptography==43.0.1
RUN rm -rf /root/.bzt/python-packages/3.10.12/cryptography*
RUN cp -r /usr/local/lib/python3.10/dist-packages/cryptography* /root/.bzt/python-packages/3.10.12/

# Replacing setuptools with more stable version to resolve vulnerabilities
RUN pip install setuptools==65.5.1
RUN rm -rf /root/.bzt/python-packages/3.10.12/setuptools*
RUN cp -r /usr/local/lib/python3.10/dist-packages/setuptools* /root/.bzt/python-packages/3.10.12/

# Removing dotnet dependencies as NUnit and Xunit is not supported in DLT
RUN rm -rf /usr/share/dotnet

# Replacing aiohttp with more stable version to resolve CVE-2024-23334
RUN rm -rf /usr/local/lib/python3.10/dist-packages/aiohttp* 
RUN  pip install --upgrade aiohttp

# Replacing idna and Flask_Cors with more stable version to resolve CVE-2024-3651 and  CVE-2024-6221
RUN pip install --upgrade idna Flask_Cors==5.0.0
RUN rm -rf /root/.bzt/python-packages/3.10.12/idna* /root/.bzt/python-packages/3.10.12/Flask_Cors*
RUN cp -r /usr/local/lib/python3.10/dist-packages/idna* /usr/local/lib/python3.10/dist-packages/Flask_Cors* /root/.bzt/python-packages/3.10.12/

# Bumping the version of NPM to remove possible vulnerabilities
RUN npm install -g npm

# Remove unused poetry.lock file to resolve multiple CVEs
RUN rm -f /root/.bzt/python-packages/3.10.12/poetry.lock

WORKDIR /bzt-configs/
ENTRYPOINT ["./load-test.sh"]
